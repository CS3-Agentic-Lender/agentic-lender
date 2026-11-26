import type { LoanFileReview } from '../../services/loanFileService';
import { formatEuro, formatPercent } from '../../utils/formatters';
import { BandChip } from './DtiBreakdown';

// The band limits al-ai's affordability module sets on debt to income (al-core SCHEMA.md, dtiBreakdown):
// Comfortable up to 40%, Caution up to 50%, Adverse above. They are rules, not stored per application.
const DTI_COMFORTABLE_MAX = 40;
const DTI_CAUTION_MAX = 50;
// The surplus band, set on the stressed monthly surplus: Comfortable from EUR 500, Caution from EUR 0, Adverse below.
const SURPLUS_COMFORTABLE_MIN = 500;
const SURPLUS_CAUTION_MIN = 0;

const breachWording: Record<string, string> = {
  LTI_CAP: 'Loan-to-income cap',
  LTV_CAP: 'Loan-to-value cap',
  CLTV_CAP: 'Combined loan-to-value cap',
};

// Every figure comes from the review's dtiBreakdown, which each run's calculations step rewrites as one map,
// so the benchmark and stressed figures always belong to the same run.
export interface AffordabilityInputs {
  review: LoanFileReview;
}

function NotStored() {
  return <span className="text-muted">Not stored</span>;
}

function Money({ value }: { value: number | null }) {
  return value === null ? <NotStored /> : <span className="font-mono tabular-nums">{formatEuro(value)}</span>;
}

// The figure at the benchmark rate and at the stressed rate, each named.
function Pair({ benchmark, stressed }: { benchmark: number | null; stressed: number | null }) {
  return (
    <>
      <span data-figure="benchmark">
        <Money value={benchmark} /> <span className="text-sm text-muted">benchmark</span>
      </span>
      <span data-figure="stressed">
        <Money value={stressed} /> <span className="text-sm text-muted">stressed</span>
      </span>
    </>
  );
}

function barTone(value: number) {
  if (value <= DTI_COMFORTABLE_MAX) return 'bg-pine';
  return value <= DTI_CAUTION_MAX ? 'bg-vote-conditional' : 'bg-error';
}

// A ratio drawn against the two band limits. The words beside it carry the same facts.
function RatioRow({ label, note, value, band }: {
  label: string;
  note: string;
  value: number | null;
  band?: string | null;
}) {
  const scale = Math.max(60, value === null ? 0 : Math.min(100, value * 1.1));
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <dt>
          <span className="font-medium">{label}</span>
          <span className="block text-sm text-muted">{note}</span>
        </dt>
        <dd className="flex flex-wrap items-center gap-2">
          {value === null ? <NotStored /> : <span className="font-mono text-lg tabular-nums">{formatPercent(value)}</span>}
          {band ? <BandChip value={band} /> : null}
        </dd>
      </div>
      {value === null ? null : (
        <>
          <div aria-hidden="true" className="relative mt-3 h-2 rounded-full bg-neutral" data-ratio-bar>
            <div
              className={`h-full max-w-full origin-left animate-grow rounded-full ${barTone(value)}`}
              style={{ width: `${(Math.min(value, scale) / scale) * 100}%` }}
            />
            {[DTI_COMFORTABLE_MAX, DTI_CAUTION_MAX].map((limit) => (
              <div
                className="absolute -top-1.5 h-5 w-0.5 rounded-full bg-ink"
                key={limit}
                style={{ left: `${(limit / scale) * 100}%` }}
              />
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">
            {value <= DTI_COMFORTABLE_MAX
              ? `Within the ${DTI_COMFORTABLE_MAX}% Comfortable limit`
              : value <= DTI_CAUTION_MAX
                ? `Above the ${DTI_COMFORTABLE_MAX}% Comfortable limit, within the ${DTI_CAUTION_MAX}% Caution limit`
                : `Above the ${DTI_CAUTION_MAX}% Caution limit`}
          </p>
        </>
      )}
    </div>
  );
}

function surplusTone(value: number) {
  if (value >= SURPLUS_COMFORTABLE_MIN) return 'bg-pine';
  return value >= SURPLUS_CAUTION_MIN ? 'bg-vote-conditional' : 'bg-error';
}

// The stored stressed surplus drawn against the Comfortable minimum. A shortfall draws no fill; the words say so.
function SurplusBar({ value }: { value: number | null }) {
  if (value === null) return null;
  const scale = Math.max(SURPLUS_COMFORTABLE_MIN * 2, value * 1.1);
  const width = (Math.min(Math.max(value, 0), scale) / scale) * 100;
  return (
    <>
      <div aria-hidden="true" className="relative mt-3 h-2 rounded-full bg-neutral" data-surplus-bar>
        <div
          className={`h-full max-w-full origin-left animate-grow rounded-full ${surplusTone(value)}`}
          style={{ width: `${width}%` }}
        />
        <div
          className="absolute -top-1.5 h-5 w-0.5 rounded-full bg-ink"
          style={{ left: `${(SURPLUS_COMFORTABLE_MIN / scale) * 100}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-muted">
        {value >= SURPLUS_COMFORTABLE_MIN
          ? `Stressed surplus at or above the ${formatEuro(SURPLUS_COMFORTABLE_MIN)} Comfortable minimum`
          : value >= SURPLUS_CAUTION_MIN
            ? `Stressed surplus below the ${formatEuro(SURPLUS_COMFORTABLE_MIN)} Comfortable minimum, with no shortfall`
            : 'Stressed surplus is a shortfall, below the Caution minimum'}
      </p>
    </>
  );
}

const unreadable: Partial<Record<LoanFileReview['state'], string>> = {
  pending: 'Loading the figures the affordability agent judged.',
  unavailable: 'The underwriting review could not be read, so the figures the affordability agent judged cannot be shown.',
};

// The figures the affordability agent judged. The run record keeps no calculations, so they are read from
// the stored DTI breakdown its calculations step wrote to the underwriting review, and the breaches from the
// policy gate stored with the run. Nothing is worked out here.
export function AffordabilityFigures({ inputs, breaches }: {
  inputs: AffordabilityInputs;
  breaches: string[] | null;
}) {
  const { review } = inputs;
  const notice = unreadable[review.state];
  if (notice) {
    return (
      <p aria-live="polite" className="mt-2 text-muted">
        {notice}
      </p>
    );
  }
  const breakdown = review.state === 'available' ? review.dtiBreakdown : null;
  const stress = review.state === 'available' ? review.stressTest : null;

  return (
    <div className="mt-2">
      <dl className="divide-y divide-line/70">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
          <dt>
            <span className="font-medium">Monthly repayment</span>
            <span className="block text-sm text-muted">at the benchmark rate, then stressed</span>
          </dt>
          <dd className="flex flex-wrap items-baseline gap-x-4">
            <Pair benchmark={breakdown?.newRepaymentMonthlyEur ?? null} stressed={stress?.stressedRepaymentMonthlyEur ?? null} />
          </dd>
        </div>
        <RatioRow label="Debt to income" note="at the benchmark rate" value={breakdown?.dtiPct ?? null} />
        <RatioRow
          band={stress?.dtiBand ?? null}
          label="Stressed debt to income"
          note="the band is set on this figure"
          value={stress?.stressedDtiPct ?? null}
        />
        <div className="py-3" data-row="surplus">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <dt>
              <span className="font-medium">Monthly surplus</span>
              <span className="block text-sm text-muted">after debts and living costs, then stressed</span>
            </dt>
            <dd className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Pair benchmark={stress?.surplusMonthlyEur ?? null} stressed={stress?.stressedSurplusMonthlyEur ?? null} />
              {stress?.surplusBand ? <BandChip value={stress.surplusBand} /> : null}
            </dd>
          </div>
          <SurplusBar value={stress?.stressedSurplusMonthlyEur ?? null} />
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
          <dt className="font-medium">Policy breaches</dt>
          <dd>
            {breaches === null ? (
              <NotStored />
            ) : breaches.length === 0 ? (
              <span>None</span>
            ) : (
              <ul aria-label="Policy breaches" className="space-y-1 text-right">
                {breaches.map((breach, index) => (
                  <li key={`${breach}-${index}`}>
                    {breachWording[breach] ?? breach}{' '}
                    <code className="font-mono text-sm text-muted">{breach}</code>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-sm leading-6 text-muted">
        Source: the DTI breakdown stored on the underwriting review and the policy gate stored with this run. The
        run record keeps no calculations of its own. Limits are the affordability bands: Comfortable up to{' '}
        {DTI_COMFORTABLE_MAX}%, Caution up to {DTI_CAUTION_MAX}%; a stressed surplus of{' '}
        {formatEuro(SURPLUS_COMFORTABLE_MIN)} or more is Comfortable, {formatEuro(SURPLUS_CAUTION_MIN)} or more Caution.
      </p>
    </div>
  );
}
