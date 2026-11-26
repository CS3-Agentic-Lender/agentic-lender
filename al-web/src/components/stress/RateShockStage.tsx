import { useEffect, useRef, useState } from 'react';
import { canDraw3d, startWhenNearAndIdle } from '../lending/council/canDraw3d';
import type { ShockedApplication } from '../../services/stressService';
import type { RateShockHandle, TowerDatum } from './rateShockScene';

interface RateShockStageProps {
  // The shocked applications, worst first; empty before the first answer arrives.
  applications: ShockedApplication[];
  // Called with an application id when its tower is clicked.
  onSelect(applicationId: string): void;
}

export function towersFrom(applications: ShockedApplication[]): TowerDatum[] {
  return applications.map((application) => ({
    applicationId: application.applicationId,
    beforeDtiPct: application.before.dtiPct,
    afterDtiPct: application.after.dtiPct,
    band: application.after.band,
  }));
}

const legend = [
  { band: 'Comfortable', swatch: 'bg-vote-approve' },
  { band: 'Caution', swatch: 'bg-vote-conditional' },
  { band: 'Adverse', swatch: 'bg-vote-decline' },
] as const;

// The portfolio under the shock as a 3D stage, built like the loan file's committee and chain stages. Three.js
// loads only when the card is close to the screen and the browser is idle. Without WebGL the card is left out; the
// charts and the table carry the same facts.
export function RateShockStage({ applications, onSelect }: RateShockStageProps) {
  const [supported] = useState(canDraw3d);
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<RateShockHandle | null>(null);
  const towersRef = useRef<TowerDatum[]>(towersFrom(applications));
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    towersRef.current = towersFrom(applications);
    handleRef.current?.update(towersRef.current);
  }, [applications]);

  useEffect(() => {
    const host = hostRef.current;
    if (!supported || failed || !host) return;
    let cancelled = false;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const cancelStart = startWhenNearAndIdle(host, () => {
      import('./rateShockScene')
        .then(({ createRateShockScene }) => {
          if (cancelled) return;
          const handle = createRateShockScene(host, {
            reduceMotion,
            onContextLost: () => setFailed(true),
            onSelect: (id) => selectRef.current(id),
          });
          handle.update(towersRef.current);
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
  }, [supported, failed]);

  if (!supported || failed) return null;

  return (
    <section
      aria-labelledby="shock-stage-heading"
      className="card"
    >
      <h2
        className="card-title"
        id="shock-stage-heading"
      >
        Portfolio under the shock
      </h2>
      <p className="mt-1 text-base text-muted">
        Each tower is one application, as tall as its debt to income after the shock. Click a tower to see its row.
      </p>
      <div
        aria-hidden="true"
        className="council-stage relative mt-4 h-80 overflow-hidden rounded-xl bg-night sm:h-[26rem]"
        data-testid="shock-stage"
      >
        <div
          className="absolute inset-0"
          ref={hostRef}
        />
        <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(110%_85%_at_50%_40%,color-mix(in_srgb,var(--color-brass)_10%,transparent)_0%,transparent_45%,rgb(0_0_0/0.45)_100%)]" />
        {applications.length === 0 ? (
          <p className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center text-base text-tint/80">
            The towers appear once the shock is calculated.
          </p>
        ) : null}
        <ul className="pointer-events-none absolute top-4 left-5 z-[2] flex flex-wrap gap-x-4 gap-y-1 text-[15px] text-tint/85">
          {legend.map(({ band, swatch }) => (
            <li
              className="inline-flex items-center gap-2"
              key={band}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${swatch}`} />
              {band}
            </li>
          ))}
        </ul>
        <p className="pointer-events-none absolute right-4 bottom-4 z-[2] rounded-lg bg-night/70 px-3 py-1 text-[15px] text-tint/80 max-sm:hidden">
          Drag to turn it &middot; click a tower to see its row
        </p>
      </div>
    </section>
  );
}
