import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareScene, WARM_UP_DEADLINE_MS, type Pipeline } from './warmUp';

// jsdom has no WebGL: a stand-in renderer whose shader programs report ready, or not, as each test says.
const disposed = vi.hoisted(() => [] as string[]);
vi.mock('three', async (original) => ({
  ...(await original<typeof import('three')>()),
  WebGLRenderTarget: class { dispose() {} },
  PMREMGenerator: class {
    fromScene() { return { texture: { dispose: () => disposed.push('environment') } }; }
    dispose() {}
  },
}));
vi.mock('three/examples/jsm/environments/RoomEnvironment.js', () => ({
  RoomEnvironment: class extends THREE.Scene { dispose() {} },
}));

function fakePipeline({ ready, contextLost }: { ready: () => boolean; contextLost: () => boolean }) {
  disposed.length = 0;
  const renderer = {
    info: { programs: [{ isReady: ready, getUniforms: () => ({}) }] },
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    compile: () => {},
    render: () => {},
    getContext: () => ({ isContextLost: contextLost }),
  };
  const material = () => new THREE.MeshBasicMaterial();
  const pipeline = {
    renderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    composer: { readBuffer: null },
    bloom: { materialHighPassFilter: material(), separableBlurMaterials: [material()], compositeMaterial: material(), blendMaterial: material() },
  } as unknown as Pipeline;
  return { pipeline };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('scene warm-up', () => {
  it('gives up and frees what it made when the context is lost while shaders compile', async () => {
    let lost = false;
    let compiled = false;
    const { pipeline } = fakePipeline({ ready: () => compiled, contextLost: () => lost });
    compiled = true;
    const prepared = prepareScene(pipeline, () => true);
    compiled = false;
    lost = true;
    const outcome = expect(prepared).rejects.toThrow('context lost');
    await vi.advanceTimersByTimeAsync(100);

    await outcome;
    expect(disposed).toEqual(['environment']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up when the driver never reports the shaders ready', async () => {
    const { pipeline } = fakePipeline({ ready: () => false, contextLost: () => false });
    const prepared = prepareScene(pipeline, () => true);
    const outcome = expect(prepared).rejects.toThrow('deadline');
    await vi.advanceTimersByTimeAsync(WARM_UP_DEADLINE_MS + 100);

    await outcome;
    expect(disposed).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
