import { useEffect, useRef, useState, type ReactNode } from 'react';
import { canDraw3d, startWhenNearAndIdle } from '../lending/council/canDraw3d';
import type { ShockedApplication } from '../../services/stressService';
import type { RateShockHandle, StageState, TowerDatum } from './rateShockScene';

interface RateShockStageProps {
  // The rate shock controls. They sit in the stage's dark panel and always render, with or without the 3D view.
  controls: ReactNode;
  // The shocked applications of the result on screen; empty before the first answer arrives.
  applications: ShockedApplication[];
  // The latest run failed, so the towers drop and dim.
  failing: boolean;
  // Called with an application id when its tower is clicked.
  onSelect(applicationId: string): void;
}

export function towersFrom(applications: ShockedApplication[]): TowerDatum[] {
  return applications.map((application) => ({
    applicationId: application.applicationId,
    beforeDtiPct: application.before.dtiPct,
    beforeBand: application.before.band,
    afterDtiPct: application.after.dtiPct,
    band: application.after.band,
  }));
}

const legend = [
  { band: 'Comfortable', swatch: 'bg-vote-approve' },
  { band: 'Caution', swatch: 'bg-vote-conditional' },
  { band: 'Adverse', swatch: 'bg-vote-decline' },
] as const;

// The rate shock hero: one big dark stage with the portfolio as rising glass towers, and the controls docked on its
// left (above it below 900px). Three.js loads only when the stage is close to the screen and the browser is idle.
// Without WebGL, or when the context is lost, only the 3D view is left out: the controls stay, and the table below
// carries every figure.
export function RateShockStage({ controls, applications, failing, onSelect }: RateShockStageProps) {
  const [supported] = useState(canDraw3d);
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<RateShockHandle | null>(null);
  const stateRef = useRef<StageState>({ towers: towersFrom(applications), failing });
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const show3d = supported && !failed;

  useEffect(() => {
    stateRef.current = { towers: towersFrom(applications), failing };
    handleRef.current?.update(stateRef.current);
  }, [applications, failing]);

  useEffect(() => {
    const host = hostRef.current;
    if (!show3d || !host) return;
    let cancelled = false;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const cancelStart = startWhenNearAndIdle(host, () => {
      import('./rateShockScene')
        .then(({ createRateShockScene }) => {
          if (cancelled) return;
          const handle = createRateShockScene(host, {
            reduceMotion,
            dock: dockRef.current,
            onContextLost: () => setFailed(true),
            onSelect: (id) => selectRef.current(id),
          });
          handle.update(stateRef.current);
          handleRef.current = handle;
        })
        .catch(() => { if (!cancelled) setFailed(true); });
    });
    return () => {
      cancelled = true;
      cancelStart();
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  // A failed scene turns `failed` on, which runs the cleanup above and disposes it.
  }, [show3d]);

  const panel = (
    <div
      className={`rounded-[20px] border border-tint/15 bg-night p-6 text-tint shadow-raised ${
        show3d ? 'min-[900px]:absolute min-[900px]:top-5 min-[900px]:left-5 min-[900px]:z-[3] min-[900px]:w-[21rem] min-[900px]:bg-night/60 min-[900px]:backdrop-blur-[14px]' : ''
      }`}
      data-testid="shock-controls"
      ref={dockRef}
    >
      {controls}
    </div>
  );

  if (!show3d) {
    return (
      <section
        aria-label="Rate shock stage"
        className="mt-8 grid items-center gap-6 rounded-[22px] bg-night p-4 text-tint shadow-raised sm:p-6 min-[900px]:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]"
        data-testid="shock-stage-card"
      >
        {panel}
        <p className="text-base text-tint/85">3D view unavailable — figures are in the table below.</p>
      </section>
    );
  }

  return (
    <section
      aria-label="Rate shock stage"
      className="relative mt-8 grid gap-5"
      data-testid="shock-stage-card"
    >
      {panel}
      {/* Decorative: every figure the stage draws is in the table, so it is hidden from assistive technology. */}
      <div
        aria-hidden="true"
        className="council-stage shock-stage relative h-[420px] overflow-hidden rounded-[22px] border border-tint/10 bg-night shadow-[0_30px_60px_-36px_rgb(0_0_0/0.8)] max-sm:h-[400px] min-[900px]:h-[520px]"
        data-failing={failing ? 'true' : undefined}
        data-testid="shock-stage"
      >
        <div
          className="absolute inset-0"
          ref={hostRef}
        />
        <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(110%_85%_at_60%_40%,color-mix(in_srgb,var(--color-vote-approve)_12%,transparent)_0%,transparent_45%,rgb(0_0_0/0.45)_100%)]" />
        <ul className="pointer-events-none absolute bottom-3.5 left-4 z-[2] m-0 flex max-w-[calc(100%-2rem)] list-none flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-[10px] bg-night/70 px-3 py-1.5 text-base text-tint min-[900px]:top-4 min-[900px]:right-4 min-[900px]:bottom-auto min-[900px]:left-auto min-[900px]:max-w-none">
          {legend.map(({ band, swatch }) => (
            <li
              className="inline-flex items-center gap-2"
              key={band}
            >
              <span className={`size-2 flex-none rounded-full ${swatch}`} />
              {band}
            </li>
          ))}
          <li className="text-vote-observer">Height = debt to income after the rise</li>
        </ul>
        <p className="pointer-events-none absolute right-4 bottom-3.5 z-[2] m-0 rounded-[10px] bg-night/70 px-3 py-1.5 text-base text-tint/80 max-[899px]:hidden">
          Drag to turn it &middot; click a tower to see its row
        </p>
      </div>
    </section>
  );
}
