import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shockFixture } from './rateShockFixture';
import { RateShockStage, towersFrom } from './RateShockStage';

// jsdom has no WebGL, layout or idle callbacks: the test stands in for the browser's answers and drives them.
const scene = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  dispose: vi.fn(),
  select: null as ((id: string) => void) | null,
  lose: null as (() => void) | null,
}));
vi.mock('./rateShockScene', () => ({
  createRateShockScene: (host: HTMLElement, options: { onSelect?(id: string): void; onContextLost?(): void }) => {
    scene.create(host, options);
    scene.select = options.onSelect ?? null;
    scene.lose = options.onContextLost ?? null;
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
  scene.lose = null;
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

const controls = <button type="button">Recalculate</button>;

describe('rate shock stage', () => {
  const applications = shockFixture().applications;

  it('puts the controls inside the stage card, docked beside the 3D view', () => {
    render(<RateShockStage applications={applications} controls={controls} failing={false} onSelect={() => {}} />);

    const card = screen.getByRole('region', { name: 'Rate shock stage' });
    expect(card).toContainElement(screen.getByRole('button', { name: 'Recalculate' }));
    expect(card).toContainElement(screen.getByTestId('shock-stage'));
    expect(screen.getByTestId('shock-stage')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the controls without WebGL and leaves only the 3D view out', () => {
    draw.supported = false;
    render(<RateShockStage applications={applications} controls={controls} failing={false} onSelect={() => {}} />);

    expect(screen.getByRole('button', { name: 'Recalculate' })).toBeInTheDocument();
    expect(screen.getByText('3D view unavailable — figures are in the table below.')).toBeInTheDocument();
    expect(screen.queryByTestId('shock-stage')).not.toBeInTheDocument();
  });

  it('falls back to the controls alone when the WebGL context is lost', async () => {
    render(<RateShockStage applications={applications} controls={controls} failing={false} onSelect={() => {}} />);
    await startScene();

    act(() => scene.lose?.());
    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('shock-stage')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recalculate' })).toBeInTheDocument();
    expect(screen.getByText('3D view unavailable — figures are in the table below.')).toBeInTheDocument();
  });

  it('starts as an empty stage, with no towers, before any result', async () => {
    render(<RateShockStage applications={[]} controls={controls} failing={false} onSelect={() => {}} />);
    await startScene();

    expect(scene.update).toHaveBeenLastCalledWith({ towers: [], failing: false });
  });

  it('builds one tower per application from the figures before and after the shock', async () => {
    render(<RateShockStage applications={applications} controls={controls} failing={false} onSelect={() => {}} />);
    await startScene();

    expect(scene.update).toHaveBeenLastCalledWith({ towers: towersFrom(applications), failing: false });
    expect(towersFrom(applications)[1]).toEqual({
      applicationId: 'LN-1002',
      beforeDtiPct: 38,
      beforeBand: 'Comfortable',
      afterDtiPct: 44,
      band: 'Caution',
    });
  });

  it('tells the scene when a run fails, so the towers drop and dim', async () => {
    const { rerender } = render(<RateShockStage applications={applications} controls={controls} failing={false} onSelect={() => {}} />);
    await startScene();

    rerender(<RateShockStage applications={applications} controls={controls} failing onSelect={() => {}} />);
    expect(scene.update).toHaveBeenLastCalledWith({ towers: towersFrom(applications), failing: true });
    expect(screen.getByTestId('shock-stage')).toHaveAttribute('data-failing', 'true');
  });

  it('passes a clicked tower on as its application id, and frees the scene when it leaves', async () => {
    const onSelect = vi.fn();
    const { unmount } = render(<RateShockStage applications={applications} controls={controls} failing={false} onSelect={onSelect} />);
    await startScene();

    act(() => scene.select?.(applications[1].applicationId));
    expect(onSelect).toHaveBeenCalledWith(applications[1].applicationId);
    unmount();
    expect(scene.dispose).toHaveBeenCalledOnce();
  });
});
