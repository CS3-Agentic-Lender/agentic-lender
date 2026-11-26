import { useEffect, useRef, useState, type ReactNode } from 'react';
import { canDraw3d, startWhenNearAndIdle } from '../lending/council/canDraw3d';
import type { DownturnApplication, LtvFigures, AffordabilityBand } from '../../services/stressService';
import type { HousePriceHandle, StageState, TowerDatum } from './housePriceScene';

interface HousePriceStageProps {
  // The price fall controls. They sit in the stage's dark panel and always render, with or without the 3D view.
  controls: ReactNode;
  // The shocked applications of the result on screen; empty before the first answer arrives.
  applications: DownturnApplication[];
  // The latest run failed, so the towers drop and dim.
  failing: boolean;
  // Called with an application id when its tower is clicked.
  onSelect(applicationId: string): void;
}

export function ltvBand(figures: LtvFigures): AffordabilityBand {
  return figures.above_90 ? 'Adverse' : figures.above_80 ? 'Caution' : 'Comfortable';
}

export function towersFrom(applications: DownturnApplication[]): TowerDatum[] {
  return applications.map((application) => ({
    applicationId: application.application_id,
    beforeLtvPct: application.before.ltv_pct,
    beforeBand: ltvBand(application.before),
    afterLtvPct: application.after.ltv_pct,
    band: ltvBand(application.after),
  }));
}

const legend = [
  { band: 'Under 80%', swatch: 'bg-vote-approve' },
  { band: 'Over 80%', swatch: 'bg-vote-conditional' },
  { band: 'Over 90%', swatch: 'bg-vote-decline' },
] as const;

// The price fall hero: one big dark stage with the portfolio as rising glass towers, and the controls docked on its
// left (above it below 900px). Three.js loads only when the stage is close to the screen and the browser is idle.
// Without WebGL, or when the context is lost, only the 3D view is left out: the controls stay, and the table below
// carries every figure.
export function HousePriceStage({ controls, applications, failing, onSelect }: HousePriceStageProps) {
  const [supported] = useState(canDraw3d);
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HousePriceHandle | null>(null);
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
      import('./housePriceScene')
        .then(({ createHousePriceScene }) => {
          if (cancelled) return;
          const handle = createHousePriceScene(host, {
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
      data-testid="house-price-controls"
      ref={dockRef}
    >
      {controls}
    </div>
  );

  if (!show3d) {
    return (
      <section
        aria-label="House price fall stage"
        className="mt-8 grid items-center gap-6 rounded-[22px] bg-night p-4 text-tint shadow-raised sm:p-6 min-[900px]:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]"
        data-testid="house-price-stage-card"
      >
        {panel}
        <p className="text-base text-tint/85">3D view unavailable — figures are in the table below.</p>
      </section>
    );
  }

  return (
    <section
      aria-label="House price fall stage"
      className="relative mt-8 grid gap-5"
      data-testid="house-price-stage-card"
    >
      {panel}
      {/* Decorative: every figure the stage draws is in the table, so it is hidden from assistive technology. */}
      <div
        aria-hidden="true"
        className="council-stage shock-stage relative h-[420px] overflow-hidden rounded-[22px] border border-tint/10 bg-night shadow-raised max-sm:h-[400px] min-[900px]:h-[520px]"
        data-failing={failing ? 'true' : undefined}
        data-testid="house-price-stage"
      >
        <div
          className="absolute inset-0"
          ref={hostRef}
        />
        <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(110%_85%_at_60%_40%,color-mix(in_srgb,var(--color-vote-approve)_12%,transparent)_0%,transparent_45%,color-mix(in_srgb,var(--color-night)_45%,transparent)_100%)]" />
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
          <li className="text-vote-observer">Height = LTV after the fall</li>
        </ul>
        <p className="pointer-events-none absolute right-4 bottom-3.5 z-[2] m-0 rounded-[10px] bg-night/70 px-3 py-1.5 text-base text-tint/80 max-[899px]:hidden">
          Drag to turn it &middot; click a tower to see its row
        </p>
      </div>
    </section>
  );
}
