import {
  DEFAULT_STRESS_MARGIN_PCT,
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

const headerCellClass = 'px-4 py-3 text-left align-bottom font-mono text-xs font-medium tracking-widest text-muted uppercase';
const labelCellClass = 'px-4 py-4 text-left align-top font-medium';
const cellClass = 'px-4 py-4 align-middle tabular-nums';
const stressedCellClass = 'bg-tint/50 px-4 py-4 align-middle font-medium tabular-nums';

const bandTones: Record<string, string> = {
  Comfortable: 'bg-success-soft text-success',
  Caution: 'bg-neutral text-neutral-text',
  Adverse: 'bg-danger-soft text-error',
};

// A band from al-ai's affordability module (Comfortable, Caution or Adverse). The value is always
// written out; an unknown value gets the neutral tone.
export function BandChip({ value }: { value: string }) {
  const tone = Object.hasOwn(bandTones, value) ? bandTones[value] : 'bg-neutral text-neutral-text';

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-[15px] font-medium ${tone}`} data-band-chip>
      {value}
    </span>
  );
}

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

function stressMarginLabel(marginPct: number) {
  return `+${points.format(marginPct)} points`;
}

const monthFormat = new Intl.DateTimeFormat('en-IE', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// A stored YYYY-MM month, shown as "September 2026".
function month(value: string | null) {
  if (value === null) {
    return null;
  }

  const [year, monthNumber] = value.split('-').map(Number);

  return monthFormat.format(new Date(Date.UTC(year, monthNumber - 1, 1)));
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
      stress.surplusBand,
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
    <tr className="border-t border-line/70 transition-colors duration-200 hover:bg-oat/60">
      <th className={labelCellClass} scope="row">
        {label}
        {unit ? <span className="block text-sm font-normal text-muted">{unit}</span> : null}
      </th>
      <td className={cellClass}>
        <Figure mono={mono} value={offered} />
      </td>
      <td className={stressedCellClass}>
        <Figure mono={mono} value={stressed} />
      </td>
    </tr>
  );
}

interface SharedRowProps {
  label: string;
  unit?: string;
  value: string | null;
  note?: string;
  mono?: boolean;
  band?: boolean;
}

// Income, debts and living costs do not depend on the interest rate, and each band is set once,
// on the stressed figures, so one value covers both columns.
function SharedRow({ label, unit, value, note = 'Same at both rates', mono = true, band = false }: SharedRowProps) {
  return (
    <tr className="border-t border-line/70 transition-colors duration-200 hover:bg-oat/60">
      <th className={labelCellClass} scope="row">
        {label}
        {unit ? <span className="block text-sm font-normal text-muted">{unit}</span> : null}
      </th>
      <td className={cellClass} colSpan={2}>
        {band && value !== null && value !== 'Loading' ? <BandChip value={value} /> : <Figure mono={mono} value={value} />}
        <span className="ml-3 font-sans text-sm text-muted">{note}</span>
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
  const marginPct = stress?.stressMarginPct ?? DEFAULT_STRESS_MARGIN_PCT;
  const stressedHeading = `Stressed (${stressMarginLabel(marginPct)})`;
  // While the review loads its cells say so; once it has answered a missing figure is Unavailable.
  const fromReview = (value: string | null) => (loading ? 'Loading' : value);

  return (
    <section aria-labelledby="dti-heading" className="card">
      <h2 className="card-title" id="dti-heading">
        Debt to income
      </h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
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

      <div className="mt-5 overflow-x-auto rounded-xl border border-line/70">
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
              <th className={`${headerCellClass} bg-tint`} scope="col">
                {stressedHeading}
                <span aria-hidden="true" className="ml-2 rounded-full bg-pine px-2 py-0.5 text-xs text-oat normal-case tracking-normal">Decides</span>
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
              label="Take-home pay"
              unit="per month, after tax"
              value={fromReview(euro(breakdown?.takeHomeMonthlyEur ?? null))}
            />
            <SharedRow
              label="Existing debt repayments"
              unit="per month"
              value={fromReview(euro(breakdown?.existingDebtsMonthlyEur ?? null))}
            />
            <SharedRow
              label="Living costs"
              unit="per month"
              value={fromReview(euro(breakdown?.livingCostsMonthlyEur ?? null))}
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
            <SharedRow
              label="DTI band"
              band
              mono={false}
              note="Set on the stressed figures"
              value={fromReview(stress?.dtiBand ?? null)}
            />
            <Row
              label="Surplus after debts and living costs"
              offered={fromReview(euro(stress?.surplusMonthlyEur ?? null))}
              stressed={fromReview(euro(stress?.stressedSurplusMonthlyEur ?? null))}
              unit="per month"
            />
            <SharedRow
              label="Surplus band"
              band
              mono={false}
              note="Set on the stressed figures"
              value={fromReview(stress?.surplusBand ?? null)}
            />
          </tbody>
        </table>
      </div>

      <dl className="mt-5 flex flex-wrap gap-x-12 gap-y-4 rounded-xl bg-oat px-4 py-3 text-sm">
        <div>
          <dt className="text-muted">Benchmark rate</dt>
          <dd className="mt-1">
            <Figure value={fromReview(percent(stress?.benchmarkRatePct ?? null))} />
          </dd>
        </div>
        <div>
          <dt className="text-muted">Benchmark rate from</dt>
          <dd className="mt-1">
            <Figure mono={false} value={fromReview(month(stress?.rateDate ?? null))} />
          </dd>
        </div>
        <div>
          <dt className="text-muted">Stress margin</dt>
          <dd className="mt-1">
            <span className="font-mono">{stressMarginLabel(marginPct)}</span>
            {stress?.stressMarginPct == null ? (
              <span className="ml-2 text-muted">agreed default, not yet stored</span>
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
