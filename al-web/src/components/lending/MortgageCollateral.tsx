import type { LoanFileApplication, LoanFileReview } from '../../services/loanFileService';
import { formatEuro, formatPercent } from '../../utils/formatters';
import { Figure } from './Figure';

const LTV_LIMIT = 90;

interface MortgageCollateralProps {
  application: LoanFileApplication;
  review: LoanFileReview;
}

function euro(value: number | null) {
  return value === null ? null : formatEuro(value);
}

function gapText(gap: number | null) {
  if (gap === null) {
    return 'Gap unavailable';
  }
  if (gap === 0) {
    return 'Asking price matches the estimate';
  }

  return `Asking price ${(Math.abs(gap) * 100).toFixed(1)}% ${gap > 0 ? 'above' : 'below'} the estimate`;
}

function LtvRow({ label, note, value }: { label: string; note: string; value: number | null }) {
  return (
    <div>
      <dl className="flex flex-wrap items-baseline justify-between gap-2">
        <dt className="text-sm text-muted">
          {label}
          <span className="block text-xs">{note}</span>
        </dt>
        <dd>
          <Figure value={value === null ? null : formatPercent(value)} />
        </dd>
      </dl>
      {value === null ? null : (
        <div className="mt-3">
          <div aria-hidden="true">
            <div className="relative h-3 rounded-full bg-neutral">
              <div className="h-full max-w-full rounded-full bg-pine" style={{ width: `${value}%` }} />
              <div className="absolute -top-1 h-5 w-0.5 bg-ink" style={{ left: `${LTV_LIMIT}%` }} />
            </div>
            <div className="relative mt-2 h-5 text-xs text-muted">
              <span className="absolute -translate-x-1/2" style={{ left: `${LTV_LIMIT}%` }}>
                90% limit
              </span>
            </div>
          </div>
          <p className="mt-2 text-sm text-muted">{formatPercent(value)} against the 90% limit</p>
          {value > LTV_LIMIT ? (
            <p className="mt-2 text-sm text-error">Above the 90% limit</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

// Same split as the valuation breakdown: a review that could not be read is not the same as
// a review with no estimate in it, so a refused or failed read never says "not stored".
const estimateNotices = {
  pending: 'Loading the model estimate.',
  absent: 'The model estimate will appear once the underwriting review is written.',
  unavailable: 'The model estimate could not be read from the underwriting review.',
  missing: 'The model estimate is not stored with this application yet.',
};

// The backend supplies the comparison and flag. Bars use the stored LTVs on a 0–100%
// scale, clipped visually without changing the figures or their denominators.
export function MortgageCollateral({ application, review }: MortgageCollateralProps) {
  const valuation = review.state === 'available' && review.valuation.state === 'available' ? review.valuation : null;
  const estimate = valuation?.displayEstimateEur ?? valuation?.estimatedValueEur ?? null;
  const notice = review.state === 'available' ? (estimate === null ? 'missing' : null) : review.state;

  return (
    <section aria-label="Collateral" className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <h2 className="text-xl font-semibold">Collateral</h2>
      <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted">Asking price</dt>
          <dd className="mt-1">
            <Figure value={euro(application.property.askingPriceEur)} />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">
            Model estimate
            <span className="block text-xs">indicative estimate of a 2024 asking price, not a valuation</span>
          </dt>
          <dd className="mt-1">
            <Figure value={euro(estimate)} />
            {valuation?.modelVersion ? (
              <p className="mt-1 break-words text-xs text-muted">Model {valuation.modelVersion}</p>
            ) : null}
          </dd>
        </div>
      </dl>
      {notice === null ? null : (
        <p className="mt-4 text-sm text-muted" role="status">
          {estimateNotices[notice]}
        </p>
      )}
      <p className="mt-4 text-sm">{gapText(valuation?.askingPriceGap ?? null)}</p>
      {valuation?.priceNeedsReview === true ? (
        <span className="mt-2 inline-flex rounded-full bg-danger-soft px-3 py-1 text-xs font-medium text-error">
          Price needs review
        </span>
      ) : null}
      {valuation !== null && valuation.supportWarnings.length > 0 ? (
        <aside aria-label="Why this estimate may be less reliable" className="mt-4 rounded-lg border border-line bg-neutral p-4 text-sm text-neutral-text">
          <h3 className="font-semibold">Why this estimate may be less reliable</h3>
          <ul className="mt-2 list-disc space-y-2 break-words pl-5 leading-6">
            {valuation.supportWarnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </aside>
      ) : null}
      <div className="mt-6 grid gap-6">
        <LtvRow label="Purchase-price LTV" note="loan / asking price" value={application.purchaseLtvPct} />
        <LtvRow label="Indicative LTV on the estimate" note="loan / model estimate" value={application.ltvPct} />
      </div>
    </section>
  );
}
