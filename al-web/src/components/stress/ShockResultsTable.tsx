import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { AffordabilityBand, ShockedApplication } from '../../services/stressService';
import { formatEuro, formatPercent } from '../../utils/formatters';
import { crossesDtiLimit, DTI_COMFORTABLE_MAX_PCT } from './rateShockFigures';

const rate = new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ratePct(value: number) {
  return `${rate.format(value)}%`;
}

const bandChip: Record<AffordabilityBand, string> = {
  Comfortable: 'bg-success-soft text-success',
  Caution: 'bg-vote-conditional text-ink',
  Adverse: 'bg-danger-soft text-error',
};

function BandChip({ band }: { band: AffordabilityBand }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-base font-semibold whitespace-nowrap ${bandChip[band]}`}>
      {band}
    </span>
  );
}

function FromTo({ from, to }: { from: ReactNode; to: ReactNode }) {
  return (
    <span className="font-mono whitespace-nowrap max-[760px]:whitespace-normal">
      {from}
      <span
        aria-hidden="true"
        className="mx-1.5 text-muted"
      >
        →
      </span>
      <span className="sr-only"> to </span>
      {to}
    </span>
  );
}

function Negative({ when, children }: { when: boolean; children: ReactNode }) {
  return <span className={when ? 'text-error' : undefined}>{children}</span>;
}

interface ShockResultsTableProps {
  applications: ShockedApplication[];
  pointsText: string;
  linkTo: (applicationId: string) => string;
}

const headerCell = 'bg-oat px-3.5 py-3 text-left align-top font-mono text-base font-medium tracking-[0.06em] text-muted uppercase';
const cell = 'px-3.5 py-3 align-top';

// Every measured application, worst first. Below 760px each row becomes a card with its own labels,
// so a phone never scrolls sideways.
// The row's element id, so the 3D stage can scroll to the application a tower stands for.
export const shockRowId = (applicationId: string) => `shock-row-${applicationId}`;

export function ShockResultsTable({ applications, pointsText, linkTo }: ShockResultsTableProps) {
  return (
    <table className="shock-table mt-4 w-full border-collapse text-base">
      <caption className="sr-only">Rate shock results per application at {pointsText}, worst band first</caption>
      <thead>
        <tr>
          <th
            className={headerCell}
            scope="col"
          >
            Application
          </th>
          <th
            className={headerCell}
            scope="col"
          >
            Rate
          </th>
          <th
            className={headerCell}
            scope="col"
          >
            Monthly repayment
          </th>
          <th
            className={headerCell}
            scope="col"
          >
            Debt to income
          </th>
          <th
            className={headerCell}
            scope="col"
          >
            Surplus
          </th>
          <th
            className={headerCell}
            scope="col"
          >
            Band
          </th>
        </tr>
      </thead>
      <tbody>
        {applications.map((application) => {
          const crossed = crossesDtiLimit(application);
          return (
            <tr
              className={`scroll-mt-24 border-t border-line transition-[background-color,box-shadow] duration-500 data-[picked=true]:bg-brass/22 data-[picked=true]:shadow-[inset_4px_0_0_var(--color-brass)] ${crossed ? 'bg-danger-soft/55' : ''}`}
              data-over-limit={crossed ? 'true' : undefined}
              id={shockRowId(application.applicationId)}
              key={application.applicationId}
            >
              <th
                className={`${cell} text-left font-normal`}
                scope="row"
              >
                <Link
                  className="inline-flex min-h-11 items-center font-mono font-semibold text-pine underline underline-offset-4 hover:no-underline"
                  to={linkTo(application.applicationId)}
                >
                  {application.applicationId}
                </Link>
              </th>
              <td
                className={cell}
                data-label="Rate"
              >
                <span>
                  <FromTo
                    from={ratePct(application.benchmarkRatePct)}
                    to={ratePct(application.shockedRatePct)}
                  />
                  {application.rateSource === 'current' ? (
                    <span className="mt-0.5 block text-base text-muted">Today&apos;s ECB rate: no committee run yet</span>
                  ) : null}
                </span>
              </td>
              <td
                className={cell}
                data-label="Monthly repayment"
              >
                <FromTo
                  from={formatEuro(application.before.repaymentEur)}
                  to={formatEuro(application.after.repaymentEur)}
                />
              </td>
              <td
                className={cell}
                data-label="Debt to income"
              >
                <FromTo
                  from={formatPercent(application.before.dtiPct)}
                  to={
                    <Negative when={application.after.dtiPct > DTI_COMFORTABLE_MAX_PCT}>
                      {formatPercent(application.after.dtiPct)}
                    </Negative>
                  }
                />
              </td>
              <td
                className={cell}
                data-label="Surplus"
              >
                <FromTo
                  from={formatEuro(application.before.surplusEur)}
                  to={
                    <Negative when={application.after.surplusEur < 0}>
                      {formatEuro(application.after.surplusEur)}
                    </Negative>
                  }
                />
              </td>
              <td
                className={cell}
                data-label="Band"
              >
                <FromTo
                  from={<BandChip band={application.before.band} />}
                  to={<BandChip band={application.after.band} />}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
