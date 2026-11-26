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

// Rising towers: one glass tower per measured application, its height the debt to income after the shock, lit in
// its band colour, on an oval plinth with brass rings at the 40% and 50% limits. Built like the loan file's
// committee and chain stages (night stage, mirror floor, studio environment, bloom, side-on sway). Decorative: the
// table below the stage carries every figure it draws.

export interface TowerDatum {
  applicationId: string;
  beforeDtiPct: number;
  beforeBand: AffordabilityBand;
  afterDtiPct: number;
  band: AffordabilityBand;
}

export interface StageState {
  // Empty before the first answer: the stage shows its plinth and rings only.
  towers: TowerDatum[];
  // The latest run failed: the towers drop to the plinth and dim, as the figures below are not current.
  failing: boolean;
}

export interface RateShockHandle {
  update(state: StageState): void;
  dispose(): void;
}

interface SceneOptions {
  reduceMotion: boolean;
  // The control panel, when it is docked over the stage's left side; the picture shifts right to clear it.
  dock?: HTMLElement | null;
  onContextLost?(): void;
  onSelect?(applicationId: string): void;
}

const TUNE = {
  fov: 30,
  distance: 13.6,
  height: 2.3,
  target: [0, 2.05, 0] as const,
  sway: 0.4, // idle swing either side of side-on (radians)
  swaySpeed: 0.13,
  maxAzimuth: 0.85, // how far a drag may turn it either way
  resumeAfter: 4000,
  minPolar: 0.75,
  maxPolar: 1.42,
  unit: 0.075, // scene units per DTI percentage point: 40% stands 3.0 high
  maxDtiPct: 90, // one extreme value is capped so it cannot leave the frame
  levels: [40, 50] as const,
  towerW: 0.66,
  tweenMs: 900,
  ringRx: 5.0,
  ringRz: 1.15,
  bloom: { strength: 0.6, radius: 0.5, threshold: 0.72 },
  maxPixelRatio: 1.75,
};

const MIN_H = 0.05;
const STEM = 14;
const heightOf = (dtiPct: number) => Math.max(MIN_H, Math.min(dtiPct, TUNE.maxDtiPct) * TUNE.unit);
const fmt = new Intl.NumberFormat('en-IE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

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

interface Pill {
  el: HTMLDivElement;
  valueEl: HTMLSpanElement;
}

function makePill(host: HTMLElement, name: string | null, value: string, extraClass: string): Pill {
  const el = document.createElement('div');
  el.className = `council-label ${extraClass}`;
  el.setAttribute('aria-hidden', 'true');
  const pill = document.createElement('span');
  pill.className = 'council-pill';
  if (name) {
    const nameEl = document.createElement('span');
    nameEl.className = 'council-name';
    nameEl.textContent = name;
    pill.append(nameEl);
  }
  const valueEl = document.createElement('span');
  valueEl.className = 'council-value';
  valueEl.textContent = value;
  pill.append(valueEl);
  el.append(pill);
  host.append(el);
  return { el, valueEl };
}

export function createRateShockScene(
  host: HTMLElement,
  { reduceMotion, dock, onContextLost: onContextLostCb, onSelect }: SceneOptions,
): RateShockHandle {
  const colours = {
    night: readToken('--color-night', '#0d1814'),
    ink: readToken('--color-ink', '#16241d'),
    surface: readToken('--color-surface', '#fffcf4'),
    brass: readToken('--color-brass', '#c9b27c'),
    brassLight: readToken('--color-brass-light', '#f3e2b5'),
    key: readToken('--color-stage-key', '#fff0d8'),
    rim: readToken('--color-stage-rim', '#cfe2ff'),
    ground: readToken('--color-stage-ground', '#2b3b34'),
    mirror: readToken('--color-stage-mirror', '#4e5f58'),
    Comfortable: readToken('--color-vote-approve', '#5b9a7b'),
    Caution: readToken('--color-vote-conditional', '#c99a52'),
    Adverse: readToken('--color-vote-decline', '#c26a55'),
  } as const;

  // ---- Renderer, scene, camera ----
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio || 1, TUNE.maxPixelRatio);
  renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(colours.night);
  scene.fog = new THREE.Fog(colours.night, 14, 32);
  scene.environmentIntensity = 0.45;

  const camera = new THREE.PerspectiveCamera(TUNE.fov, 1, 0.1, 120);
  const target = new THREE.Vector3(...TUNE.target);
  camera.position.copy(target).add(new THREE.Vector3(0, TUNE.height, TUNE.distance));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.enableZoom = false; // the wheel keeps scrolling the page
  controls.rotateSpeed = 0.6;
  controls.minPolarAngle = TUNE.minPolar;
  controls.maxPolarAngle = TUNE.maxPolar;
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
  controls.addEventListener('start', () => { dragging = true; idle = false; window.clearTimeout(resumeTimer); host.dataset.dragging = 'true'; kick(); });
  controls.addEventListener('end', () => {
    dragging = false;
    delete host.dataset.dragging;
    if (!reduceMotion) resumeTimer = window.setTimeout(() => { idle = true; kick(); }, TUNE.resumeAfter);
  });
  controls.addEventListener('change', () => kick());

  // Warm key, cool rim, soft hemisphere: as the other stages.
  const key = new THREE.DirectionalLight(colours.key, 2.0);
  key.position.set(4, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 1024);
  key.shadow.radius = 7;
  key.shadow.bias = -0.0005;
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 5, bottom: -5, near: 1, far: 30 });
  const rim = new THREE.DirectionalLight(colours.rim, 1.4);
  rim.position.set(-3, 5, -9);
  scene.add(key, rim, new THREE.HemisphereLight(colours.surface, colours.ground, 0.3));

  const dotTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']], 64);
  const veilTex = radialTexture([[0, 'rgba(255,255,255,0)'], [0.25, 'rgba(255,255,255,0.15)'], [0.5, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,1)']]);

  // ---- Mirror floor faded into the backdrop, contact shadows on top ----
  const mirror = new Reflector(new THREE.CircleGeometry(14, 96), { textureWidth: 512, textureHeight: 512, color: new THREE.Color(colours.mirror), clipBias: 0.003 });
  mirror.rotation.x = -Math.PI / 2;
  scene.add(mirror);
  const veil = new THREE.Mesh(
    new THREE.CircleGeometry(14.05, 96),
    new THREE.MeshBasicMaterial({ color: colours.night, alphaMap: veilTex, transparent: true, depthWrite: false, fog: false }),
  );
  veil.rotation.x = -Math.PI / 2;
  veil.position.y = 0.002;
  scene.add(veil);
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.45 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.004;
  catcher.receiveShadow = true;
  scene.add(catcher);

  // ---- Materials ----
  const brassMat = new THREE.MeshStandardMaterial({ color: colours.brass, metalness: 1, roughness: 0.26 });
  const glass = (tint: string) => new THREE.MeshPhysicalMaterial({
    color: colours.surface, roughness: 0.24, metalness: 0, transmission: 1, thickness: 0.6, ior: 1.45,
    clearcoat: 1, clearcoatRoughness: 0.05, attenuationColor: new THREE.Color(tint), attenuationDistance: 1.6,
    iridescence: 0.2, iridescenceIOR: 1.3, envMapIntensity: 1.3,
  });
  const rimMat = (tint: string) => new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(tint) }, k: { value: 0.9 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 c; uniform float k; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4); gl_FragColor = vec4(c * f * k, f * k); }',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });

  // ---- Oval plinth with a brass inlay ----
  const ellipsePoints = (rx: number, rz: number, n = 160) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * rx, 0, Math.sin(a) * rz);
  });
  const ellipseTube = (rx: number, rz: number, radius: number, material: THREE.Material) =>
    new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ellipsePoints(rx, rz), true), 256, radius, 8, true), material);
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1.02, 0.1, 128),
    new THREE.MeshPhysicalMaterial({ color: colours.ink, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.5, envMapIntensity: 0.25 }),
  );
  plinth.scale.set(5.35, 1, 1.5);
  plinth.position.y = 0.05;
  plinth.receiveShadow = true;
  scene.add(plinth);
  const inlay = ellipseTube(5.17, 1.37, 0.012, brassMat);
  inlay.position.y = 0.102;
  scene.add(inlay);

  // ---- Limit rings at 40% and 50% DTI: a glowing brass line and a faint plane ----
  const rings = TUNE.levels.map((level, i) => {
    const y = level * TUNE.unit + 0.1;
    const lineMat = new THREE.MeshBasicMaterial({ color: i === 0 ? colours.brassLight : colours.brass, transparent: true, opacity: 0.95 });
    const line = ellipseTube(TUNE.ringRx, TUNE.ringRz, 0.013, lineMat);
    line.position.y = y;
    const shape = new THREE.Shape();
    shape.absellipse(0, 0, TUNE.ringRx, TUNE.ringRz, 0, Math.PI * 2, false, 0);
    const planeMat = new THREE.MeshBasicMaterial({ color: colours.brass, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const plane = new THREE.Mesh(new THREE.ShapeGeometry(shape, 96), planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = y;
    scene.add(line, plane);
    return { level, y, lineMat, planeMat, flash: 0 };
  });

  // ---- Stars far behind and dust in the light ----
  const STARS = 260;
  const starPos = new Float32Array(STARS * 3);
  for (let i = 0; i < STARS; i++) {
    const theta = Math.random() * Math.PI * 2;
    const y = Math.random() * 0.9 + 0.05;
    const r = 38;
    starPos[i * 3] = Math.cos(theta) * r * Math.sqrt(1 - y * y);
    starPos[i * 3 + 1] = y * r;
    starPos[i * 3 + 2] = Math.sin(theta) * r * Math.sqrt(1 - y * y);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: colours.brassLight, size: 2, sizeAttenuation: false, map: dotTex, transparent: true, depthWrite: false, opacity: 0.6, fog: false }));
  scene.add(stars);
  const DUST = 180;
  const dustPos = new Float32Array(DUST * 3);
  const dustSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 14;
    dustPos[i * 3 + 1] = Math.random() * 4.5 + 0.2;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 8;
    dustSeed[i] = Math.random() * 10;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: colours.brassLight, size: 0.035, map: dotTex, transparent: true, depthWrite: false, opacity: 0.4, blending: THREE.AdditiveBlending })));

  // ---- Post-processing ----
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), TUNE.bloom.strength, TUNE.bloom.radius, TUNE.bloom.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- Labels (the committee stage's pill markup) ----
  const levelLabels = rings.map((ring) => ({ ring, ...makePill(host, null, `${ring.level}%`, 'shock-level-label') }));
  const tip = document.createElement('div');
  tip.className = 'council-tip';
  tip.setAttribute('aria-hidden', 'true');
  host.append(tip);

  // ---- Towers: one per measured application, in ID order so a tower keeps its place between runs ----
  const towerGeo = new RoundedBoxGeometry(TUNE.towerW, 1, TUNE.towerW, 4, 0.045).translate(0, 0.5, 0);
  const coreGeo = new THREE.BoxGeometry(0.2, 1, 0.2).translate(0, 0.5, 0);
  const capGeo = new THREE.BoxGeometry(TUNE.towerW + 0.06, 0.05, TUNE.towerW + 0.06);
  const baseGeo = new THREE.BoxGeometry(TUNE.towerW + 0.1, 0.04, TUNE.towerW + 0.1);
  const hitGeo = new THREE.BoxGeometry(TUNE.towerW + 0.3, 1, TUNE.towerW + 0.3).translate(0, 0.5, 0);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });

  interface Tower {
    id: string;
    group: THREE.Group;
    shell: THREE.Mesh;
    shellMat: THREE.MeshPhysicalMaterial;
    rimShell: THREE.Mesh;
    rimShader: THREE.ShaderMaterial;
    core: THREE.Mesh;
    coreMat: THREE.MeshStandardMaterial;
    cap: THREE.Mesh;
    light: THREE.PointLight;
    hit: THREE.Mesh;
    label: Pill;
    h: number;
    from: number;
    to: number;
    t0: number;
    tweening: boolean;
    colour: THREE.Color;
    colourGoal: THREE.Color;
    goal: THREE.Color;
    flash: number;
    hover: number;
    sel: number;
    dti: number | null;
  }
  let towers: Tower[] = [];

  function removeTowers() {
    for (const tw of towers) {
      scene.remove(tw.group);
      tw.shellMat.dispose();
      tw.rimShader.dispose();
      tw.coreMat.dispose();
      tw.light.dispose();
      tw.label.el.remove();
    }
    towers = [];
  }

  // Rebuilt only when the set of applications changes; a tower already standing keeps its height and colour.
  function buildTowers(data: TowerDatum[]) {
    const kept = new Map(towers.map((tw) => [tw.id, { h: tw.h, colour: tw.colour.clone() }]));
    removeTowers();
    const sorted = [...data].sort((a, b) => a.applicationId.localeCompare(b.applicationId));
    const spacing = Math.min(1.75, 8.6 / Math.max(1, sorted.length - 1));
    sorted.forEach((datum, i) => {
      const old = kept.get(datum.applicationId);
      // A new tower starts at its debt to income before the shock, in its band before, and grows from there.
      const colour = old?.colour ?? new THREE.Color(colours[datum.beforeBand]);
      const tint = `#${colour.getHexString()}`;
      const group = new THREE.Group();
      group.position.set((i - (sorted.length - 1) / 2) * spacing, 0.1, 0);
      scene.add(group);
      const shellMat = glass(tint);
      const shell = new THREE.Mesh(towerGeo, shellMat);
      shell.castShadow = true;
      const rimShader = rimMat(tint);
      const rimShell = new THREE.Mesh(towerGeo, rimShader);
      rimShell.scale.set(1.03, 1, 1.03);
      const coreMat = new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.8, roughness: 0.4 });
      const core = new THREE.Mesh(coreGeo, coreMat);
      const cap = new THREE.Mesh(capGeo, brassMat);
      cap.castShadow = true;
      const base = new THREE.Mesh(baseGeo, brassMat);
      base.position.y = 0.02;
      const light = new THREE.PointLight(tint, 0.8, 2.2, 2);
      light.position.set(0, 0.6, 0.5);
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.userData.id = datum.applicationId;
      group.add(base, core, shell, rimShell, cap, light, hit);
      const h = old?.h ?? heightOf(datum.beforeDtiPct);
      towers.push({
        id: datum.applicationId, group, shell, shellMat, rimShell, rimShader, core, coreMat, cap, light, hit,
        label: makePill(host, datum.applicationId, '', 'shock-tower-label'),
        h, from: h, to: h, t0: 0, tweening: false,
        colour, colourGoal: colour.clone(), goal: colour.clone(), flash: 0, hover: 0, sel: 0, dti: null,
      });
    });
  }

  function applyHeight(tw: Tower) {
    const h = Math.max(MIN_H, tw.h);
    tw.shell.scale.y = h;
    tw.rimShell.scale.y = h;
    tw.core.scale.y = h * 0.94;
    tw.core.position.y = h * 0.03;
    tw.cap.position.y = h + 0.02;
    tw.light.position.y = h * 0.6;
    tw.hit.scale.y = Math.max(h, 0.6) + 0.35;
  }

  function applyColour(tw: Tower) {
    tw.coreMat.color.copy(tw.colour);
    tw.coreMat.emissive.copy(tw.colour);
    tw.shellMat.attenuationColor.copy(tw.colour);
    (tw.rimShader.uniforms.c.value as THREE.Color).copy(tw.colour);
    tw.light.color.copy(tw.colour);
  }

  let failing = false;
  let lastFrameAt = -Infinity;
  let finishTimer = 0;
  function update(state: StageState) {
    failing = state.failing;
    host.dataset.towers = String(state.towers.length);
    const ids = state.towers.map((d) => d.applicationId).sort().join('|');
    if (ids !== [...towers.map((tw) => tw.id)].sort().join('|')) buildTowers(state.towers);
    const now = performance.now();
    for (const tw of towers) {
      const datum = failing ? null : state.towers.find((d) => d.applicationId === tw.id) ?? null;
      const toH = datum ? heightOf(datum.afterDtiPct) : MIN_H;
      if (datum) tw.goal.set(colours[datum.band]);
      tw.dti = datum ? datum.afterDtiPct : null;
      tw.from = tw.h;
      tw.to = toH;
      tw.t0 = now;
      const crosses = TUNE.levels.some((level) => {
        const y = level * TUNE.unit;
        return Math.min(tw.from, toH) < y && y < Math.max(tw.from, toH);
      });
      // A tower that crosses a ring takes its new colour at the moment it crosses (with a flash); others ease into it.
      if (!crosses || reduceMotion || failing) tw.colourGoal.copy(tw.goal);
      if (reduceMotion) {
        tw.h = toH;
        tw.tweening = false;
        tw.colour.copy(tw.goal);
        tw.colourGoal.copy(tw.goal);
      } else {
        tw.tweening = true;
      }
      applyHeight(tw);
      applyColour(tw);
    }
    kick();
    // A hidden tab or pane runs no animation frames: settle on the final state so it is right when shown.
    const asked = performance.now();
    window.clearTimeout(finishTimer);
    finishTimer = window.setTimeout(() => { if (lastFrameAt < asked) finishNow(); }, 350);
  }

  function finishNow() {
    for (const tw of towers) {
      tw.h = tw.to;
      tw.tweening = false;
      tw.flash = 0;
      tw.colour.copy(tw.goal);
      tw.colourGoal.copy(tw.goal);
      applyHeight(tw);
      applyColour(tw);
    }
    if (ready && !disposed) renderOnce();
  }

  // ---- Picking: hover shows the hint; a click (not a drag) goes to the row ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered: Tower | null = null;
  let selected: Tower | null = null;
  let selectTimer = 0;
  let down: { x: number; y: number } | null = null;
  const pick = (event: PointerEvent) => {
    if (failing || !towers.length) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(towers.map((tw) => tw.hit), false)[0];
    return towers.find((tw) => tw.id === hit?.object.userData.id) ?? null;
  };
  const onDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
  const onUp = (event: PointerEvent) => {
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 6) {
      const tw = pick(event);
      if (tw) {
        selected = tw;
        window.clearTimeout(selectTimer);
        selectTimer = window.setTimeout(() => { if (selected === tw) { selected = null; kick(); } }, 2600);
        kick();
        onSelect?.(tw.id);
      }
    }
    down = null;
  };
  const onMove = (event: PointerEvent) => {
    if (event.buttons) { tip.classList.remove('council-tip-on'); return; }
    hovered = pick(event);
    host.dataset.hovering = hovered ? 'true' : 'false';
    if (hovered) {
      const rect = renderer.domElement.getBoundingClientRect();
      tip.textContent = `Click to see ${hovered.id} in the table`;
      tip.style.left = `${Math.min(event.clientX - rect.left, rect.width - tip.offsetWidth - 20)}px`;
      tip.style.top = `${event.clientY - rect.top}px`;
    }
    tip.classList.toggle('council-tip-on', hovered !== null);
    kick();
  };
  const onLeave = () => { hovered = null; host.dataset.hovering = 'false'; tip.classList.remove('council-tip-on'); kick(); };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerleave', onLeave);

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
    // With the controls docked over the stage's left side, shift the picture right so the towers stand in the free
    // space beside the panel (a view offset, so dragging still turns around the towers' own centre).
    const docked = dock ? getComputedStyle(dock).position === 'absolute' : false;
    const shift = docked && dock ? Math.max(0, (dock.getBoundingClientRect().right - host.getBoundingClientRect().left + 8) / 2) : 0;
    camera.setViewOffset(width, height, -shift, 0, width, height);
    // Fit the rings' full width (plus label room) into the free width: widen the lens only when needed.
    const free = Math.max(1, width - 2 * shift);
    const halfW = TUNE.ringRx + 0.9;
    const fitV = THREE.MathUtils.radToDeg(2 * Math.atan(halfW / TUNE.distance / (free / height)));
    camera.fov = Math.max(TUNE.fov, fitV);
    camera.updateProjectionMatrix();
    host.dataset.compact = free < 520 ? 'true' : 'false';
    kick();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  if (dock) resizeObserver.observe(dock);
  const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; kick(); });
  visibility.observe(host);

  const disposables: { dispose(): void }[] = [];
  let ready = false;
  let disposed = false;
  let running = false;
  let frameId = 0;
  let last = 0;
  let t = 0;
  const tmp = new THREE.Vector3();
  const tmpColour = new THREE.Color();
  const flashColour = new THREE.Color(colours.surface);
  function kick() {
    if (ready && !running && visible) { running = true; last = performance.now(); frameId = requestAnimationFrame(frame); }
  }
  const ease = (k: number) => 1 - Math.pow(1 - k, 3);

  function step(dt: number) {
    if (!reduceMotion) t += dt;
    if (idle) {
      const goal = Math.sin(t * TUNE.swaySpeed) * TUNE.sway;
      const turn = (goal - controls.getAzimuthalAngle()) * 0.03;
      camera.position.sub(target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn).add(target);
    }
    controls.update(dt);
    const now = performance.now();
    let settling = false;
    for (const tw of towers) {
      if (tw.tweening) {
        const k = Math.max(0, Math.min(1, (now - tw.t0) / TUNE.tweenMs));
        const prev = tw.h;
        tw.h = tw.from + (tw.to - tw.from) * ease(k);
        for (const ring of rings) {
          const y = ring.level * TUNE.unit;
          if ((prev < y && tw.h >= y) || (prev > y && tw.h <= y)) {
            tw.colourGoal.copy(tw.goal);
            tw.colour.copy(tw.goal);
            tw.flash = 1;
            ring.flash = 1;
          }
        }
        if (k >= 1) { tw.tweening = false; tw.colourGoal.copy(tw.goal); }
        applyHeight(tw);
        settling = true;
      }
      // Ease the colour, decay the flash, ease hover and selection.
      if (!tw.colour.equals(tw.colourGoal)) {
        tw.colour.lerp(tw.colourGoal, reduceMotion ? 1 : 0.12);
        const gap = Math.abs(tw.colour.r - tw.colourGoal.r) + Math.abs(tw.colour.g - tw.colourGoal.g) + Math.abs(tw.colour.b - tw.colourGoal.b);
        if (gap < 0.004) tw.colour.copy(tw.colourGoal);
        settling = true;
      }
      applyColour(tw);
      tw.flash = Math.max(0, tw.flash - dt * 1.8);
      const ht = hovered === tw ? 1 : 0;
      const st = selected === tw ? 1 : 0;
      tw.hover += (ht - tw.hover) * (reduceMotion ? 1 : 0.16);
      tw.sel += (st - tw.sel) * (reduceMotion ? 1 : 0.12);
      if (tw.flash > 0 || Math.abs(tw.hover - ht) > 1e-3 || Math.abs(tw.sel - st) > 1e-3) settling = true;
      const dim = failing ? 0.15 : 1;
      const pulse = reduceMotion ? 1 : 1 + 0.12 * Math.sin(t * 1.6 + tw.group.position.x);
      tw.coreMat.emissiveIntensity = dim * (0.8 * pulse + tw.flash * 3 + tw.hover * 1.2 + tw.sel * 0.8);
      tw.light.intensity = dim * (0.8 + tw.flash * 2.5 + tw.hover * 0.6);
      tw.rimShader.uniforms.k.value = dim * (0.9 + tw.flash * 1.6 + tw.hover * 0.8);
      const bump = 1 + tw.flash * 0.08 + tw.hover * 0.05;
      tw.group.scale.set(bump, 1, bump);
    }
    for (const ring of rings) {
      ring.flash = Math.max(0, ring.flash - dt * 1.4);
      if (ring.flash > 0) settling = true;
      ring.planeMat.opacity = 0.05 + ring.flash * 0.22;
      ring.lineMat.opacity = failing ? 0.45 : 0.95;
      tmpColour.set(ring.level === 40 ? colours.brassLight : colours.brass).lerp(flashColour, ring.flash * 0.6);
      ring.lineMat.color.copy(tmpColour);
    }
    if (!reduceMotion) {
      for (let i = 0; i < DUST; i++) {
        dustPos[i * 3 + 1] += Math.sin(t * 0.4 + dustSeed[i]) * 0.0016;
        dustPos[i * 3] += Math.cos(t * 0.3 + dustSeed[i]) * 0.0012;
      }
      dustGeo.attributes.position.needsUpdate = true;
      stars.rotation.y = t * 0.004;
    }
    placeLabels();
    return settling;
  }

  function placeLabels() {
    // Limit labels first: pinned to whichever end of the ring is further right on screen, kept inside the stage.
    const placed: { cx: number; w: number; top: number; bottom: number }[] = [];
    for (const { ring, el } of levelLabels) {
      const right = tmp.set(TUNE.ringRx, ring.y, 0).project(camera).x;
      const left = tmp.set(-TUNE.ringRx, ring.y, 0).project(camera).x;
      tmp.set((right > left ? 1 : -1) * (TUNE.ringRx + 0.08), ring.y, 0).project(camera);
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const x = Math.min((tmp.x * 0.5 + 0.5) * width + 4, width - w - 6);
      const y = (-tmp.y * 0.5 + 0.5) * height;
      el.style.transform = `translate(${x}px, ${y}px) translate(0, -50%)`;
      placed.push({ cx: x + w / 2, w, top: y - h / 2, bottom: y + h / 2 });
    }
    // Tower labels: above each tower; where two would collide, the lower one's label moves up and its stem grows.
    const entries = towers.map((tw) => {
      tw.label.valueEl.textContent = tw.dti === null ? '' : `${fmt.format(tw.h / TUNE.unit)}%`;
      tw.label.el.dataset.selected = selected === tw || hovered === tw ? 'true' : 'false';
      tw.group.getWorldPosition(tmp);
      tmp.y += Math.max(MIN_H, tw.h) + 0.08;
      tmp.project(camera);
      const pill = tw.label.el.firstElementChild as HTMLElement | null;
      return { tw, x: (tmp.x * 0.5 + 0.5) * width, y: (-tmp.y * 0.5 + 0.5) * height, z: tmp.z, w: tw.label.el.offsetWidth, h: pill?.offsetHeight ?? 0 };
    }).sort((a, b) => b.y - a.y); // lowest first, so taller towers' labels are moved rather than buried
    for (const e of entries) {
      let bottom = e.y - STEM - 3; // bottom edge of the pill
      for (let pass = 0; pass < 8; pass++) {
        const clash = placed.find((p) => Math.abs(e.x - p.cx) < (e.w + p.w) / 2 + 6 && bottom > p.top - 4 && bottom - e.h < p.bottom + 4);
        if (!clash) break;
        bottom = clash.top - 4;
      }
      bottom = Math.max(bottom, e.h + 4);
      const stem = Math.max(STEM, e.y - bottom - 3);
      placed.push({ cx: e.x, w: e.w, top: bottom - e.h, bottom });
      const el = e.tw.label.el;
      el.style.setProperty('--stem', `${stem}px`);
      el.style.opacity = e.z < 1 && !failing && e.tw.dti !== null ? '' : '0';
      el.style.transform = `translate(${e.x}px, ${e.y}px) translate(-50%, -100%)`;
    }
  }

  function frame() {
    const now = performance.now();
    lastFrameAt = now;
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.05)); // the first frame can come before kick()'s timestamp
    last = now;
    const settling = step(dt);
    composer.render(dt);
    // With reduced motion the scene draws only while something is changing or being dragged.
    if (visible && (!reduceMotion || settling || dragging)) frameId = requestAnimationFrame(frame);
    else running = false;
  }

  function renderOnce() {
    step(0);
    composer.render(0);
  }

  const onContextLost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frameId); running = false; onContextLostCb?.(); };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  resize();
  prepareScene({ renderer, scene, camera, composer, bloom }, () => !disposed)
    .then((prepared) => {
      if (!prepared) return;
      disposables.push(prepared);
      ready = true;
      host.dataset.ready = 'true';
      resize();
      // Draw once straight away: in a hidden pane neither the observer nor animation frames may fire.
      renderOnce();
      kick();
    })
    .catch(() => { if (!disposed) onContextLostCb?.(); });

  return {
    update,
    dispose() {
      disposed = true;
      delete host.dataset.ready;
      delete host.dataset.towers;
      delete host.dataset.compact;
      cancelAnimationFrame(frameId);
      running = false;
      visible = false;
      window.clearTimeout(resumeTimer);
      window.clearTimeout(finishTimer);
      window.clearTimeout(selectTimer);
      resizeObserver.disconnect();
      visibility.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      removeTowers();
      for (const { el } of levelLabels) el.remove();
      tip.remove();
      // Every geometry and material still in the scene (plinth, rings, floor, stars, dust), then the shared ones.
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      for (const item of [towerGeo, coreGeo, capGeo, baseGeo, hitGeo, hitMat, brassMat, dotTex, veilTex]) item.dispose();
      mirror.getRenderTarget().dispose();
      key.shadow.map?.dispose();
      composer.dispose();
      bloom.dispose();
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
