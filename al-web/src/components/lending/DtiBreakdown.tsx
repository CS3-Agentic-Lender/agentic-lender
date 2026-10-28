import {
  DEFAULT_STRESS_MARGIN_POINTS,
  type LoanFileApplication,
  type LoanFileReview,
  type StressTest,
} from '../../services/loanFileService';
import { formatEuro, formatPercent } from '../../utils/formatters';
import { Figure } from './Figure';

interface DtiBreakdownProps {
  application: LoanFileApplication;
  review: LoanFileReview;
}

const headerCellClass = 'px-4 py-3 text-left align-bottom text-xs font-semibold tracking-wide text-muted uppercase';
const labelCellClass = 'px-4 py-4 text-left align-top text-sm font-normal';
const cellClass = 'px-4 py-4 align-top text-sm';

const reviewNotices: Record<Exclude<LoanFileReview['state'], 'available'>, string> = {
  pending: 'Loading the underwriting review.',
  absent: 'The underwriting review has not been written yet, so its monthly figures are unavailable.',
  unavailable: 'The underwriting review could not be read, so its monthly figures are unavailable.',
};

function euro(value: number | null) {
  return value === null ? null : formatEuro(value);
}

function percent(value: number | null) {
  return value === null ? null : formatPercent(value);
}

const points = new Intl.NumberFormat('en-IE', { maximumFractionDigits: 2 });

function stressMarginLabel(marginPoints: number) {
  return `+${points.format(marginPoints)} points`;
}

function hasStressResults(stress: StressTest | null) {
  return (
    stress !== null &&
    [
      stress.stressedRepaymentMonthlyEur,
      stress.stressedDtiPct,
      stress.surplusMonthlyEur,
      stress.stressedSurplusMonthlyEur,
      stress.dtiBand,
      stress.stressedDtiBand,
      stress.surplusBand,
      stress.stressedSurplusBand,
    ].some((value) => value !== null)
  );
}

interface RowProps {
  label: string;
  unit?: string;
  offered: string | null;
  stressed: string | null;
  mono?: boolean;
}

function Row({ label, unit, offered, stressed, mono = true }: RowProps) {
  return (
    <tr className="border-t border-line">
      <th className={labelCellClass} scope="row">
        {label}
        {unit ? <span className="block text-xs text-muted">{unit}</span> : null}
      </th>
      <td className={cellClass}>
        <Figure mono={mono} value={offered} />
      </td>
      <td className={cellClass}>
        <Figure mono={mono} value={stressed} />
      </td>
    </tr>
  );
}

interface SharedRowProps {
  label: string;
  unit: string;
  value: string | null;
}

// Income and existing debts do not depend on the interest rate, so one figure covers both columns.
function SharedRow({ label, unit, value }: SharedRowProps) {
  return (
    <tr className="border-t border-line">
      <th className={labelCellClass} scope="row">
        {label}
        <span className="block text-xs text-muted">{unit}</span>
      </th>
      <td className={cellClass} colSpan={2}>
        <Figure value={value} />
        <span className="ml-3 text-xs text-muted">Same at both rates</span>
      </td>
    </tr>
  );
}

// The debt-to-income breakdown from the application record and its underwriting review. Stressed
// figures are only ever read from storage, never worked out here.
export function DtiBreakdown({ application, review }: DtiBreakdownProps) {
  const available = review.state === 'available' ? review : null;
  const loading = review.state === 'pending';
  const breakdown = available?.dtiBreakdown ?? null;
  const stress = available?.stressTest ?? null;
  const marginPoints = stress?.marginPoints ?? DEFAULT_STRESS_MARGIN_POINTS;
  const stressedHeading = `Stressed (${stressMarginLabel(marginPoints)})`;
  // While the review loads its cells say so; once it has answered a missing figure is Unavailable.
  const fromReview = (value: string | null) => (loading ? 'Loading' : value);

  return (
    <section aria-labelledby="dti-heading" className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <h2 className="text-xl font-semibold" id="dti-heading">
        Debt to income
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
        Monthly figures at the offered rate and at the stressed rate. Debt to income is total monthly debt
        repayments, including the new repayment, as a share of gross monthly income.
      </p>

      {review.state === 'available' ? null : (
        <p
          aria-live="polite"
          className="mt-4 rounded-lg border border-line bg-tint p-3 text-sm text-ink"
          role="status"
        >
          {reviewNotices[review.state]}
        </p>
      )}

      <div className="mt-6 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-xl border-collapse">
          <caption className="sr-only">Debt-to-income breakdown at the offered and stressed rates</caption>
          <thead className="bg-oat">
            <tr>
              <th className={headerCellClass} scope="col">
                Figure
              </th>
              <th className={headerCellClass} scope="col">
                At the offered rate
              </th>
              <th className={headerCellClass} scope="col">
                {stressedHeading}
              </th>
            </tr>
          </thead>
          <tbody>
            <Row
              label="Interest rate"
              offered={percent(application.aprPct)}
              stressed={fromReview(percent(stress?.stressedRatePct ?? null))}
              unit="per year"
            />
            <SharedRow
              label="Gross income"
              unit="per month, before tax"
              value={fromReview(euro(breakdown?.incomeMonthlyEur ?? null))}
            />
            <SharedRow
              label="Existing debt repayments"
              unit="per month"
              value={fromReview(euro(breakdown?.existingDebtsMonthlyEur ?? null))}
            />
            <Row
              label="New loan repayment"
              offered={fromReview(euro(breakdown?.newRepaymentMonthlyEur ?? null))}
              stressed={fromReview(euro(stress?.stressedRepaymentMonthlyEur ?? null))}
              unit="per month"
            />
            <Row
              label="Debt to income"
              offered={percent(application.dtiPct)}
              stressed={fromReview(percent(stress?.stressedDtiPct ?? null))}
              unit="of gross monthly income"
            />
            <Row
              label="DTI band"
              mono={false}
              offered={fromReview(stress?.dtiBand ?? null)}
              stressed={fromReview(stress?.stressedDtiBand ?? null)}
            />
            <Row
              label="Surplus after debts and living costs"
              offered={fromReview(euro(stress?.surplusMonthlyEur ?? null))}
              stressed={fromReview(euro(stress?.stressedSurplusMonthlyEur ?? null))}
              unit="per month"
            />
            <Row
              label="Surplus band"
              mono={false}
              offered={fromReview(stress?.surplusBand ?? null)}
              stressed={fromReview(stress?.stressedSurplusBand ?? null)}
            />
          </tbody>
        </table>
      </div>

      <dl className="mt-6 flex flex-wrap gap-x-12 gap-y-4 text-sm">
        <div>
          <dt className="text-muted">Benchmark rate</dt>
          <dd className="mt-1">
            <Figure value={fromReview(percent(stress?.benchmarkRatePct ?? null))} />
          </dd>
        </div>
        <div>
          <dt className="text-muted">Stress margin</dt>
          <dd className="mt-1">
            <span className="font-mono">{stressMarginLabel(marginPoints)}</span>
            {stress?.marginPoints == null ? (
              <span className="ml-2 text-xs text-muted">agreed default, not yet stored</span>
            ) : null}
          </dd>
        </div>
      </dl>

      {available && !hasStressResults(stress) ? (
        <p className="mt-6 text-sm leading-6 text-muted">
          Stressed figures, surpluses and bands are not stored with this application yet, so they show
          Unavailable. They appear here once the affordability results are saved.
        </p>
      ) : null}
    </section>
  );
}
