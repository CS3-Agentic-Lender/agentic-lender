import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shockFixture } from './rateShockFixture';
import { RateShockStage, towersFrom } from './RateShockStage';

// jsdom has no WebGL, layout or idle callbacks: the test stands in for the browser's answers and drives them.
const scene = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), dispose: vi.fn(), select: null as ((id: string) => void) | null }));
vi.mock('./rateShockScene', () => ({
  createRateShockScene: (host: HTMLElement, options: { onSelect?(id: string): void }) => {
    scene.create(host, options);
    scene.select = options.onSelect ?? null;
    return { update: scene.update, dispose: scene.dispose };
  },
}));
const draw = vi.hoisted(() => ({ supported: true }));
vi.mock('../lending/council/canDraw3d', async (original) => ({
  ...(await original<typeof import('../lending/council/canDraw3d')>()),
  canDraw3d: () => draw.supported,
}));

let nearScreen: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
let idle: (() => void) | null = null;

beforeEach(() => {
  scene.create.mockClear();
  scene.update.mockClear();
  scene.dispose.mockClear();
  scene.select = null;
  draw.supported = true;
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

async function startScene() {
  act(() => nearScreen?.([{ isIntersecting: true }]));
  await act(async () => { idle?.(); });
  await vi.waitFor(() => expect(scene.create).toHaveBeenCalledOnce());
}

describe('rate shock stage', () => {
  const applications = shockFixture().applications;

  it('leaves the card out without WebGL, so the charts and table carry the facts', () => {
    draw.supported = false;
    render(<RateShockStage applications={applications} onSelect={() => {}} />);

    expect(screen.queryByRole('heading', { name: 'Portfolio under the shock' })).not.toBeInTheDocument();
  });

  it('shows the empty state and no towers before any result', async () => {
    render(<RateShockStage applications={[]} onSelect={() => {}} />);

    expect(screen.getByText('The towers appear once the shock is calculated.')).toBeInTheDocument();
    await startScene();
    expect(scene.update).toHaveBeenLastCalledWith([]);
  });

  it('builds one tower per application from the stored figures after the shock', async () => {
    render(<RateShockStage applications={applications} onSelect={() => {}} />);
    await startScene();

    expect(scene.update).toHaveBeenLastCalledWith(towersFrom(applications));
    expect(towersFrom(applications)[0]).toEqual({
      applicationId: applications[0].applicationId,
      beforeDtiPct: applications[0].before.dtiPct,
      afterDtiPct: applications[0].after.dtiPct,
      band: applications[0].after.band,
    });
  });

  it('passes a clicked tower on as its application id, and frees the scene when it leaves', async () => {
    const onSelect = vi.fn();
    const { unmount } = render(<RateShockStage applications={applications} onSelect={onSelect} />);
    await startScene();

    act(() => scene.select?.(applications[1].applicationId));
    expect(onSelect).toHaveBeenCalledWith(applications[1].applicationId);
    unmount();
    expect(scene.dispose).toHaveBeenCalledOnce();
  });
});
