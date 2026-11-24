import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCommitteeRun } from '../../services/committeeService';
import { CommitteeStage } from './CommitteeStage';

// jsdom has no WebGL, layout or idle callbacks: the test stands in for the browser's answers and drives them.
const scene = vi.hoisted(() => ({ create: vi.fn(), dispose: vi.fn() }));
vi.mock('./council/councilScene', () => ({
  createCouncilScene: (...args: unknown[]) => {
    scene.create(...args);
    return { focus: vi.fn(), dispose: scene.dispose };
  },
}));
vi.mock('./council/canDraw3d', async (original) => ({
  ...(await original<typeof import('./council/canDraw3d')>()),
  canDraw3d: () => true,
}));

let nearScreen: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
let idle: (() => void) | null = null;

beforeEach(() => {
  scene.create.mockClear();
  scene.dispose.mockClear();
  nearScreen = null;
  idle = null;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { nearScreen = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => { idle = callback; return 1; });
  vi.stubGlobal('cancelIdleCallback', () => { idle = null; });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const run = toCommitteeRun('run-LN-1001', {
  applicationId: 'LN-1001', status: 'complete', effectiveRecommendation: 'Approve',
  consensus: { votes: { affordability: 'Approve', valuation: 'Approve', strategist: 'Approve' } },
});

function stage() {
  return document.querySelector('.council-stage');
}

describe('committee stage', () => {
  it('holds its full size and caption before the 3D scene exists', () => {
    render(<CommitteeStage onPick={() => {}} run={run} selected={null} />);

    expect(stage()).toHaveClass('h-[460px]', 'sm:h-[500px]');
    expect(stage()).toHaveTextContent('AI committee · run complete');
    expect(stage()).toHaveTextContent('Approve');
    expect(scene.create).not.toHaveBeenCalled();
  });

  it('starts the scene only once it is near the screen and the browser is idle', async () => {
    render(<CommitteeStage onPick={() => {}} run={run} selected={null} />);

    act(() => nearScreen?.([{ isIntersecting: false }]));
    expect(idle).toBeNull();
    act(() => nearScreen?.([{ isIntersecting: true }]));
    expect(scene.create).not.toHaveBeenCalled();

    await act(async () => { idle?.(); });
    await vi.waitFor(() => expect(scene.create).toHaveBeenCalledOnce());
    expect(scene.create.mock.calls[0][0]).toBe(stage()?.firstElementChild);
  });

  it('never starts a scene it left before idle came, and frees one it started', async () => {
    const { unmount } = render(<CommitteeStage onPick={() => {}} run={run} selected={null} />);
    act(() => nearScreen?.([{ isIntersecting: true }]));
    unmount();
    expect(idle).toBeNull();
    expect(scene.create).not.toHaveBeenCalled();

    const second = render(<CommitteeStage onPick={() => {}} run={run} selected={null} />);
    act(() => nearScreen?.([{ isIntersecting: true }]));
    await act(async () => { idle?.(); });
    await vi.waitFor(() => expect(scene.create).toHaveBeenCalledOnce());
    second.unmount();
    expect(scene.dispose).toHaveBeenCalledOnce();
  });

  it('frees a scene that fails and leaves the page text to carry the run', async () => {
    render(<CommitteeStage onPick={() => {}} run={run} selected={null} />);
    act(() => nearScreen?.([{ isIntersecting: true }]));
    await act(async () => { idle?.(); });
    await vi.waitFor(() => expect(scene.create).toHaveBeenCalledOnce());
    const { onContextLost } = scene.create.mock.calls[0][2] as { onContextLost(): void };

    act(() => onContextLost());

    expect(stage()).toBeNull();
    expect(scene.dispose).toHaveBeenCalledOnce();
  });

  it('leaves the page text to carry the run when WebGL is missing', async () => {
    vi.resetModules();
    vi.doMock('./council/canDraw3d', async (original) => ({
      ...(await original<typeof import('./council/canDraw3d')>()),
      canDraw3d: () => false,
    }));
    const { CommitteeStage: WithoutWebGl } = await import('./CommitteeStage');
    render(<WithoutWebGl onPick={() => {}} run={run} selected={null} />);

    expect(stage()).toBeNull();
    expect(screen.queryByText('AI committee · run complete')).toBeNull();
  });
});
