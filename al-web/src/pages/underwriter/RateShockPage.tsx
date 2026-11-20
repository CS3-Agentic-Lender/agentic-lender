import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AffordabilityBandsChart } from '../../components/charts/AffordabilityBandsChart';
import { PortalHeader } from '../../components/PortalHeader';
import { useStressService } from '../../context/StressContext';
import { ApiError } from '../../services/apiClient';
import {
  AFFORDABILITY_BANDS,
  SHOCK_MAX_BPS,
  SHOCK_MIN_BPS,
  SHOCK_STEP_BPS,
  type RateShockResult,
  type ShockedApplication,
} from '../../services/stressService';
import { formatEuro, formatPercent } from '../../utils/formatters';
import { loanFilePath } from './PipelinePage';

export const DEFAULT_SHOCK_BPS = 200;
// The slider runs the calculation once it has been still this long, so dragging across it sends one request, not nine.
export const RUN_DELAY_MS = 300;

const points = new Intl.NumberFormat('en-IE', { maximumFractionDigits: 2 });
const rate = new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function bpsLabel(shockBps: number) {
  return `+${shockBps} bps`;
}

export function pointsLabel(shockBps: number) {
  return `+${points.format(shockBps / 100)} points`;
}

function ratePct(value: number) {
  return `${rate.format(value)}%`;
}

const headerCellClass = 'px-4 py-3 text-left align-bottom text-xs font-semibold tracking-wide text-muted uppercase';
const cellClass = 'px-4 py-4 align-top text-sm';

interface Shown {
  result: RateShockResult;
  serverMs: number;
}

interface Failure {
  shockBps: number;
  message: string;
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

// Worst first: Adverse before Caution, then the highest debt to income after the shock.
function movedApplications(result: RateShockResult) {
  return result.applications
    .filter((application) => application.movedInto !== null)
    .sort(
      (a, b) =>
        AFFORDABILITY_BANDS.indexOf(b.after.band) - AFFORDABILITY_BANDS.indexOf(a.after.band) ||
        b.after.dtiPct - a.after.dtiPct,
    );
}

function FromTo({ from, to }: { from: string; to: string }) {
  return (
    <span className="font-mono whitespace-nowrap">
      {from}
      <span aria-hidden="true" className="mx-2 text-muted">
        →
      </span>
      <span className="sr-only"> to </span>
      {to}
    </span>
  );
}

function MovedRow({ application }: { application: ShockedApplication }) {
  return (
    <tr className="border-t border-line">
      <th className={`${cellClass} text-left font-normal`} scope="row">
        <Link
          className="inline-flex min-h-11 items-center font-mono font-medium text-pine underline underline-offset-4 hover:no-underline"
          to={loanFilePath(application.applicationId)}
        >
          {application.applicationId}
        </Link>
      </th>
      <td className={cellClass}>
        <FromTo from={ratePct(application.benchmarkRatePct)} to={ratePct(application.shockedRatePct)} />
        {application.rateSource === 'current' ? (
          <span className="mt-1 block text-xs text-muted">Today&apos;s ECB rate: no committee run yet</span>
        ) : null}
      </td>
      <td className={cellClass}>
        <FromTo from={formatEuro(application.before.repaymentEur)} to={formatEuro(application.after.repaymentEur)} />
      </td>
      <td className={cellClass}>
        <FromTo from={formatPercent(application.before.dtiPct)} to={formatPercent(application.after.dtiPct)} />
      </td>
      <td className={`${cellClass} font-mono`}>{formatEuro(application.after.surplusEur)}</td>
      <td className={cellClass}>
        <span className="whitespace-nowrap">
          {application.before.band}
          <span aria-hidden="true" className="mx-2 text-muted">
            →
          </span>
          <span className="sr-only"> to </span>
          <span className={application.after.band === 'Adverse' ? 'font-semibold text-error' : 'font-semibold'}>
            {application.after.band}
          </span>
        </span>
      </td>
    </tr>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <dt className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-3">
        <span className="font-mono text-3xl font-semibold text-pine">{value}</span>
        {detail ? <span className="mt-2 block text-sm text-muted">{detail}</span> : null}
      </dd>
    </div>
  );
}

function Results({ shown }: { shown: Shown }) {
  const { result } = shown;
  const moved = movedApplications(result);
  const atCurrentRate = result.applications.filter((application) => application.rateSource === 'current').length;
  const atStoredRate = result.applications.length - atCurrentRate;

  if (result.totals.count === 0 && result.skipped.length === 0) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-8">
        <h2 className="text-xl font-semibold">No active applications to measure</h2>
        <p className="mt-3 leading-7 text-muted">
          The rate shock covers applications that are Applied, AI Deliberated, Underwriter Approved or Funded. None
          are at the moment.
        </p>
      </section>
    );
  }

  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-3">
        <Metric
          detail={`${atStoredRate} at the committee run's benchmark rate, ${atCurrentRate} at today's ECB rate`}
          label="Applications measured"
          value={String(result.totals.count)}
        />
        <Metric
          detail={`${result.totals.movedIntoCaution} into Caution, ${result.totals.movedIntoAdverse} into Adverse`}
          label="Moved to a worse band"
          value={String(moved.length)}
        />
        <Metric
          detail={`${bpsLabel(result.shockBps)} on each application's benchmark rate`}
          label="Rate rise"
          value={pointsLabel(result.shockBps)}
        />
      </dl>

      <section aria-labelledby="bands-heading" className="mt-8 rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <h2 className="text-xl font-semibold" id="bands-heading">
          Affordability bands
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Each application&apos;s band is the worse of its debt-to-income band and its surplus band, as the committee
          reads them. Before is its benchmark rate with no shock; after adds the rise.
        </p>
        <div className="mt-6">
          <AffordabilityBandsChart
            after={result.totals.after}
            before={result.totals.before}
            shockLabel={pointsLabel(result.shockBps)}
          />
        </div>
        <p className="mt-4 text-xs text-muted">
          al-ai answered in {shown.serverMs} ms (network and calculation).
        </p>
      </section>

      <section aria-labelledby="moved-heading" className="mt-8 rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <h2 className="text-xl font-semibold" id="moved-heading">
          Applications that move to a worse band
        </h2>
        {moved.length === 0 ? (
          <p className="mt-3 leading-7 text-muted">
            None. Every application stays in its band at {pointsLabel(result.shockBps)}.
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-3xl border-collapse">
              <caption className="sr-only">
                Applications that move to a worse affordability band at {pointsLabel(result.shockBps)}, worst first
              </caption>
              <thead className="bg-oat">
                <tr>
                  <th className={headerCellClass} scope="col">
                    Application
                  </th>
                  <th className={headerCellClass} scope="col">
                    Rate
                  </th>
                  <th className={headerCellClass} scope="col">
                    Monthly repayment
                  </th>
                  <th className={headerCellClass} scope="col">
                    Debt to income
                  </th>
                  <th className={headerCellClass} scope="col">
                    Surplus after
                  </th>
                  <th className={headerCellClass} scope="col">
                    Band
                  </th>
                </tr>
              </thead>
              <tbody>
                {moved.map((application) => (
                  <MovedRow application={application} key={application.applicationId} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {result.skipped.length > 0 ? (
        <section aria-labelledby="skipped-heading" className="mt-8 rounded-2xl border border-line bg-tint p-6 sm:p-8">
          <h2 className="text-lg font-semibold" id="skipped-heading">
            Not measured
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            al-ai left these out because a figure it needs is missing or unusable. They are not counted above.
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {result.skipped.map((entry) => (
              <li key={entry.applicationId}>
                <Link
                  className="font-mono font-medium text-pine underline underline-offset-4 hover:no-underline"
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
  const [pendingBps, setPendingBps] = useState<number | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Each request gets a number; only the newest one may change the page, so a slow answer for an
  // older slider position can never overwrite a newer one.
  const latest = useRef(0);

  const run = useCallback(
    async (bps: number) => {
      const id = ++latest.current;
      setPendingBps(bps);
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
          setPendingBps(null);
        }
      }
    },
    [service],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void run(shockBps), RUN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [shockBps, run]);

  // Leaving the page drops any answer still on its way.
  useEffect(() => () => void ++latest.current, []);

  const waiting = pendingBps !== null || (shown === null && failure === null);
  const shownBps = shown?.result.shockBps ?? null;

  return (
    <div className="min-h-screen bg-oat text-ink">
      <PortalHeader />

      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <p className="font-mono text-xs font-medium tracking-widest text-muted uppercase">
          Underwriter portal / stress test
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">Rate shock</h1>
        <p className="mt-4 max-w-2xl leading-7 text-muted">
          Raise every active application&apos;s benchmark rate by 100 to 300 basis points and see how the portfolio
          holds up. al-ai works out each repayment, debt to income and surplus with the committee&apos;s own
          affordability maths.
        </p>

        <section
          aria-labelledby="shock-heading"
          className="mt-10 rounded-2xl border border-pine bg-pine p-6 text-surface sm:p-8"
        >
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="min-w-64 flex-1">
              <h2 className="text-sm font-semibold tracking-wide uppercase" id="shock-heading">
                <label htmlFor="shock-bps">Rate rise</label>
              </h2>
              <p className="mt-2 font-mono text-4xl font-semibold">
                {bpsLabel(shockBps)}
                <span className="ml-3 text-lg font-normal opacity-80">{pointsLabel(shockBps)}</span>
              </p>
              <input
                aria-valuetext={`${bpsLabel(shockBps)}, ${pointsLabel(shockBps)}`}
                className="mt-6 h-11 w-full cursor-pointer accent-oat"
                id="shock-bps"
                max={SHOCK_MAX_BPS}
                min={SHOCK_MIN_BPS}
                onChange={(event) => setShockBps(Number(event.target.value))}
                step={SHOCK_STEP_BPS}
                type="range"
                value={shockBps}
              />
              <div aria-hidden="true" className="mt-1 flex justify-between font-mono text-xs opacity-80">
                <span>{bpsLabel(SHOCK_MIN_BPS)}</span>
                <span>{bpsLabel(SHOCK_MAX_BPS)}</span>
              </div>
            </div>
            <div className="flex flex-col items-start gap-3">
              <button
                className="min-h-11 cursor-pointer rounded-lg border border-surface px-4 font-semibold transition-colors hover:bg-pine-pressed disabled:cursor-not-allowed disabled:opacity-60"
                disabled={shockBps === DEFAULT_SHOCK_BPS}
                onClick={() => setShockBps(DEFAULT_SHOCK_BPS)}
                type="button"
              >
                Reset to {bpsLabel(DEFAULT_SHOCK_BPS)}
              </button>
              <button
                className="min-h-11 cursor-pointer rounded-lg bg-oat px-4 font-semibold text-pine transition-colors hover:bg-tint disabled:cursor-not-allowed disabled:opacity-60"
                disabled={pendingBps !== null}
                onClick={() => void run(shockBps)}
                type="button"
              >
                Recalculate
              </button>
            </div>
          </div>
        </section>

        <p aria-live="polite" className="mt-6 min-h-6 text-sm text-muted" role="status">
          {waiting
            ? `Calculating ${bpsLabel(pendingBps ?? shockBps)}…`
            : shownBps !== null && shownBps !== shockBps && failure === null
              ? `Showing ${bpsLabel(shownBps)}. ${bpsLabel(shockBps)} runs when the slider stops.`
              : shownBps !== null
                ? `Showing ${bpsLabel(shownBps)}.`
                : ''}
        </p>

        {failure ? (
          <div className="mt-4 rounded-lg border border-error bg-danger-soft p-4 text-sm text-ink" role="alert">
            <p className="font-semibold">The {bpsLabel(failure.shockBps)} rate shock could not be calculated.</p>
            <p className="mt-1">{failure.message}</p>
            {shown ? (
              <p className="mt-1">The figures below are still the last result, for {bpsLabel(shown.result.shockBps)}.</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6">
          {shown ? (
            <Results shown={shown} />
          ) : failure ? null : (
            <section className="rounded-2xl border border-line bg-surface p-8">
              <h2 className="text-xl font-semibold">Calculating the rate shock</h2>
              <p className="mt-3 leading-7 text-muted">al-ai is measuring every active application.</p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
