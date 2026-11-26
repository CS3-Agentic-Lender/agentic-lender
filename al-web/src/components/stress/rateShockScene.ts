import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { readToken } from '../lending/council/canDraw3d';
import { prepareScene } from '../lending/council/warmUp';
import type { AffordabilityBand } from '../../services/stressService';

// The portfolio under the shock: one glass tower per application, as tall as its debt to income after the
// shock, with brass rings at the 40% and 50% band limits. Built like the loan file's committee and chain
// stages (mirror floor, bloom, limited sway). Decorative: the charts and the table beside it carry the facts.

export interface TowerDatum {
  applicationId: string;
  beforeDtiPct: number;
  afterDtiPct: number;
  band: AffordabilityBand;
}

export interface RateShockHandle {
  // New results: towers are rebuilt and grow from their before to their after height.
  update(towers: TowerDatum[]): void;
  dispose(): void;
}

const TUNE = {
  fov: 32,
  distance: 11,
  height: 3.4,
  target: [0, 1.6, 0] as const,
  sway: 0.32,
  swaySpeed: 0.12,
  maxAzimuth: 0.8,
  resumeAfter: 4000,
  minPolar: 0.8,
  maxPolar: 1.38,
  scale: 0.065, // scene units per DTI point: 60% is 3.9 units tall
  maxDtiPct: 75, // towers are capped here so one extreme value does not dwarf the rest
  width: 0.62,
  spacing: 1.25,
  grow: 1.1, // seconds for a tower to reach its new height
  bloom: { strength: 0.55, radius: 0.5, threshold: 0.7 },
  maxPixelRatio: 1.75,
};

const LIMITS = [40, 50] as const;

function radialTexture(stops: [number, string][], size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, colour] of stops) grd.addColorStop(at, colour);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const heightOf = (dtiPct: number) => Math.max(0.08, Math.min(dtiPct, TUNE.maxDtiPct) * TUNE.scale);

export function createRateShockScene(
  host: HTMLElement,
  { reduceMotion, onContextLost: onContextLostCb, onSelect }: { reduceMotion: boolean; onContextLost?(): void; onSelect?(applicationId: string): void },
): RateShockHandle {
  const colours = {
    night: readToken('--color-night', '#0d1814'),
    brass: readToken('--color-brass', '#c9b27c'),
    brassLight: readToken('--color-brass-light', '#f3e2b5'),
    Comfortable: readToken('--color-vote-approve', '#5b9a7b'),
    Caution: readToken('--color-vote-conditional', '#c99a52'),
    Adverse: readToken('--color-vote-decline', '#c26a55'),
  } as const;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio || 1, TUNE.maxPixelRatio);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(colours.night);
  scene.fog = new THREE.Fog(colours.night, 14, 30);

  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(item: T) => { disposables.push(item); return item; };

  const camera = new THREE.PerspectiveCamera(TUNE.fov, 1, 0.1, 100);
  const target = new THREE.Vector3(...TUNE.target);
  camera.position.copy(target).add(new THREE.Vector3(0, TUNE.height, TUNE.distance));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.minPolarAngle = TUNE.minPolar;
  controls.maxPolarAngle = TUNE.maxPolar;
  controls.rotateSpeed = 0.6;
  controls.minAzimuthAngle = -TUNE.maxAzimuth;
  controls.maxAzimuthAngle = TUNE.maxAzimuth;
  controls.target.copy(target);
  // On a phone a vertical swipe should scroll the page: lock the vertical angle (OrbitControls set touch-action).
  if (window.matchMedia?.('(pointer: coarse)').matches) {
    renderer.domElement.style.touchAction = 'pan-y';
    controls.update();
    const polar = controls.getPolarAngle();
    controls.minPolarAngle = polar;
    controls.maxPolarAngle = polar;
  }
  let idle = !reduceMotion;
  let resumeTimer = 0;
  let dragging = false;
  let moved = false;
  controls.addEventListener('start', () => { dragging = true; moved = false; idle = false; window.clearTimeout(resumeTimer); host.dataset.dragging = 'true'; kick(); });
  controls.addEventListener('change', () => { if (dragging) moved = true; kick(); });
  controls.addEventListener('end', () => {
    dragging = false;
    delete host.dataset.dragging;
    if (!reduceMotion) resumeTimer = window.setTimeout(() => { idle = true; kick(); }, TUNE.resumeAfter);
  });

  const key = new THREE.DirectionalLight('#fff0d8', 1.8);
  key.position.set(4, 9, 6);
  const rim = new THREE.DirectionalLight('#cfe2ff', 1.2);
  rim.position.set(-4, 5, -8);
  scene.add(key, rim, new THREE.HemisphereLight('#ffffff', '#2b3b34', 0.35));

  // ---- Mirror floor faded into the backdrop ----
  const mirror = new Reflector(track(new THREE.CircleGeometry(13, 96)), { textureWidth: 512, textureHeight: 512, color: 0x4e5f58, clipBias: 0.003 });
  mirror.rotation.x = -Math.PI / 2;
  scene.add(mirror);
  const veil = new THREE.Mesh(
    track(new THREE.CircleGeometry(13.05, 96)),
    track(new THREE.MeshBasicMaterial({ color: colours.night, alphaMap: track(radialTexture([[0, 'rgba(255,255,255,0)'], [0.3, 'rgba(255,255,255,0.2)'], [0.55, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,1)']])), transparent: true, depthWrite: false, fog: false })),
  );
  veil.rotation.x = -Math.PI / 2;
  veil.position.y = 0.002;
  scene.add(veil);

  // ---- Limit rings: thin glowing brass bands around the whole row at 40% and 50% ----
  const limitLabels: { el: HTMLElement; at: THREE.Vector3 }[] = [];
  const rings = new THREE.Group();
  scene.add(rings);
  const ringMat = track(new THREE.MeshBasicMaterial({ color: colours.brassLight, transparent: true, opacity: 0.85 }));
  const planeMat = track(new THREE.MeshBasicMaterial({ color: colours.brass, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }));
  let ringWidth = 6;
  const ringMeshes: THREE.Object3D[] = [];
  function buildRings(span: number) {
    for (const mesh of ringMeshes) rings.remove(mesh);
    ringMeshes.length = 0;
    ringWidth = span;
    for (const limit of LIMITS) {
      const y = heightOf(limit);
      const shape = new THREE.Shape();
      const w = span / 2;
      const d = 1.1;
      shape.moveTo(-w, -d); shape.lineTo(w, -d); shape.lineTo(w, d); shape.lineTo(-w, d); shape.lineTo(-w, -d);
      const outline = new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(shape.getPoints())), ringMat);
      outline.rotation.x = -Math.PI / 2;
      outline.position.y = y;
      const plane = new THREE.Mesh(track(new THREE.PlaneGeometry(span, 2.2)), planeMat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = y;
      rings.add(outline, plane);
      ringMeshes.push(outline, plane);
    }
    for (const { el } of limitLabels) el.remove();
    limitLabels.length = 0;
    for (const limit of LIMITS) {
      const el = document.createElement('div');
      el.className = 'council-label';
      el.setAttribute('aria-hidden', 'true');
      const pill = document.createElement('span');
      pill.className = 'council-pill';
      const value = document.createElement('span');
      value.className = 'council-value';
      value.textContent = `${limit}%`;
      pill.append(value);
      el.append(pill);
      host.append(el);
      limitLabels.push({ el, at: new THREE.Vector3(span / 2 + 0.35, heightOf(limit), 0) });
    }
  }

  // ---- Towers ----
  const towerGeo = track(new RoundedBoxGeometry(TUNE.width, 1, TUNE.width, 4, 0.05));
  const edgeGeo = track(new THREE.EdgesGeometry(new THREE.BoxGeometry(TUNE.width * 1.004, 1, TUNE.width * 1.004)));
  const capGeo = track(new THREE.BoxGeometry(TUNE.width * 0.82, 0.05, TUNE.width * 0.82));
  interface TowerView {
    datum: TowerDatum;
    group: THREE.Group;
    shell: THREE.Mesh;
    edges: THREE.LineSegments;
    cap: THREE.Mesh;
    from: number;
    to: number;
    label: HTMLElement;
    materials: THREE.Material[];
  }
  let towers: TowerView[] = [];
  let growT = 1;
  const towerRow = new THREE.Group();
  scene.add(towerRow);

  function clearTowers() {
    for (const tower of towers) {
      towerRow.remove(tower.group);
      for (const material of tower.materials) material.dispose();
      tower.label.remove();
    }
    towers = [];
  }

  function makeLabel(datum: TowerDatum) {
    const el = document.createElement('div');
    el.className = 'council-label';
    el.setAttribute('aria-hidden', 'true');
    const pill = document.createElement('span');
    pill.className = 'council-pill';
    const name = document.createElement('span');
    name.className = 'council-name';
    name.textContent = datum.applicationId;
    const value = document.createElement('span');
    value.className = 'council-value';
    value.textContent = `${datum.afterDtiPct.toFixed(1)}%`;
    pill.append(name, value);
    el.append(pill);
    host.append(el);
    return el;
  }

  function update(data: TowerDatum[]) {
    const previous = new Map(towers.map((t) => [t.datum.applicationId, t.group.scale.y]));
    clearTowers();
    const count = data.length;
    const span = Math.max(4, count * TUNE.spacing + 0.6);
    buildRings(span);
    data.forEach((datum, i) => {
      const tint = colours[datum.band] ?? colours.Comfortable;
      const group = new THREE.Group();
      group.position.set((i - (count - 1) / 2) * TUNE.spacing, 0, Math.sin(i * 1.3) * 0.25);
      const shellMat = new THREE.MeshPhysicalMaterial({
        color: '#14231d', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.55, clearcoat: 1,
        clearcoatRoughness: 0.05, emissive: tint, emissiveIntensity: 0.55, depthWrite: false,
      });
      const edgeMat = new THREE.LineBasicMaterial({ color: tint, transparent: true, opacity: 0.95 });
      const capMat = new THREE.MeshBasicMaterial({ color: tint });
      const shell = new THREE.Mesh(towerGeo, shellMat);
      shell.position.y = 0.5;
      shell.userData.applicationId = datum.applicationId;
      const edges = new THREE.LineSegments(edgeGeo, edgeMat);
      edges.position.y = 0.5;
      const cap = new THREE.Mesh(capGeo, capMat);
      const pillar = new THREE.Group();
      pillar.add(shell, edges);
      group.add(pillar, cap);
      towerRow.add(group);
      const from = previous.get(datum.applicationId) ?? heightOf(datum.beforeDtiPct);
      const to = heightOf(datum.afterDtiPct);
      towers.push({ datum, group: pillar as THREE.Group, shell, edges, cap, from, to, label: makeLabel(datum), materials: [shellMat, edgeMat, capMat] });
    });
    growT = reduceMotion ? 1 : 0;
    host.dataset.towers = String(count);
    kick();
  }

  // ---- Click a tower to pick its application (a drag is not a click) ----
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const onClick = (event: MouseEvent) => {
    if (moved) { moved = false; return; }
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(towers.map((t) => t.shell), false)[0];
    const id = hit?.object.userData.applicationId as string | undefined;
    if (id) onSelect?.(id);
  };
  renderer.domElement.addEventListener('click', onClick);
  const onMove = (event: PointerEvent) => {
    if (dragging) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    renderer.domElement.style.cursor = raycaster.intersectObjects(towers.map((t) => t.shell), false).length ? 'pointer' : 'grab';
  };
  renderer.domElement.addEventListener('pointermove', onMove);

  // ---- Post-processing ----
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), TUNE.bloom.strength, TUNE.bloom.radius, TUNE.bloom.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- Size, visibility, loop ----
  let width = 1;
  let height = 1;
  let visible = true;
  const resize = () => {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    bloom.resolution.set(width, height);
    mirror.getRenderTarget().setSize(Math.round(width * dpr * 0.5), Math.round(height * dpr * 0.5));
    camera.aspect = width / height;
    // Keep the whole row in frame: widen the view for long rows and narrow screens.
    const needed = ringWidth + 1.6;
    const fitFov = THREE.MathUtils.radToDeg(2 * Math.atan((needed / 2) / (TUNE.distance * camera.aspect)));
    camera.fov = Math.min(70, Math.max(TUNE.fov, fitFov));
    camera.updateProjectionMatrix();
    kick();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; kick(); });
  visibility.observe(host);

  let ready = false;
  let disposed = false;
  let running = false;
  let frameId = 0;
  let last = 0;
  let t = 0;
  const tmp = new THREE.Vector3();
  function kick() {
    if (ready && !running && visible) { running = true; last = performance.now(); frameId = requestAnimationFrame(frame); }
  }
  const ease = (x: number) => 1 - Math.pow(1 - x, 3);
  function place(el: HTMLElement, at: THREE.Vector3) {
    tmp.copy(at).project(camera);
    el.style.opacity = tmp.z < 1 ? '1' : '0';
    el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * width}px, ${(-tmp.y * 0.5 + 0.5) * height}px) translate(-50%, -100%)`;
  }
  function frame(now: number) {
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.05)); // the first frame's timestamp can precede kick()
    last = now;
    if (!reduceMotion) t += dt;
    if (idle) {
      const goal = Math.sin(t * TUNE.swaySpeed) * TUNE.sway;
      const turn = (goal - controls.getAzimuthalAngle()) * 0.03;
      camera.position.sub(target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn).add(target);
    }
    controls.update(dt);
    if (growT < 1) growT = Math.min(1, growT + dt / TUNE.grow);
    const k = ease(growT);
    for (const tower of towers) {
      const h = tower.from + (tower.to - tower.from) * k;
      tower.group.scale.y = h;
      tower.cap.position.y = h + 0.03;
      (tower.edges.material as THREE.LineBasicMaterial).opacity = 0.8 + (reduceMotion ? 0.15 : 0.15 * Math.sin(t * 2 + tower.group.parent!.position.x));
      tower.group.parent!.getWorldPosition(tmp);
      place(tower.label, new THREE.Vector3(tmp.x, h + 0.25, tmp.z));
    }
    for (const { el, at } of limitLabels) place(el, at);
    composer.render(dt);
    const animating = growT < 1 || !reduceMotion || dragging;
    if (visible && animating) frameId = requestAnimationFrame(frame);
    else running = false;
  }

  const onContextLost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frameId); running = false; onContextLostCb?.(); };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  buildRings(ringWidth);
  resize();
  prepareScene({ renderer, scene, camera, composer, bloom }, () => !disposed)
    .then((prepared) => {
      if (!prepared) return;
      disposables.push(prepared);
      ready = true;
      host.dataset.ready = 'true';
      resize();
      kick();
    })
    .catch(() => { if (!disposed) onContextLostCb?.(); });

  return {
    update(data) {
      update(data);
      resize();
    },
    dispose() {
      disposed = true;
      delete host.dataset.ready;
      delete host.dataset.towers;
      cancelAnimationFrame(frameId);
      running = false;
      visible = false;
      window.clearTimeout(resumeTimer);
      resizeObserver.disconnect();
      visibility.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('pointermove', onMove);
      clearTowers();
      for (const { el } of limitLabels) el.remove();
      mirror.getRenderTarget().dispose();
      (mirror.material as THREE.Material).dispose();
      composer.dispose();
      bloom.dispose();
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
