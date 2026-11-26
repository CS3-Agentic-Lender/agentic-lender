import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { PortalHeader } from '../../components/PortalHeader';
import { HousePriceStage } from '../../components/stress/HousePriceStage';
import { DownturnResultsTable, downturnRowId } from '../../components/stress/DownturnResultsTable';
import { useStressService } from '../../context/StressContext';
import { ApiError } from '../../services/apiClient';
import { FALL_MIN, FALL_MAX, FALL_STEP, type DownturnResult } from '../../services/stressService';
import { formatEuro } from '../../utils/formatters';
import { loanFilePath } from './PipelinePage';

export const DEFAULT_FALL = 10;
export const RUN_DELAY_MS = 300;
export const PRESET_FALLS = [0, 10, 20, 30, 40] as const;
export const fallLabel = (fall: number) => fall === 0 ? '0%' : `\u2212${fall}%`;
const wrap = 'mx-auto w-full max-w-6xl px-4 sm:px-6';
interface Shown { result: DownturnResult; serverMs: number }
interface Pending { fallPct: number; withSkeleton: boolean }
interface Failure { fallPct: number; message: string }
function failureMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return 'This account is not allowed to run portfolio stress tests. Only underwriters can.';
  return error instanceof Error && error.message ? error.message : 'The price fall could not be calculated. Try again.';
}
function Skeleton({ lines = 0 }: { lines?: number }) {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 z-[4] rounded-[inherit] shock-skeleton-light"
      data-testid="skeleton"
    >
      {lines > 0 ? (
        <div className="absolute inset-[22px] grid content-start gap-3.5">
          {Array.from({ length: lines }, (_, index) => (
            <i
              className="block h-3.5 rounded-full bg-line first:h-5 first:w-2/5 even:w-[86%]"
              key={index}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Tile({
  label,
  value,
  detail,
  tone = 'plain',
  loading,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'plain' | 'warn' | 'brass';
  loading: boolean;
}) {
  const valueColour = tone === 'warn' ? 'text-error' : tone === 'brass' ? 'text-brass-ink' : 'text-ink';
  return (
    <div className="relative m-0 overflow-hidden rounded-2xl border border-line bg-surface px-5 py-4.5 shadow-card">
      {loading ? <Skeleton /> : null}
      <dt className="font-mono text-base tracking-[0.08em] text-muted uppercase">{label}</dt>
      <dd className="mt-2">
        <span
          className={`block animate-rise font-mono text-[2rem] leading-tight font-semibold tabular-nums ${valueColour}`}
          key={value}
        >
          {value}
        </span>
        <span className="mt-1.5 block text-base text-muted">{detail}</span>
      </dd>
    </div>
  );
}

function FailureNotice({ failure, shown, onRetry }: {
  failure: Failure;
  shown: Shown | null;
  onRetry: () => void;
}) {
  return (
    <div
      className="mb-6 grid animate-rise grid-cols-[auto_minmax(0,1fr)] gap-3.5 rounded-2xl border border-error bg-danger-soft px-5 py-4.5 text-ink shadow-card"
      role="alert"
    >
      <span
        aria-hidden="true"
        className="grid size-9 place-items-center rounded-full bg-danger-soft font-mono font-semibold text-error"
      >
        !
      </span>
      <div>
        <h2 className="text-lg font-semibold text-ink">
          The {fallLabel(failure.fallPct)} price fall could not be calculated.
        </h2>
        <p className="mt-1">{failure.message}</p>
        {shown ? (
          <p className="mt-1">The figures below are still the last result, for {fallLabel(shown.result.fall_pct)}.</p>
        ) : null}
        {/* The notice closes as soon as the retry starts; onRetry moves focus to Recalculate first. */}
        <button
          className="btn btn-secondary mt-3"
          onClick={onRetry}
          type="button"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function Tiles({ result, loading }: { result: DownturnResult | null; loading: boolean }) {
  return <dl className="mt-8 grid grid-cols-1 gap-3 p-0 min-[421px]:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
    <Tile label="Applications tested" value={result ? String(result.totals.count) : '\u2014'} detail="Active applications measured" loading={loading} />
    {(['above_80', 'above_90'] as const).map((key) => <Tile key={key} label={key === 'above_80' ? 'Above 80%' : 'Above 90%'}
      value={result ? `${result.totals.before[key].count} \u2192 ${result.totals.after[key].count}` : '\u2014'}
      detail={result ? `${formatEuro(result.totals.before[key].loan_eur)} \u2192 ${formatEuro(result.totals.after[key].loan_eur)} in loans` : 'Before \u2192 after'} loading={loading} />)}
    <Tile label="Loan amount above 90% after" value={result ? formatEuro(result.totals.after.above_90.loan_eur) : '\u2014'} detail="After the price fall" loading={loading} tone="warn" />
  </dl>;
}
function Results({ shown, loading }: { shown: Shown | null; loading: boolean }) {
  const result = shown?.result;
  if (!result && !loading) return null;
  if (result && !loading && result.applications.length === 0 && result.skipped.length === 0) {
    return <section className="card"><h2 className="text-xl font-semibold">No active applications to measure</h2><p className="mt-3 text-muted">The price fall covers Applied, AI Deliberated, Underwriter Approved and Funded applications.</p></section>;
  }
  const applications = [...(result?.applications ?? [])].sort((a, b) => b.after.ltv_pct - a.after.ltv_pct);
  const crossing = applications.filter((entry) => !entry.before.above_90 && entry.after.above_90);
  return <>
    <section className="relative min-h-48 rounded-[20px] border border-line bg-surface p-5 shadow-card" aria-labelledby="crossing-heading">
      {loading ? <Skeleton lines={4} /> : null}
      <h2 id="crossing-heading" className="text-xl font-semibold">Loans crossing 90%</h2>
      <p className="mt-2 text-muted">At or below 90% before; above 90% after this fall.</p>
      {crossing.length ? <DownturnResultsTable applications={crossing} crossing /> : !loading ? <p className="mt-4">No loans cross 90% at this fall.</p> : null}
    </section>
    <section className="relative mt-6 min-h-48 rounded-[20px] border border-line bg-surface p-5 shadow-card" aria-labelledby="every-heading">
      {loading ? <Skeleton lines={6} /> : null}
      <h2 id="every-heading" className="text-xl font-semibold">Every application</h2>
      <p className="mt-2 text-muted">The figures behind the towers, highest LTV first. Exactly 80% or 90% is not above that threshold.</p>
      {applications.length ? <DownturnResultsTable applications={applications} /> : !loading ? <p className="mt-4">No applications could be measured.</p> : null}
      {shown && !loading ? <p className="mt-4 text-base text-muted">al-ai answered in {shown.serverMs} ms, from asking to answer (sign-in token, network and calculation).</p> : null}
    </section>
    {result && result.skipped.length > 0 ? <section aria-labelledby="skipped-heading" className="mt-6 rounded-[20px] border border-line bg-surface p-5">
      <h2 id="skipped-heading" className="text-lg font-semibold">Not measured</h2>
      <p className="mt-2 text-muted">These applications are excluded from the totals.</p>
      <ul>{result.skipped.map((entry) => <li key={entry.application_id} className="break-words"><Link className="inline-flex min-h-11 items-center font-mono font-semibold text-pine underline underline-offset-4" to={loanFilePath(entry.application_id)}>{entry.application_id}</Link> <span className="text-muted">{entry.reason}</span></li>)}</ul>
    </section> : null}
  </>;
}

export function HousePriceFallPage() {
  const service = useStressService();
  const [fallPct, setFallPct] = useState(DEFAULT_FALL);
  const [shown, setShown] = useState<Shown | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Each request gets a number; only the newest one may change the page, so a slow answer for an
  // older slider position can never overwrite a newer one.
  const latest = useRef(0);
  // The run the slider has scheduled for when it stops, so Recalculate can cancel it instead of sending
  // the same request twice.
  const scheduled = useRef<number | undefined>(undefined);
  // The first run, on opening, shows the skeleton.
  const firstRun = useRef(true);

  const run = useCallback(
    async (fall: number, withSkeleton: boolean) => {
      const id = ++latest.current;
      setPending({ fallPct: fall, withSkeleton });
      setFailure(null);
      const started = performance.now();

      try {
        const result = await service.houseDownturn(fall);
        if (id === latest.current) {
          setShown({ result, serverMs: Math.round(performance.now() - started) });
        }
      } catch (error) {
        if (id === latest.current) {
          setFailure({ fallPct: fall, message: failureMessage(error) });
        }
      } finally {
        if (id === latest.current) {
          setPending(null);
        }
      }
    },
    [service],
  );

  useEffect(() => {
    const withSkeleton = firstRun.current;
    firstRun.current = false;
    scheduled.current = window.setTimeout(() => void run(fallPct, withSkeleton), RUN_DELAY_MS);
    return () => { window.clearTimeout(scheduled.current); ++latest.current; };
  }, [fallPct, run]);

  const recalculateButton = useRef<HTMLButtonElement>(null);
  const atDefault = fallPct === DEFAULT_FALL;

  // Recalculate and Reset use aria-disabled rather than disabled, so a keyboard user pressing one keeps focus
  // on it instead of dropping to the page body; the handlers ignore presses while they are unavailable.
  function recalculate() {
    if (pending !== null) return;
    window.clearTimeout(scheduled.current);
    void run(fallPct, true);
  }

  function reset() {
    if (atDefault) return;
    setFallPct(DEFAULT_FALL);
  }

  // Try again unmounts its own notice, so focus goes to Recalculate, which does the same job.
  function retry() {
    recalculateButton.current?.focus();
    recalculate();
  }

  // Leaving the page drops any answer still on its way.
  useEffect(() => () => void ++latest.current, []);

  const waiting = pending !== null || (shown === null && failure === null);
  const loading = waiting && (shown === null || (pending?.withSkeleton ?? false));
  const shownFall = shown?.result.fall_pct ?? null;
  // Only what is on screen is announced. The hint about the next run changes on every slider step,
  // and the slider's own aria-valuetext already says where it is, so the hint sits outside the live region.
  const announced = waiting
    ? `Calculating ${fallLabel(pending?.fallPct ?? fallPct)}…`
    : shownFall !== null
      ? `Showing ${fallLabel(shownFall)}.`
      : '';
  const nextRun =
    !waiting && shownFall !== null && shownFall !== fallPct && failure === null
      ? `${fallLabel(fallPct)} runs when the slider stops.`
      : null;
  const showTiles = shown !== null || loading;

  // The towers stand for the result on screen; before the first answer the stage is empty.
  const stageApplications = useMemo(() => shown?.result.applications ?? [], [shown]);

  // A tower on the 3D stage was clicked: bring its row into view, mark it and move focus to its link.
  const pickRow = useCallback((applicationId: string) => {
    const row = document.getElementById(downturnRowId(applicationId));
    if (!row) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    row.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    row.querySelector('a')?.focus({ preventScroll: true });
    row.dataset.picked = 'true';
    window.setTimeout(() => { delete row.dataset.picked; }, 2600);
  }, []);

  const controls = (
    <>
      <label
        className="block font-mono text-base tracking-[0.1em] text-brass uppercase"
        htmlFor="fall-pct"
      >
        Price fall
      </label>
      <p
        aria-hidden="true"
        className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1"
        data-testid="fall-readout"
      >
        <span
          className="shock-readout font-mono text-[44px] leading-[1.05] font-semibold text-brass-light tabular-nums"
          key={fallPct}
        >
          {fallLabel(fallPct)}
        </span>
      </p>
      <input
        aria-valuetext={fallLabel(fallPct)}
        className="shock-range focus-visible:outline-brass-light"
        id="fall-pct"
        max={FALL_MAX}
        min={FALL_MIN}
        onChange={(event) => setFallPct(Number(event.target.value))}
        step={FALL_STEP}
        style={{ '--shock-pct': `${((fallPct - FALL_MIN) / (FALL_MAX - FALL_MIN)) * 100}%` } as CSSProperties}
        type="range"
        value={fallPct}
      />
      <div
        aria-hidden="true"
        className="flex justify-between font-mono text-base text-vote-observer"
      >
        <span>{fallLabel(FALL_MIN)}</span>
        <span>{fallLabel(FALL_MAX)}</span>
      </div>
      <div
        aria-label="Presets"
        className="mt-4.5 flex flex-wrap gap-2"
        role="group"
      >
        {PRESET_FALLS.map((fall) => (
          <button
            aria-label={fallLabel(fall)}
            aria-pressed={fallPct === fall}
            className="min-h-11 cursor-pointer rounded-full border border-tint/25 bg-transparent px-4 font-mono text-base text-tint transition-[border-color,background-color,color,box-shadow] duration-200 hover:border-brass data-[default=true]:border-brass focus-visible:outline-brass-light aria-pressed:border-brass-light aria-pressed:bg-brass/15 aria-pressed:text-brass-light aria-pressed:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brass-light)_14%,transparent)]"
            key={fall}
            data-default={fall === DEFAULT_FALL ? true : undefined}
            onClick={() => setFallPct(fall)}
            type="button"
          >
            {fallLabel(fall)}
          </button>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          aria-disabled={pending !== null}
          className="btn border border-brass bg-brass text-pine-pressed hover:not-aria-disabled:bg-brass-light focus-visible:outline-brass-light"
          onClick={recalculate}
          ref={recalculateButton}
          type="button"
        >
          Recalculate
        </button>
        <button
          aria-disabled={atDefault}
          className="btn border border-tint/40 bg-transparent text-tint hover:not-aria-disabled:border-tint hover:not-aria-disabled:bg-tint/10 focus-visible:outline-brass-light"
          onClick={reset}
          type="button"
        >
          Reset to {fallLabel(DEFAULT_FALL)}
        </button>
      </div>
      <p className="mt-4 min-h-6.5 text-base text-vote-observer">
        <span
          aria-live="polite"
          role="status"
        >
          {announced}
        </span>
        {nextRun ? <span> {nextRun}</span> : null}
      </p>
    </>
  );

  return (
    <div className="min-h-screen overflow-x-hidden bg-oat text-ink">
      <PortalHeader />

      <main className={`${wrap} pt-10 pb-12`}>
        <section aria-labelledby="house-price-fall-title">
          <p className="font-mono text-base font-medium tracking-[0.14em] text-brass-ink uppercase">
            Underwriter portal / Stress test
          </p>
          <h1
            className="mt-3 text-[clamp(2.25rem,6vw,3.5rem)] leading-[1.05] font-semibold tracking-tight text-pine"
            id="house-price-fall-title"
          >
            House price fall
          </h1>
          <p className="mt-3.5 max-w-2xl text-base leading-7 text-muted">
            Lower property values across active applications to see how collateral risk changes.
          </p>

          <HousePriceStage
            applications={stageApplications}
            controls={controls}
            failing={failure !== null}
            onSelect={pickRow}
          />

          {shown ? <p className="mt-5 text-base leading-7 text-muted">{shown.result.note}</p> : null}
          {showTiles ? (
            <Tiles
              loading={loading}
              result={shown?.result ?? null}
            />
          ) : null}
        </section>

        <div
          aria-busy={loading}
          className="pt-8 pb-4"
          data-testid="house-price-fall-results"
        >
          {failure ? (
            <FailureNotice
              failure={failure}
              onRetry={retry}
              shown={shown}
            />
          ) : null}
          {shown || loading ? (
            <Results
              loading={loading}
              shown={shown}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}