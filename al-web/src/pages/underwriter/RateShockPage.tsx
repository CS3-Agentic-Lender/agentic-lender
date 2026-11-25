import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { PortalHeader } from '../../components/PortalHeader';
import { RateShockDial } from '../../components/stress/RateShockDial';
import { summariseShock, worstFirst, type ShockSummary } from '../../components/stress/rateShockFigures';
import { bandColour, DtiDumbbellChart, SurplusChangeChart } from '../../components/stress/ShockCharts';
import { ShockResultsTable } from '../../components/stress/ShockResultsTable';
import { useStressService } from '../../context/StressContext';
import { ApiError } from '../../services/apiClient';
import {
  SHOCK_MAX_BPS,
  SHOCK_MIN_BPS,
  SHOCK_STEP_BPS,
  type RateShockResult,
} from '../../services/stressService';
import { signedEuro } from '../../utils/formatters';
import { loanFilePath } from './PipelinePage';

export const DEFAULT_SHOCK_BPS = 200;
// The slider runs the calculation once it has been still this long, so dragging across it sends one request, not nine.
export const RUN_DELAY_MS = 300;
export const PRESET_BPS = [100, 200, 300] as const;

const points = new Intl.NumberFormat('en-IE', { maximumFractionDigits: 2 });
const onePlace = new Intl.NumberFormat('en-IE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function bpsLabel(shockBps: number) {
  return `+${shockBps} bps`;
}

export function pointsLabel(shockBps: number) {
  return `+${points.format(shockBps / 100)} points`;
}

function signedPoints(value: number) {
  return `${value < 0 ? '−' : '+'}${onePlace.format(Math.abs(value))} pts`;
}

const wrap = 'mx-auto w-full max-w-6xl px-4 sm:px-6';

interface Shown {
  result: RateShockResult;
  serverMs: number;
}

interface Failure {
  shockBps: number;
  message: string;
}

interface Pending {
  shockBps: number;
  // Recalculate, Try again and the first load cover the figures with a skeleton; a slider run updates them in place.
  withSkeleton: boolean;
}

function failureMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) {
    return 'This account is not allowed to run portfolio stress tests. Only underwriters can.';
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'The rate shock could not be calculated. Try again.';
}

function Skeleton({ tone, lines = 0 }: { tone: 'night' | 'light'; lines?: number }) {
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 z-[4] rounded-[inherit] ${tone === 'night' ? 'shock-skeleton-night' : 'shock-skeleton-light'}`}
      data-testid="skeleton"
    >
      {lines > 0 ? (
        <div className="absolute inset-[22px] grid content-start gap-3.5">
          {Array.from({ length: lines }, (_, index) => (
            <i
              className={`block h-3.5 rounded-full first:h-5 first:w-2/5 even:w-[86%] ${tone === 'night' ? 'bg-tint/12' : 'bg-line'}`}
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
  const valueColour = tone === 'warn' ? 'text-vote-decline' : tone === 'brass' ? 'text-brass-light' : 'text-surface';
  return (
    <div className="relative m-0 overflow-hidden rounded-2xl border border-tint/12 bg-linear-to-b from-tint/6 to-transparent px-5 py-4.5">
      {loading ? <Skeleton tone="night" /> : null}
      <dt className="font-mono text-sm tracking-[0.08em] text-vote-observer uppercase">{label}</dt>
      <dd className="mt-2">
        <span
          className={`block animate-rise font-mono text-[2rem] leading-tight font-semibold tabular-nums ${valueColour}`}
          key={value}
        >
          {value}
        </span>
        <span className="mt-1.5 block text-base text-tint/80">{detail}</span>
      </dd>
    </div>
  );
}

function Tiles({ summary, shockBps, loading }: { summary: ShockSummary | null; shockBps: number; loading: boolean }) {
  const blank = '—';
  return (
    <dl className="mt-8 grid grid-cols-1 gap-3 p-0 min-[421px]:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
      <Tile
        detail={summary ? `${summary.atStoredRate} at the committee run's rate, ${summary.atCurrentRate} at today's ECB rate` : ' '}
        label="Applications tested"
        loading={loading}
        value={summary ? String(summary.count) : blank}
      />
      <Tile
        detail={summary ? `${summary.movedIntoCaution} moved into Caution, ${summary.movedIntoAdverse} into Adverse` : ' '}
        label="Cross the 40% DTI limit"
        loading={loading}
        tone={summary && summary.crossedLimit > 0 ? 'warn' : 'plain'}
        value={summary ? String(summary.crossedLimit) : blank}
      />
      <Tile
        detail={`per application at ${pointsLabel(shockBps)}`}
        label="Average DTI change"
        loading={loading}
        tone="brass"
        value={summary ? signedPoints(summary.averageDtiChangePts) : blank}
      />
      <Tile
        detail="a month, all applications together"
        label="Monthly surplus change"
        loading={loading}
        value={summary ? signedEuro(Math.round(summary.surplusChangeEur)) : blank}
      />
    </dl>
  );
}

function Panel({ id, title, sub, loading, legend, children }: {
  id: string;
  title: string;
  sub: string;
  loading: boolean;
  legend?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={`shock-panel shock-dark relative min-w-0 overflow-hidden rounded-[20px] bg-night p-5.5 text-tint shadow-raised ${loading ? 'min-h-72' : ''}`}
    >
      {loading ? (
        <Skeleton
          lines={7}
          tone="night"
        />
      ) : null}
      <h2
        className="text-xl font-semibold text-surface"
        id={id}
      >
        {title}
      </h2>
      <p className="mt-1.5 text-base text-tint/80">{sub}</p>
      {legend}
      {children}
    </section>
  );
}

function LegendDot({ colour, children }: { colour: string; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-2">
      <span
        className="size-3 flex-none rounded-full bg-(--dot)"
        style={{ '--dot': colour } as CSSProperties}
      />
      {children}
    </li>
  );
}

function LegendLine({ colour, children }: { colour: string; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-2">
      <span
        className="h-0 w-4.5 flex-none border-t-2 border-dashed border-(--dot)"
        style={{ '--dot': colour } as CSSProperties}
      />
      {children}
    </li>
  );
}

function DtiLegend() {
  return (
    <ul
      aria-hidden="true"
      className="mt-3.5 flex list-none flex-wrap gap-x-4.5 gap-y-2 p-0 text-sm text-tint"
    >
      <li className="inline-flex items-center gap-2">
        <span className="size-3 flex-none rounded-full border-2 border-vote-observer" />
        Before
      </li>
      <LegendDot colour={bandColour('Comfortable')}>Comfortable</LegendDot>
      <LegendDot colour={bandColour('Caution')}>Caution</LegendDot>
      <LegendDot colour={bandColour('Adverse')}>Adverse</LegendDot>
      <LegendLine colour="var(--color-brass)">40% Comfortable limit</LegendLine>
      <LegendLine colour="var(--color-vote-decline)">50% Caution limit</LegendLine>
    </ul>
  );
}

function FailureNotice({ failure, shown, onRetry, retrying }: {
  failure: Failure;
  shown: Shown | null;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div
      className="shock-dark mb-6 grid animate-rise grid-cols-[auto_1fr] gap-3.5 rounded-2xl border border-vote-decline/70 bg-night px-5 py-4.5 text-tint shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-vote-decline)_14%,transparent),var(--shadow-raised)]"
      role="alert"
    >
      <span
        aria-hidden="true"
        className="grid size-9 place-items-center rounded-full bg-vote-decline/22 font-mono font-semibold text-vote-decline"
      >
        !
      </span>
      <div>
        <h2 className="text-lg font-semibold text-surface">
          The {bpsLabel(failure.shockBps)} rate shock could not be calculated.
        </h2>
        <p className="mt-1">{failure.message}</p>
        {shown ? (
          <p className="mt-1">The figures below are still the last result, for {bpsLabel(shown.result.shockBps)}.</p>
        ) : null}
        <button
          className="btn mt-3 border border-tint/40 bg-transparent text-tint hover:not-disabled:border-tint hover:not-disabled:bg-tint/8"
          disabled={retrying}
          onClick={onRetry}
          type="button"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function Results({ shown, loading }: { shown: Shown | null; loading: boolean }) {
  const result = shown?.result ?? null;

  if (result && result.totals.count === 0 && result.skipped.length === 0 && !loading) {
    return (
      <section className="card">
        <h2 className="text-xl font-semibold">No active applications to measure</h2>
        <p className="mt-3 leading-7 text-muted">
          The rate shock covers applications that are Applied, AI Deliberated, Underwriter Approved or Funded. None
          are at the moment.
        </p>
      </section>
    );
  }

  const ordered = result ? worstFirst(result.applications) : [];
  const showFigures = loading || ordered.length > 0;

  return (
    <>
      {showFigures ? (
        <>
          <div className="grid gap-6 min-[980px]:grid-cols-[1.35fr_1fr]">
            <Panel
              id="dti-heading"
              legend={<DtiLegend />}
              loading={loading}
              sub="Each application at its benchmark rate, then with the rise added."
              title="Debt to income, before → after"
            >
              {ordered.length > 0 ? <DtiDumbbellChart applications={ordered} /> : null}
            </Panel>
            <Panel
              id="surplus-heading"
              loading={loading}
              sub="Take-home pay left each month, after minus before. Colour is the band after the rise."
              title="Monthly surplus change"
            >
              {ordered.length > 0 ? <SurplusChangeChart applications={ordered} /> : null}
            </Panel>
          </div>

          <section
            aria-labelledby="table-heading"
            className={`relative mt-6 rounded-[20px] border border-line bg-surface p-5.5 shadow-card ${loading ? 'min-h-64' : ''}`}
          >
            {loading ? (
              <Skeleton
                lines={6}
                tone="light"
              />
            ) : null}
            <h2
              className="text-xl font-semibold"
              id="table-heading"
            >
              Every application
            </h2>
            <p className="mt-1.5 text-muted">
              The same figures as the charts, worst band first. Rows shaded red cross the 40% debt-to-income limit.
            </p>
            {result && ordered.length > 0 ? (
              <ShockResultsTable
                applications={ordered}
                linkTo={loanFilePath}
                pointsText={pointsLabel(result.shockBps)}
              />
            ) : null}
            {shown && !loading ? (
              <p className="mt-4 text-sm text-muted">
                al-ai answered in {shown.serverMs} ms, from asking to answer (sign-in token, network and calculation).
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      {result && result.skipped.length > 0 ? (
        <section
          aria-labelledby="skipped-heading"
          className="mt-6 rounded-[20px] bg-tint px-5.5 py-5"
        >
          <h2
            className="text-lg font-semibold"
            id="skipped-heading"
          >
            Not measured
          </h2>
          <p className="mt-1.5 text-muted">
            al-ai left these out because a figure it needs is missing or unusable. They are not counted above.
          </p>
          <ul className="mt-2.5 list-none p-0">
            {result.skipped.map((entry) => (
              <li key={entry.applicationId}>
                <Link
                  className="inline-flex min-h-11 items-center font-mono font-semibold text-pine underline underline-offset-4 hover:no-underline"
                  to={loanFilePath(entry.applicationId)}
                >
                  {entry.applicationId}
                </Link>
                <span className="ml-2 text-muted">{entry.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

export function RateShockPage() {
  const service = useStressService();
  const [shockBps, setShockBps] = useState(DEFAULT_SHOCK_BPS);
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
    async (bps: number, withSkeleton: boolean) => {
      const id = ++latest.current;
      setPending({ shockBps: bps, withSkeleton });
      setFailure(null);
      const started = performance.now();

      try {
        const result = await service.rateShock(bps);
        if (id === latest.current) {
          setShown({ result, serverMs: Math.round(performance.now() - started) });
        }
      } catch (error) {
        if (id === latest.current) {
          setFailure({ shockBps: bps, message: failureMessage(error) });
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
    scheduled.current = window.setTimeout(() => void run(shockBps, withSkeleton), RUN_DELAY_MS);
    return () => window.clearTimeout(scheduled.current);
  }, [shockBps, run]);

  function recalculate() {
    window.clearTimeout(scheduled.current);
    void run(shockBps, true);
  }

  // Leaving the page drops any answer still on its way.
  useEffect(() => () => void ++latest.current, []);

  const waiting = pending !== null || (shown === null && failure === null);
  const loading = waiting && (shown === null || (pending?.withSkeleton ?? false));
  const shownBps = shown?.result.shockBps ?? null;
  const summary = shown ? summariseShock(shown.result) : null;
  // Only what is on screen is announced. The hint about the next run changes on every slider step,
  // and the slider's own aria-valuetext already says where it is, so the hint sits outside the live region.
  const announced = waiting
    ? `Calculating ${bpsLabel(pending?.shockBps ?? shockBps)}…`
    : shownBps !== null
      ? `Showing ${bpsLabel(shownBps)}.`
      : '';
  const nextRun =
    !waiting && shownBps !== null && shownBps !== shockBps && failure === null
      ? `${bpsLabel(shockBps)} runs when the slider stops.`
      : null;
  const showTiles = shown !== null || loading;

  return (
    <div className="min-h-screen overflow-x-hidden bg-oat text-ink">
      <PortalHeader />

      <main>
        <section
          aria-labelledby="rate-shock-title"
          className="shock-hero shock-dark"
        >
          <div className="shock-hairline" />
          <div className={`${wrap} pt-10 pb-8`}>
            <p className="font-mono text-sm font-medium tracking-[0.14em] text-brass uppercase">
              Underwriter portal / stress test
            </p>
            <h1
              className="mt-3 text-[clamp(2.25rem,6vw,3.5rem)] leading-[1.05] font-semibold tracking-tight text-surface"
              id="rate-shock-title"
            >
              Rate shock
            </h1>
            <p className="mt-3.5 max-w-[38rem] text-base leading-7 text-tint/86">
              Raise every active application&apos;s benchmark rate by 100 to 300 basis points and see how the portfolio
              holds up, with the committee&apos;s own affordability maths.
            </p>

            <div className="mt-8 grid items-center gap-8 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] min-[900px]:gap-12">
              <div className="rounded-[20px] border border-tint/14 bg-night/55 p-6 backdrop-blur-sm">
                <label
                  className="block font-mono text-sm tracking-[0.1em] text-brass uppercase"
                  htmlFor="shock-bps"
                >
                  Rate rise
                </label>
                <input
                  aria-valuetext={`${bpsLabel(shockBps)}, ${pointsLabel(shockBps)}`}
                  className="shock-range focus-visible:outline-brass-light"
                  id="shock-bps"
                  max={SHOCK_MAX_BPS}
                  min={SHOCK_MIN_BPS}
                  onChange={(event) => setShockBps(Number(event.target.value))}
                  step={SHOCK_STEP_BPS}
                  style={{ '--shock-pct': `${((shockBps - SHOCK_MIN_BPS) / (SHOCK_MAX_BPS - SHOCK_MIN_BPS)) * 100}%` } as CSSProperties}
                  type="range"
                  value={shockBps}
                />
                <div
                  aria-hidden="true"
                  className="flex justify-between font-mono text-sm text-vote-observer"
                >
                  <span>{bpsLabel(SHOCK_MIN_BPS)}</span>
                  <span>{bpsLabel(SHOCK_MAX_BPS)}</span>
                </div>
                <div
                  aria-label="Presets"
                  className="mt-4.5 flex flex-wrap gap-2"
                  role="group"
                >
                  {PRESET_BPS.map((bps) => (
                    <button
                      aria-label={bpsLabel(bps)}
                      aria-pressed={shockBps === bps}
                      className="min-h-11 cursor-pointer rounded-full border border-tint/22 bg-transparent px-4 font-mono text-base text-tint transition-[border-color,background-color,color,box-shadow] duration-200 hover:border-brass focus-visible:outline-brass-light aria-pressed:border-brass-light aria-pressed:bg-brass/14 aria-pressed:text-brass-light aria-pressed:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brass-light)_14%,transparent)]"
                      key={bps}
                      onClick={() => setShockBps(bps)}
                      type="button"
                    >
                      +{bps}
                    </button>
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    className="btn border border-brass bg-brass text-pine-pressed hover:not-disabled:bg-brass-light focus-visible:outline-brass-light"
                    disabled={pending !== null}
                    onClick={recalculate}
                    type="button"
                  >
                    Recalculate
                  </button>
                  <button
                    className="btn border border-tint/40 bg-transparent text-tint hover:not-disabled:border-tint hover:not-disabled:bg-tint/8 focus-visible:outline-brass-light"
                    disabled={shockBps === DEFAULT_SHOCK_BPS}
                    onClick={() => setShockBps(DEFAULT_SHOCK_BPS)}
                    type="button"
                  >
                    Reset to {bpsLabel(DEFAULT_SHOCK_BPS)}
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
              </div>

              {/* The hero's visual slot: the 2D dial today, kept separate so a 3D stage can take its place. */}
              <RateShockDial
                pointsText={pointsLabel(shockBps)}
                shockBps={shockBps}
              />
            </div>

            {showTiles ? (
              <Tiles
                loading={loading}
                shockBps={shown?.result.shockBps ?? shockBps}
                summary={summary}
              />
            ) : null}
          </div>
          <div className="shock-hairline" />
        </section>

        <div
          aria-busy={loading}
          className={`${wrap} pt-8 pb-16`}
          data-testid="rate-shock-results"
        >
          {failure ? (
            <FailureNotice
              failure={failure}
              onRetry={recalculate}
              retrying={pending !== null}
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
