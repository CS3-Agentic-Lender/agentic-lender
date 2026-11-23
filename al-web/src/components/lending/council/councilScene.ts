import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// The committee drawn as a council: a frosted pillar per agent, lit in the colour of its stored vote, streaming
// into the recommendation the underwriter is shown. Decorative only: every vote and outcome it draws is written
// out as text in the committee tabs, so the canvas and its labels are hidden from assistive technology.

export type SceneAgent = 'affordability' | 'valuation' | 'strategist' | 'market';
export type SceneVote = 'Approve' | 'Conditionally Approve' | 'Decline' | null;

export interface CouncilData {
  votes: Record<Exclude<SceneAgent, 'market'>, SceneVote>;
  effective: SceneVote;
  running: boolean;
  names: Record<SceneAgent, string>;
}

export interface CouncilHandle {
  focus(agent: SceneAgent | null): void;
  dispose(): void;
}

// ---- Tuning: every value that sets the feel ----
const TUNE = {
  fov: 32, // narrow lens keeps the pillars straight
  distance: 9.2, // resting camera distance from the target
  height: 3.6, // resting camera height above the target
  target: [0, 1.4, 0] as const,
  autoRotate: 0.55, // idle turn speed (OrbitControls units)
  resumeAfter: 4000, // ms after a drag before the idle turn resumes
  minPolar: 0.55, // how high the camera may go (radians from straight down)
  maxPolar: 1.38, // and how low
  hoverSlow: 0.12, // turn speed multiplier while an agent is hovered
  introSeconds: 1.8, // camera sweep when the scene appears
  bloom: { strength: 0.6, radius: 0.55, threshold: 0.72 },
  mirrorResolution: 0.5, // floor reflection rendered at half the canvas size
  maxPixelRatio: 1.75,
};

const SEATS: { key: SceneAgent; deg: number; h: number; small?: boolean }[] = [
  { key: 'affordability', deg: 205, h: 1.9 },
  { key: 'strategist', deg: 270, h: 2.15 },
  { key: 'valuation', deg: 335, h: 1.9 },
  { key: 'market', deg: 120, h: 0.95, small: true },
];

function token(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
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

export function createCouncilScene(
  host: HTMLElement,
  data: CouncilData,
  { onPick, reduceMotion }: { onPick(agent: SceneAgent): void; reduceMotion: boolean },
): CouncilHandle {
  const colours = {
    night: token('--color-night', '#0d1814'),
    pine: token('--color-pine', '#1e342e'),
    brass: token('--color-brass', '#c9b27c'),
    brassLight: token('--color-brass-light', '#f3e2b5'),
    approve: token('--color-vote-approve', '#5b9a7b'),
    conditional: token('--color-vote-conditional', '#c99a52'),
    decline: token('--color-vote-decline', '#c26a55'),
    observer: token('--color-vote-observer', '#9aa59f'),
  };
  const voteColour = (vote: SceneVote | 'observer') =>
    vote === 'Approve' ? colours.approve
      : vote === 'Conditionally Approve' ? colours.conditional
        : vote === 'Decline' ? colours.decline
          : colours.observer;
  const voteOf = (key: SceneAgent): SceneVote | 'observer' => (key === 'market' ? 'observer' : data.votes[key]);

  // ---- Renderer, scene, camera ----
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
  scene.fog = new THREE.Fog(colours.night, 14, 30);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.4;

  const camera = new THREE.PerspectiveCamera(TUNE.fov, 1, 0.1, 100);
  const target = new THREE.Vector3(...TUNE.target);
  camera.position.copy(target).add(new THREE.Vector3(0, TUNE.height, TUNE.distance));

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.enableZoom = false; // the mouse wheel keeps scrolling the page
  controls.minPolarAngle = TUNE.minPolar;
  controls.maxPolarAngle = TUNE.maxPolar;
  controls.rotateSpeed = 0.7;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = TUNE.autoRotate;
  controls.target.copy(target);
  let resumeTimer = 0;
  let dragging = false;
  controls.addEventListener('start', () => {
    dragging = true;
    controls.autoRotate = false;
    window.clearTimeout(resumeTimer);
    host.dataset.dragging = 'true';
    kick();
  });
  controls.addEventListener('end', () => {
    dragging = false;
    delete host.dataset.dragging;
    if (!reduceMotion) resumeTimer = window.setTimeout(() => { controls.autoRotate = true; kick(); }, TUNE.resumeAfter);
  });
  controls.addEventListener('change', () => kick());

  // Lights stand in the scene: warm key, cool fill about a quarter as strong, a rim from behind.
  const key = new THREE.DirectionalLight('#fff0d8', 2.2);
  key.position.set(4, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 7;
  key.shadow.bias = -0.0005;
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
  const fill = new THREE.DirectionalLight('#cfe2ff', 0.55);
  fill.position.set(-7, 3, 2);
  const rim = new THREE.DirectionalLight('#ffffff', 1.6);
  rim.position.set(-2, 6, -9);
  scene.add(key, fill, rim, new THREE.HemisphereLight('#ffffff', '#46584f', 0.3));

  // Everything made below is tracked so dispose() can free it.
  const disposables: { dispose(): void }[] = [envMap, pmrem];
  const track = <T extends { dispose(): void }>(item: T) => { disposables.push(item); return item; };
  const world = new THREE.Group();
  scene.add(world);

  // ---- Polished floor: a mirror faded into the backdrop, contact shadows on top ----
  const MIRROR_RADIUS = 7;
  const mirror = new Reflector(track(new THREE.CircleGeometry(MIRROR_RADIUS, 96)), { textureWidth: 512, textureHeight: 512, color: 0x4e5f58, clipBias: 0.003 });
  mirror.rotation.x = -Math.PI / 2;
  scene.add(mirror);
  const veilTex = track(radialTexture([[0, 'rgba(255,255,255,0)'], [0.3, 'rgba(255,255,255,0.12)'], [0.55, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,1)']]));
  const veil = new THREE.Mesh(
    track(new THREE.CircleGeometry(MIRROR_RADIUS + 0.05, 96)),
    track(new THREE.MeshBasicMaterial({ color: colours.night, alphaMap: veilTex, transparent: true, depthWrite: false, fog: false })),
  );
  veil.rotation.x = -Math.PI / 2;
  veil.position.y = 0.002;
  scene.add(veil);
  const catcher = new THREE.Mesh(track(new THREE.PlaneGeometry(60, 60)), track(new THREE.ShadowMaterial({ opacity: 0.45 })));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.004;
  catcher.receiveShadow = true;
  scene.add(catcher);

  // ---- Materials ----
  const dotTex = track(radialTexture([[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']], 64));
  dotTex.colorSpace = THREE.SRGBColorSpace;
  const glass = (tint: string, roughness = 0.28) => track(new THREE.MeshPhysicalMaterial({
    color: '#ffffff', roughness, metalness: 0, transmission: 1, thickness: 0.6, ior: 1.45,
    clearcoat: 1, clearcoatRoughness: 0.05, attenuationColor: new THREE.Color(tint), attenuationDistance: 2.6,
    iridescence: 0.2, iridescenceIOR: 1.3, envMapIntensity: 1.3,
  }));
  const glow = (tint: string, k = 1) => track(new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.85 * k, roughness: 0.4 }));
  const brass = () => track(new THREE.MeshStandardMaterial({ color: colours.brass, metalness: 1, roughness: 0.26 }));
  const rimMat = (tint: string) => track(new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(tint) }, k: { value: 1.0 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 c; uniform float k; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4); gl_FragColor = vec4(c * f * k, f * k); }',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));

  // ---- Floor disc with brass inlays ----
  const floor = new THREE.Mesh(track(new THREE.CylinderGeometry(3.4, 3.5, 0.1, 128)), track(new THREE.MeshPhysicalMaterial({ color: '#16241d', roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.5, envMapIntensity: 0.25 })));
  floor.position.y = 0.05;
  floor.receiveShadow = true;
  world.add(floor);
  for (const radius of [1.2, 3.25]) {
    const inlay = new THREE.Mesh(track(new THREE.TorusGeometry(radius, radius > 2 ? 0.01 : 0.014, 8, 200)), brass());
    inlay.rotation.x = Math.PI / 2;
    inlay.position.y = 0.101;
    world.add(inlay);
  }

  // ---- The recommendation: a solid, polished orb with a glowing rim (glass would shimmer) ----
  const centreTint = data.effective ? voteColour(data.effective) : colours.observer;
  const core = new THREE.Group();
  core.position.set(0, 1.3, 0);
  world.add(core);
  const c = new THREE.Color(centreTint);
  const orb = new THREE.Mesh(track(new THREE.SphereGeometry(0.42, 128, 96)), track(new THREE.MeshPhysicalMaterial({
    color: c.clone().multiplyScalar(0.6), roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
    iridescence: 0.45, iridescenceIOR: 1.35, sheen: 0.5, sheenColor: c, emissive: c, emissiveIntensity: data.effective ? 0.2 : 0.05, envMapIntensity: 1.5,
  })));
  orb.castShadow = true;
  const orbRim = new THREE.Mesh(track(new THREE.SphereGeometry(0.445, 96, 64)), rimMat(centreTint));
  const gate = new THREE.Mesh(track(new THREE.TorusGeometry(0.62, 0.014, 12, 160)), brass());
  gate.rotation.x = Math.PI / 2;
  core.add(orb, orbRim, gate, new THREE.PointLight(centreTint, data.effective ? 1.3 : 0.3, 4, 2));

  // ---- Pillars, one per agent ----
  interface AgentView { group: THREE.Group; hit: THREE.Mesh; glow: THREE.MeshStandardMaterial; base: number; hover: number; sel: number; lift: number; phase: number }
  const agents = new Map<SceneAgent, AgentView>();
  const streams: ((t: number) => void)[] = [];
  const tmp = new THREE.Vector3();

  function stream(from: THREE.Vector3, to: THREE.Vector3, tint: string, count: number) {
    const mid = from.clone().lerp(to, 0.5);
    mid.y += 0.6;
    const curve = new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone());
    const pos = new Float32Array(count * 3);
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    world.add(new THREE.Points(geo, track(new THREE.PointsMaterial({ color: tint, size: 0.07, map: dotTex, transparent: true, depthWrite: false, opacity: 0.9, blending: THREE.AdditiveBlending }))));
    world.add(new THREE.Mesh(track(new THREE.TubeGeometry(curve, 40, 0.006, 6)), track(new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.22 }))));
    const point = new THREE.Vector3();
    streams.push((t) => {
      for (let i = 0; i < count; i++) {
        curve.getPoint((i / count + t * 0.22) % 1, point);
        pos[i * 3] = point.x; pos[i * 3 + 1] = point.y; pos[i * 3 + 2] = point.z;
      }
      geo.attributes.position.needsUpdate = true;
    });
  }

  for (const seat of SEATS) {
    const vote = voteOf(seat.key);
    const tint = voteColour(vote);
    const stored = vote !== null;
    const angle = THREE.MathUtils.degToRad(seat.deg);
    const r = seat.small ? 2.55 : 2.25;
    const group = new THREE.Group();
    group.position.set(Math.cos(angle) * r, 0.1, Math.sin(angle) * r);
    group.lookAt(0, 0.1, 0);
    world.add(group);
    const w = seat.small ? 0.42 : 0.62;
    const d = 0.2;
    const slab = new THREE.Mesh(track(new RoundedBoxGeometry(w, seat.h, d, 4, 0.05)), glass(tint));
    slab.position.y = seat.h / 2;
    slab.castShadow = true;
    const strength = seat.small ? 0.45 : stored ? 1 : 0.25;
    const glowMat = glow(tint, strength);
    const strip = new THREE.Mesh(track(new THREE.BoxGeometry(0.05, seat.h * 0.78, 0.05)), glowMat);
    strip.position.y = seat.h / 2;
    const cap = new THREE.Mesh(track(new THREE.BoxGeometry(w + 0.06, 0.05, d + 0.06)), brass());
    cap.position.y = seat.h + 0.02;
    const light = new THREE.PointLight(tint, (seat.small ? 0.4 : stored ? 1.1 : 0.3) * 0.85, 2.2, 2);
    light.position.set(0, seat.h * 0.6, 0.35);
    const hit = new THREE.Mesh(track(new THREE.SphereGeometry(Math.max(seat.h, 1) * 0.62, 12, 8)), track(new THREE.MeshBasicMaterial({ visible: false })));
    hit.position.y = seat.h / 2;
    hit.userData.agent = seat.key;
    group.add(slab, strip, cap, light, hit);
    agents.set(seat.key, { group, hit, glow: glowMat, base: glowMat.emissiveIntensity, hover: 0, sel: 0, lift: seat.h + 0.45, phase: seat.deg });
    if (stored || seat.key === 'market') {
      const top = group.localToWorld(new THREE.Vector3(0, seat.h * 0.85, 0));
      stream(top, core.position, tint, seat.small ? 10 : 18);
    }
  }

  // ---- Pulse waves leave the recommendation as the votes land ----
  const waves = [0, 1, 2].map((i) => {
    const ring = new THREE.Mesh(track(new THREE.RingGeometry(0.98, 1, 128)), track(new THREE.MeshBasicMaterial({ color: colours.brassLight, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.012, 0);
    world.add(ring);
    return { ring, offset: i / 3 };
  });

  // ---- Dust drifting in the light ----
  const DUST = 220;
  const dustPos = new Float32Array(DUST * 3);
  const dustSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 12;
    dustPos[i * 3 + 1] = Math.random() * 5 + 0.2;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 12;
    dustSeed[i] = Math.random() * 10;
  }
  const dustGeo = track(new THREE.BufferGeometry());
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  scene.add(new THREE.Points(dustGeo, track(new THREE.PointsMaterial({ color: colours.brassLight, size: 0.035, map: dotTex, transparent: true, depthWrite: false, opacity: 0.45, blending: THREE.AdditiveBlending }))));

  // ---- Post-processing: render, bloom the brightest parts, tone map ----
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), TUNE.bloom.strength, TUNE.bloom.radius, TUNE.bloom.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- Labels: HTML pills positioned from the 3D anchors ----
  const labels = new Map<SceneAgent | 'centre', HTMLDivElement>();
  const makeLabel = (keyName: SceneAgent | 'centre', name: string, value: string, tint: string, below = false) => {
    const el = document.createElement('div');
    el.className = `council-label${below ? ' council-label-below' : ''}`;
    el.setAttribute('aria-hidden', 'true');
    const pill = document.createElement('span');
    pill.className = 'council-pill';
    const dot = document.createElement('span');
    dot.className = 'council-dot';
    dot.style.background = tint;
    const nameEl = document.createElement('span');
    nameEl.className = 'council-name';
    nameEl.textContent = name;
    const valueEl = document.createElement('span');
    valueEl.className = keyName === 'centre' ? 'council-value council-value-final' : 'council-value';
    valueEl.textContent = value;
    if (keyName !== 'centre') pill.append(dot);
    pill.append(nameEl, valueEl);
    el.append(pill);
    host.append(el);
    labels.set(keyName, el);
  };
  for (const seat of SEATS) {
    const vote = voteOf(seat.key);
    makeLabel(seat.key, data.names[seat.key], vote === 'observer' ? 'Observer' : vote ?? (data.running ? 'Pending' : 'Not stored'), voteColour(vote));
  }
  makeLabel('centre', 'For the underwriter', data.effective ?? (data.running ? 'Pending' : 'Not stored'), centreTint, true);
  const tip = document.createElement('div');
  tip.className = 'council-tip';
  tip.setAttribute('aria-hidden', 'true');
  host.append(tip);

  // ---- Picking: hover shows the hint; a click (not a drag) opens the agent ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered: SceneAgent | null = null;
  let selected: SceneAgent | null = null;
  let down: { x: number; y: number } | null = null;
  const pick = (event: PointerEvent): SceneAgent | null => {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([...agents.values()].map((a) => a.hit))[0];
    return (hit?.object.userData.agent as SceneAgent | undefined) ?? null;
  };
  const onDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
  const onUp = (event: PointerEvent) => {
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 6) {
      const agent = pick(event);
      if (agent) onPick(agent);
    }
    down = null;
  };
  const onMove = (event: PointerEvent) => {
    if (event.buttons) { tip.classList.remove('council-tip-on'); return; }
    hovered = pick(event);
    host.dataset.hovering = hovered ? 'true' : 'false';
    if (hovered) {
      const rect = renderer.domElement.getBoundingClientRect();
      tip.textContent = `Click to view what ${data.names[hovered]} said`;
      tip.style.left = `${event.clientX - rect.left}px`;
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
    mirror.getRenderTarget().setSize(Math.round(width * dpr * TUNE.mirrorResolution), Math.round(height * dpr * TUNE.mirrorResolution));
    camera.aspect = width / height;
    camera.fov = width < 600 ? TUNE.fov + 12 : TUNE.fov;
    camera.updateProjectionMatrix();
    kick();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; kick(); });
  visibility.observe(host);

  const introStart = new THREE.Vector3().copy(target).add(new THREE.Vector3(0, 9, 17));
  const introEnd = new THREE.Vector3();
  let intro = reduceMotion ? 1 : 0;
  let running = false;
  let frameId = 0;
  let last = 0;
  let t = 0;
  let speed = 1;
  function kick() {
    if (!running && visible) { running = true; last = performance.now(); frameId = requestAnimationFrame(frame); }
  }
  function frame(now: number) {
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.05)); // the first frame's timestamp can precede kick()
    last = now;
    speed += ((hovered ? TUNE.hoverSlow : 1) - speed) * 0.08;
    if (!reduceMotion) t += dt;
    controls.autoRotateSpeed = TUNE.autoRotate * speed;
    if (intro < 1) {
      intro = Math.min(1, intro + dt / TUNE.introSeconds);
      const eased = 1 - Math.pow(1 - intro, 3);
      const az = controls.getAzimuthalAngle();
      introEnd.copy(target).add(new THREE.Vector3(Math.sin(az) * TUNE.distance, TUNE.height, Math.cos(az) * TUNE.distance));
      camera.position.lerpVectors(introStart, introEnd, eased);
    }
    controls.update(dt);

    core.position.y = 1.3 + Math.sin(t * 1.1) * 0.06;
    gate.rotation.z = t * 0.4;
    gate.rotation.y = Math.sin(t * 0.5) * 0.25;
    for (const s of streams) s(t);
    for (const wave of waves) {
      const p = (t / 3.2 + wave.offset) % 1;
      wave.ring.scale.setScalar(0.4 + p * 3.4);
      (wave.ring.material as THREE.MeshBasicMaterial).opacity = reduceMotion ? 0 : (1 - p) * (1 - p) * 0.55;
    }
    if (!reduceMotion) {
      for (let i = 0; i < DUST; i++) {
        dustPos[i * 3 + 1] += Math.sin(t * 0.4 + dustSeed[i]) * 0.0016;
        dustPos[i * 3] += Math.cos(t * 0.3 + dustSeed[i]) * 0.0012;
      }
      dustGeo.attributes.position.needsUpdate = true;
    }

    let settling = false;
    for (const [agentKey, a] of agents) {
      const ht = hovered === agentKey ? 1 : 0;
      const st = selected === agentKey ? 1 : 0;
      a.hover += (ht - a.hover) * 0.16;
      a.sel += (st - a.sel) * 0.12;
      if (Math.abs(a.hover - ht) > 1e-3 || Math.abs(a.sel - st) > 1e-3) settling = true;
      a.group.scale.setScalar(1 + a.hover * 0.06 + a.sel * 0.03);
      a.glow.emissiveIntensity = a.base * (1 + 0.18 * Math.sin(t * 1.6 + a.phase)) + a.hover * 1.4 + a.sel * 0.7;
    }
    for (const [labelKey, el] of labels) {
      if (labelKey === 'centre') {
        core.getWorldPosition(tmp);
        tmp.y -= 0.62;
      } else {
        const a = agents.get(labelKey)!;
        a.group.getWorldPosition(tmp);
        tmp.y += a.lift;
      }
      tmp.project(camera);
      el.style.opacity = tmp.z < 1 ? '1' : '0';
      el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * width}px, ${(-tmp.y * 0.5 + 0.5) * height}px) translate(-50%, ${labelKey === 'centre' ? '0' : '-100%'})`;
      el.dataset.selected = selected === labelKey ? 'true' : 'false';
    }
    composer.render(dt);
    // With reduced motion the scene draws only while something is settling or being dragged.
    if (visible && (!reduceMotion || settling || dragging || intro < 1)) frameId = requestAnimationFrame(frame);
    else running = false;
  }

  const onContextLost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frameId); running = false; };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);

  resize();
  kick();

  return {
    focus(agent) { selected = agent; kick(); },
    dispose() {
      cancelAnimationFrame(frameId);
      running = false;
      visible = false;
      window.clearTimeout(resumeTimer);
      resizeObserver.disconnect();
      visibility.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      mirror.getRenderTarget().dispose();
      (mirror.material as THREE.Material).dispose();
      composer.dispose();
      bloom.dispose();
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      for (const el of labels.values()) el.remove();
      tip.remove();
    },
  };
}
