import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputShader } from 'three/examples/jsm/shaders/OutputShader.js';

// Getting a scene ready to draw without freezing the page. Two things stall a first frame:
// - Three waits for the driver to finish each shader program the first time it draws with it: about 1.8 s of
//   frozen main thread for the committee on a cold shader cache. With KHR_parallel_shader_compile the driver
//   compiles on its own thread and reports when it is done, so every program is compiled and polled up front.
// - The GPU builds a pipeline for each program and target the first time it draws them, which holds back every
//   frame of the page (about 0.7 s in one go). Drawing the scene offscreen one object per frame spreads that out.
// Without the extension programs report ready at once and the first draws compile them, as before.

export interface Pipeline {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
}

interface Job {
  object: THREE.Object3D;
  camera: THREE.Camera;
  // The target the object will be drawn into: on-screen shaders differ from render-target ones.
  target: THREE.WebGLRenderTarget | null;
  // The scene whose lights the shaders are built for.
  lights?: THREE.Scene;
  // The shadow pass draws with the scene's lights but not its fog.
  withoutFog?: boolean;
}

type Alive = () => boolean;

const flatCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
// A driver that never reports its shaders ready would leave the stage an empty box: past this, warm-up gives up
// and the page shows the text version instead.
export const WARM_UP_DEADLINE_MS = 8000;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function compile(renderer: THREE.WebGLRenderer, jobs: Job[], alive: Alive): Promise<void> {
  const previous = renderer.getRenderTarget();
  for (const { object, camera, target, lights, withoutFog } of jobs) {
    const fog = lights?.fog ?? null;
    if (lights && withoutFog) lights.fog = null;
    renderer.setRenderTarget(target);
    renderer.compile(object, camera, lights);
    if (lights) lights.fog = fog;
  }
  renderer.setRenderTarget(previous);
  // Every program the renderer holds, not each material's latest only: a two-sided transparent material gets a
  // program per side. isReady is missing from three's published types.
  const programs = (renderer.info.programs ?? []) as unknown as { isReady(): boolean; getUniforms(): unknown }[];
  const deadline = performance.now() + WARM_UP_DEADLINE_MS;
  return new Promise((resolve, reject) => {
    const check = () => {
      // A disposed scene's context never reports ready, so polling stops with it.
      if (!alive()) return resolve();
      if (renderer.getContext().isContextLost()) return reject(new Error('WebGL context lost while compiling shaders'));
      if (programs.some((program) => !program.isReady())) {
        if (performance.now() > deadline) return reject(new Error('Shaders not ready before the warm-up deadline'));
        return void window.setTimeout(check, 16);
      }
      // Reading a program's uniforms waits for the driver to finish it: quick once it reports ready, a freeze on
      // first use inside a frame.
      for (const program of programs) program.getUniforms();
      resolve();
    };
    check();
  });
}

// The studio lighting both scenes reflect, baked into an environment map once the room's shaders are compiled.
async function roomEnvironment(renderer: THREE.WebGLRenderer, alive: Alive): Promise<THREE.Texture | null> {
  const room = new RoomEnvironment();
  const probe = new THREE.WebGLRenderTarget(1, 1);
  try {
    await compile(renderer, [{ object: room, camera: new THREE.PerspectiveCamera(90, 1, 0.1, 100), target: probe }], alive);
    if (!alive()) return null;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose();
    return envMap;
  } finally {
    probe.dispose();
    room.dispose();
  }
}

// Draws the scene offscreen, adding one object per frame, until all of it has been drawn once.
async function drawPieceByPiece({ renderer, scene, camera, composer }: Pipeline, alive: Alive) {
  const pieces: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh || (object as THREE.Points).isPoints || (object as THREE.Line).isLine || (object as THREE.Sprite).isSprite) {
      if (object.visible) pieces.push(object);
    }
  });
  for (const piece of pieces) piece.visible = false;
  try {
    for (const piece of pieces) {
      if (!alive()) return;
      if (renderer.getContext().isContextLost()) throw new Error('WebGL context lost while drawing the scene');
      piece.visible = true;
      renderer.setRenderTarget(composer.readBuffer);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      await nextFrame();
    }
  } finally {
    for (const piece of pieces) piece.visible = true;
  }
}

// Bakes the environment into scene.environment, compiles every shader one frame uses, then draws the scene once
// offscreen piece by piece. Resolves to stand-in materials the caller disposes with the scene, or null when the
// scene was disposed first. Rejects when the context is lost or the shaders miss the deadline.
export async function prepareScene(pipeline: Pipeline, alive: Alive): Promise<{ dispose(): void } | null> {
  const { renderer, scene, camera, composer, bloom } = pipeline;
  const envMap = await roomEnvironment(renderer, alive);
  if (!envMap) return null;
  scene.environment = envMap;

  // Shaders that belong to no mesh (the shadow map's depth pass, bloom, the output pass) go on stand-in quads.
  // They share their compiled programs with the real passes, so they live as long as the scene.
  const quad = new THREE.PlaneGeometry(2, 2);
  const on = (...materials: THREE.Material[]) => {
    const group = new THREE.Group();
    for (const material of materials) group.add(new THREE.Mesh(quad, material));
    return group;
  };
  // The shadow map draws front-faced casters with their back faces.
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.BackSide });
  // The defines OutputPass sets on its first render for sRGB output with neutral tone mapping, in the same order.
  const output = new THREE.RawShaderMaterial({ ...OutputShader, defines: { SRGB_TRANSFER: '', NEUTRAL_TONE_MAPPING: '' } });
  const standIns = {
    dispose() {
      envMap.dispose();
      quad.dispose();
      depth.dispose();
      output.dispose();
    },
  };
  const offscreen = composer.readBuffer;
  try {
    await compile(renderer, [
      { object: scene, camera, target: offscreen },
      { object: on(depth), camera: flatCamera, target: offscreen, lights: scene, withoutFog: true },
      { object: on(bloom.materialHighPassFilter, ...bloom.separableBlurMaterials, bloom.compositeMaterial, bloom.blendMaterial), camera: flatCamera, target: offscreen },
      { object: on(output), camera: flatCamera, target: null },
    ], alive);
    await drawPieceByPiece(pipeline, alive);
  } catch (error) {
    standIns.dispose();
    throw error;
  }
  if (alive()) return standIns;
  standIns.dispose();
  return null;
}
