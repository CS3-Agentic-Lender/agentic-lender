import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { readToken } from './canDraw3d';

// The loan's place on the blockchain, as an illustration: glass data blocks joined by brass links, with pulses
// running along the chain and the wider network behind it. Only the two highlighted blocks stand for real
// records (the decision's hash in the audit registry, then the minted loan note); they carry the stored values.
// Decorative: the same facts are written out beside the scene.

export interface ChainData {
  tokenId: string;
  auditHashShort: string;
  // Short transaction hashes as stored, or null when the record has none.
  mintTxShort: string | null;
  auditTxShort: string | null;
}

export interface ChainHandle {
  dispose(): void;
}

// ---- Tuning ----
const TUNE = {
  fov: 30,
  distance: 9.6, // camera distance from the middle of the chain
  height: 3.2,
  target: [0, 1.25, 0] as const,
  sway: 0.42, // idle swing either side of side-on, in radians (a long chain reads best side-on)
  swaySpeed: 0.13, // how fast the idle swing goes
  maxAzimuth: 0.85, // how far a drag may turn it either way
  resumeAfter: 4000,
  minPolar: 0.75,
  maxPolar: 1.42,
  blocks: 7, // blocks drawn in the chain
  auditIndex: 3, // which block holds the decision's hash
  noteIndex: 4, // which block holds the loan note (minted after the hash is stored)
  spacing: 1.75,
  size: 0.86,
  bloom: { strength: 0.6, radius: 0.5, threshold: 0.72 },
  nodes: 70, // network nodes behind the chain
  maxPixelRatio: 1.75,
};

function circuitTexture(line: string) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  g.strokeStyle = line;
  g.fillStyle = line;
  g.lineWidth = 3;
  g.lineCap = 'round';
  // A fixed pattern of right-angled traces ending in pads, like a printed circuit.
  const traces: [number, number, number, number, number, number][] = [
    [20, 40, 120, 40, 120, 90], [20, 128, 80, 128, 80, 200], [236, 60, 170, 60, 170, 140],
    [236, 200, 140, 200, 140, 236], [60, 236, 60, 170, 110, 170], [128, 20, 128, 70, 200, 70],
    [200, 120, 236, 120, 236, 150], [20, 220, 40, 220, 40, 236],
  ];
  for (const [x1, y1, x2, y2, x3, y3] of traces) {
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x3, y3); g.stroke();
    g.beginPath(); g.arc(x3, y3, 6, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x1, y1, 4, 0, Math.PI * 2); g.fill();
  }
  g.strokeRect(96, 96, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

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

export function createChainScene(host: HTMLElement, data: ChainData, { reduceMotion }: { reduceMotion: boolean }): ChainHandle {
  const colours = {
    night: readToken('--color-night', '#0d1814'),
    brass: readToken('--color-brass', '#c9b27c'),
    brassLight: readToken('--color-brass-light', '#f3e2b5'),
    sage: readToken('--color-vote-approve', '#5b9a7b'),
    tint: readToken('--color-tint', '#e8efe7'),
  };

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio || 1, TUNE.maxPixelRatio);
  renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.style.touchAction = 'none';
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(colours.night);
  scene.fog = new THREE.Fog(colours.night, 13, 30);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.45;

  const disposables: { dispose(): void }[] = [envMap, pmrem];
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
  let idle = !reduceMotion;
  controls.target.copy(target);
  let resumeTimer = 0;
  let dragging = false;
  controls.addEventListener('start', () => { dragging = true; idle = false; window.clearTimeout(resumeTimer); host.dataset.dragging = 'true'; kick(); });
  controls.addEventListener('end', () => {
    dragging = false;
    delete host.dataset.dragging;
    if (!reduceMotion) resumeTimer = window.setTimeout(() => { idle = true; kick(); }, TUNE.resumeAfter);
  });
  controls.addEventListener('change', () => kick());

  const key = new THREE.DirectionalLight('#fff0d8', 2.0);
  key.position.set(4, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 1024);
  key.shadow.radius = 7;
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 5, bottom: -5, near: 1, far: 30 });
  const rim = new THREE.DirectionalLight('#cfe2ff', 1.4);
  rim.position.set(-3, 5, -9);
  scene.add(key, rim, new THREE.HemisphereLight('#ffffff', '#2b3b34', 0.3));

  // ---- Mirror floor, faded into the backdrop, with contact shadows ----
  const mirror = new Reflector(track(new THREE.CircleGeometry(12, 96)), { textureWidth: 512, textureHeight: 512, color: 0x4e5f58, clipBias: 0.003 });
  mirror.rotation.x = -Math.PI / 2;
  scene.add(mirror);
  const veil = new THREE.Mesh(
    track(new THREE.CircleGeometry(12.05, 96)),
    track(new THREE.MeshBasicMaterial({ color: colours.night, alphaMap: track(radialTexture([[0, 'rgba(255,255,255,0)'], [0.25, 'rgba(255,255,255,0.15)'], [0.5, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,1)']])), transparent: true, depthWrite: false, fog: false })),
  );
  veil.rotation.x = -Math.PI / 2;
  veil.position.y = 0.002;
  scene.add(veil);
  const catcher = new THREE.Mesh(track(new THREE.PlaneGeometry(60, 60)), track(new THREE.ShadowMaterial({ opacity: 0.45 })));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.004;
  catcher.receiveShadow = true;
  scene.add(catcher);

  const dotTex = track(radialTexture([[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']], 64));

  // ---- The chain ----
  const chain = new THREE.Group();
  scene.add(chain);
  const blockPositions: THREE.Vector3[] = [];
  const mid = (TUNE.blocks - 1) / 2;
  for (let i = 0; i < TUNE.blocks; i++) {
    const x = (i - mid) * TUNE.spacing;
    // A gentle S-curve in depth so the chain reads in three dimensions.
    blockPositions.push(new THREE.Vector3(x, 1.25, Math.sin((i - mid) * 0.55) * 0.9));
  }

  const sageCircuit = track(circuitTexture(colours.sage));
  const brassCircuit = track(circuitTexture(colours.brassLight));
  const shellGeo = track(new RoundedBoxGeometry(TUNE.size, TUNE.size, TUNE.size, 4, 0.06));
  const edgesGeo = track(new THREE.EdgesGeometry(new THREE.BoxGeometry(TUNE.size * 1.002, TUNE.size * 1.002, TUNE.size * 1.002)));
  const coreGeo = track(new THREE.BoxGeometry(TUNE.size * 0.5, TUNE.size * 0.5, TUNE.size * 0.5));
  interface BlockView { group: THREE.Group; core: THREE.Mesh; edges: THREE.LineSegments; real: boolean; phase: number }
  const blocks: BlockView[] = [];

  blockPositions.forEach((pos, i) => {
    const real = i === TUNE.auditIndex || i === TUNE.noteIndex;
    const tint = real ? colours.brassLight : colours.sage;
    const group = new THREE.Group();
    group.position.copy(pos);
    const shell = new THREE.Mesh(shellGeo, track(new THREE.MeshPhysicalMaterial({
      color: real ? '#2b2a20' : '#14231d', roughness: 0.12, metalness: 0.1, transparent: true, opacity: real ? 0.5 : 0.38,
      clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6, map: real ? brassCircuit : sageCircuit,
      emissive: tint, emissiveMap: real ? brassCircuit : sageCircuit, emissiveIntensity: real ? 0.5 : 0.35, depthWrite: false,
    })));
    shell.castShadow = true;
    const edges = new THREE.LineSegments(edgesGeo, track(new THREE.LineBasicMaterial({ color: tint, transparent: true, opacity: real ? 1 : 0.7 })));
    const core = new THREE.Mesh(coreGeo, track(new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: real ? 0.75 : 0.55, roughness: 0.3, metalness: 0.2 })));
    group.add(core, shell, edges);
    if (real) group.add(new THREE.PointLight(colours.brassLight, 0.55, 2.4, 2));
    chain.add(group);
    blocks.push({ group, core, edges, real, phase: i * 0.9 });
  });

  // Brass chain links between neighbours: two interlocking rings each.
  const linkGeo = track(new THREE.TorusGeometry(0.17, 0.035, 12, 40));
  const linkMat = track(new THREE.MeshStandardMaterial({ color: colours.brass, metalness: 1, roughness: 0.25 }));
  const segments: THREE.Line3[] = [];
  for (let i = 0; i < TUNE.blocks - 1; i++) {
    const a = blockPositions[i];
    const b = blockPositions[i + 1];
    const dir = b.clone().sub(a).normalize();
    const start = a.clone().addScaledVector(dir, TUNE.size * 0.55);
    const end = b.clone().addScaledVector(dir, -TUNE.size * 0.55);
    segments.push(new THREE.Line3(start, end));
    const midpoint = start.clone().lerp(end, 0.5);
    const yaw = Math.atan2(-(dir.z), dir.x);
    for (const [offset, roll] of [[-0.14, 0], [0.14, Math.PI / 2]] as const) {
      const link = new THREE.Mesh(linkGeo, linkMat);
      link.scale.set(1.5, 1, 1);
      link.position.copy(midpoint).addScaledVector(dir, offset);
      link.rotation.set(roll, yaw, 0, 'YXZ');
      link.castShadow = true;
      chain.add(link);
    }
  }

  // Pulses of light that run along the whole chain, through the blocks.
  const PULSES = 3;
  const pulseMat = track(new THREE.SpriteMaterial({ map: dotTex, color: colours.brassLight, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const pulses = Array.from({ length: PULSES }, (_, i) => {
    const sprite = new THREE.Sprite(pulseMat);
    sprite.scale.setScalar(0.42);
    chain.add(sprite);
    return { sprite, offset: i / PULSES };
  });
  const chainCurve = new THREE.CatmullRomCurve3(blockPositions);
  const thread = new THREE.Mesh(track(new THREE.TubeGeometry(chainCurve, 200, 0.008, 6)), track(new THREE.MeshBasicMaterial({ color: colours.brassLight, transparent: true, opacity: 0.25 })));
  chain.add(thread);

  // ---- The network behind the chain: nodes and their nearest links ----
  const nodePositions: THREE.Vector3[] = [];
  for (let i = 0; i < TUNE.nodes; i++) {
    const theta = (i / TUNE.nodes) * Math.PI * 2 * 3.1;
    const r = 7 + ((i * 37) % 10) * 0.25;
    nodePositions.push(new THREE.Vector3(Math.cos(theta) * r, 0.6 + ((i * 53) % 40) / 9, -3 - Math.abs(Math.sin(theta)) * 4));
  }
  const nodeGeo = track(new THREE.BufferGeometry().setFromPoints(nodePositions));
  const network = new THREE.Group();
  network.add(new THREE.Points(nodeGeo, track(new THREE.PointsMaterial({ color: colours.sage, size: 0.12, map: dotTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }))));
  const linkPoints: THREE.Vector3[] = [];
  nodePositions.forEach((p, i) => {
    const nearest = nodePositions
      .map((q, j) => ({ j, d: p.distanceTo(q) }))
      .filter(({ j }) => j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { j, d } of nearest) if (j > i && d < 3.2) linkPoints.push(p, nodePositions[j]);
  });
  network.add(new THREE.LineSegments(track(new THREE.BufferGeometry().setFromPoints(linkPoints)), track(new THREE.LineBasicMaterial({ color: colours.sage, transparent: true, opacity: 0.18 }))));
  scene.add(network);

  // Dust in the light.
  const DUST = 200;
  const dustPos = new Float32Array(DUST * 3);
  const dustSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 18;
    dustPos[i * 3 + 1] = Math.random() * 5 + 0.2;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 10;
    dustSeed[i] = Math.random() * 10;
  }
  const dustGeo = track(new THREE.BufferGeometry());
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  scene.add(new THREE.Points(dustGeo, track(new THREE.PointsMaterial({ color: colours.brassLight, size: 0.035, map: dotTex, transparent: true, depthWrite: false, opacity: 0.4, blending: THREE.AdditiveBlending }))));

  // ---- Post-processing ----
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), TUNE.bloom.strength, TUNE.bloom.radius, TUNE.bloom.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- Labels on the two real blocks (same pill style as the committee) ----
  const labels: { el: HTMLDivElement; block: BlockView; below: boolean }[] = [];
  const makeLabel = (index: number, name: string, value: string, below = false) => {
    const el = document.createElement('div');
    el.className = below ? 'council-label council-label-below' : 'council-label';
    el.dataset.selected = 'true';
    el.setAttribute('aria-hidden', 'true');
    const pill = document.createElement('span');
    pill.className = 'council-pill';
    const nameEl = document.createElement('span');
    nameEl.className = 'council-name';
    nameEl.textContent = name;
    const valueEl = document.createElement('span');
    // Hashes keep their stored case: an upper-cased "0X2E3B" reads as a different value.
    valueEl.className = 'council-value council-value-raw';
    valueEl.textContent = value;
    pill.append(nameEl, valueEl);
    el.append(pill);
    host.append(el);
    labels.push({ el, block: blocks[index], below });
  };
  makeLabel(
    TUNE.auditIndex,
    'Decision hash',
    data.auditTxShort ? `${data.auditHashShort} · tx ${data.auditTxShort}` : data.auditHashShort,
    true,
  );
  makeLabel(
    TUNE.noteIndex,
    'Loan note',
    data.mintTxShort ? `#${data.tokenId} · tx ${data.mintTxShort}` : `#${data.tokenId}`,
  );

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
    // Keep the whole chain in frame on narrow screens.
    camera.fov = width < 700 ? TUNE.fov + 18 : TUNE.fov;
    camera.updateProjectionMatrix();
    kick();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; kick(); });
  visibility.observe(host);

  let running = false;
  let frameId = 0;
  let last = 0;
  let t = 0;
  const tmp = new THREE.Vector3();
  function kick() {
    if (!running && visible) { running = true; last = performance.now(); frameId = requestAnimationFrame(frame); }
  }
  function frame(now: number) {
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.05)); // the first frame's timestamp can precede kick()
    last = now;
    if (!reduceMotion) t += dt;
    if (idle) {
      // Ease the camera towards a slow swing either side of side-on.
      const goal = Math.sin(t * TUNE.swaySpeed) * TUNE.sway;
      const turn = (goal - controls.getAzimuthalAngle()) * 0.03;
      camera.position.sub(target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn).add(target);
    }
    controls.update(dt);
    for (const b of blocks) {
      b.group.position.y = 1.25 + (reduceMotion ? 0 : Math.sin(t * 1.1 + b.phase) * 0.05);
      b.core.rotation.y = t * (b.real ? 0.8 : 0.4);
      b.core.rotation.x = t * 0.3;
      if (b.real) (b.edges.material as THREE.LineBasicMaterial).opacity = 0.75 + 0.25 * Math.sin(t * 2 + b.phase);
    }
    for (const p of pulses) {
      chainCurve.getPoint(((t * 0.08) + p.offset) % 1, p.sprite.position);
      p.sprite.visible = !reduceMotion;
    }
    network.rotation.y = Math.sin(t * 0.05) * 0.08;
    if (!reduceMotion) {
      for (let i = 0; i < DUST; i++) {
        dustPos[i * 3 + 1] += Math.sin(t * 0.4 + dustSeed[i]) * 0.0016;
        dustPos[i * 3] += Math.cos(t * 0.3 + dustSeed[i]) * 0.0012;
      }
      dustGeo.attributes.position.needsUpdate = true;
    }
    for (const { el, block, below } of labels) {
      block.group.getWorldPosition(tmp);
      tmp.y += below ? -TUNE.size * 0.75 : TUNE.size * 0.75;
      tmp.project(camera);
      el.style.opacity = tmp.z < 1 ? '1' : '0';
      el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * width}px, ${(-tmp.y * 0.5 + 0.5) * height}px) translate(-50%, ${below ? '0' : '-100%'})`;
    }
    composer.render(dt);
    if (visible && (!reduceMotion || dragging)) frameId = requestAnimationFrame(frame);
    else running = false;
  }

  const onContextLost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frameId); running = false; };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  resize();
  kick();

  return {
    dispose() {
      cancelAnimationFrame(frameId);
      running = false;
      visible = false;
      window.clearTimeout(resumeTimer);
      resizeObserver.disconnect();
      visibility.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      mirror.getRenderTarget().dispose();
      (mirror.material as THREE.Material).dispose();
      composer.dispose();
      bloom.dispose();
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      for (const { el } of labels) el.remove();
    },
  };
}
