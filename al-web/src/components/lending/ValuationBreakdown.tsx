import type { LoanFileApplication, LoanFileReview } from '../../services/loanFileService';
import { formatEuro, signedEuro } from '../../utils/formatters';
import { Skeleton } from '../Skeleton';
import { Figure } from './Figure';

interface ValuationBreakdownProps {
  application: LoanFileApplication;
  review: LoanFileReview;
}

const featureLabels = new Map([
  ['county', 'County'],
  ['property_type', 'Property type'],
  ['bedrooms', 'Bedrooms'],
  ['floor_area', 'Floor area'],
  ['ber', 'BER rating'],
  ['eircode_area', 'Eircode area'],
]);

// One line each: with nothing stored the card collapses to this notice and Collateral takes the row.
// A refused or failed read never says "not stored".
const reviewNotices = {
  pending: 'Loading the valuation breakdown.',
  absent: 'Valuation breakdown not stored for this application yet: it appears once the underwriting review is written.',
  unavailable: 'Valuation breakdown could not be read from the underwriting review.',
  missing: 'Valuation breakdown not stored for this application.',
};

// True when the review holds a valuation to draw; otherwise the card is a slim notice.
export function hasStoredValuation(review: LoanFileReview) {
  return review.state === 'available' && review.valuation.state === 'available';
}

// Only the routing key (the first three characters, e.g. T12) is shown: the full Eircode
// identifies one address.
function eircodeArea(eircode: string | null) {
  const routingKey = eircode?.replace(/\s/g, '').slice(0, 3).toUpperCase() ?? '';
  return /^([A-Z]\d{2}|D6W)$/.test(routingKey) ? routingKey : null;
}

function inputValue(feature: string, value: string | number | null) {
  if (feature === 'eircode_area') {
    return eircodeArea(typeof value === 'string' ? value : null);
  }
  if (typeof value === 'number') {
    const formatted = value.toLocaleString('en-IE');
    return feature === 'floor_area' ? `${formatted} m²` : formatted;
  }
  return value;
}

export function ValuationBreakdown({ review }: ValuationBreakdownProps) {
  const valuation = review.state === 'available' && review.valuation.state === 'available' ? review.valuation : null;
  const breakdown = valuation?.breakdown.state === 'available' ? valuation.breakdown : null;
  const notice = review.state === 'available' ? 'missing' : review.state;
  const maxEffect = breakdown?.contributions.reduce((max, { eur }) => Math.max(max, Math.abs(eur)), 0) ?? 0;

  if (valuation === null) {
    return (
      <section
        aria-labelledby="valuation-heading"
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-line bg-surface px-5 py-3"
        data-collapsed
      >
        <h2 className="font-semibold text-ink" id="valuation-heading">
          Valuation
        </h2>
        <p
          aria-live="polite"
          className={review.state === 'pending' ? 'sr-only' : 'text-base text-muted'}
          role="status"
        >
          {reviewNotices[notice]}
        </p>
        {review.state === 'pending' ? (
          <Skeleton className="h-4 w-64 max-w-full" />
        ) : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="valuation-heading" className="card">
      <h2 className="card-title" id="valuation-heading">
        Valuation
      </h2>
      <p className="mt-1 text-sm leading-6 text-muted">
        How each detail moved the estimate
      </p>

      <div className={valuation.supportWarnings.length ? 'grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : ''}>
        <div className="min-w-0">
          <>
              {breakdown === null ? (
                <p className="mt-4 text-sm text-muted">The breakdown of this estimate isn't available.</p>
              ) : (
                <>
                  <dl className="mt-5 flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-oat px-3 py-2.5 text-sm">
                    <dt className="font-medium text-ink">
                      Starting point
                      <span className="block font-normal text-muted">average of the model's sample homes</span>
                    </dt>
                    <dd>
                      <Figure value={formatEuro(breakdown.baselineEur)} />
                    </dd>
                  </dl>

                  <ol aria-label="Valuation contributions" className="mt-2 divide-y divide-line/70">
                    {breakdown.contributions.map(({ feature, value, eur }) => {
                      const input = inputValue(feature, value);
                      const width = maxEffect === 0 ? 0 : (Math.abs(eur) / maxEffect) * 50;

                      return (
                        <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-2 px-3 py-3 transition-colors duration-200 hover:bg-oat/70" key={feature}>
                          <div className="min-w-0 break-words">
                            <span className="font-medium">{featureLabels.get(feature) ?? feature}</span>
                            {input === null ? null : (
                              <span className="ml-2 text-sm text-muted">{input}</span>
                            )}
                          </div>
                          <span className={`font-mono tabular-nums ${eur < 0 ? 'text-error' : eur > 0 ? 'text-success' : 'text-muted'}`}>
                            {signedEuro(eur)}
                          </span>
                          <div aria-hidden="true" className="relative col-span-2 h-2 rounded-full bg-neutral">
                            <div
                              className={`absolute inset-y-0 animate-grow ${eur < 0 ? 'right-1/2 origin-right rounded-l-full bg-error' : 'left-1/2 origin-left rounded-r-full bg-success'}`}
                              style={{ width: `${width}%` }}
                            />
                            <div className="absolute -inset-y-1 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-ink" />
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}

              {valuation.estimatedValueEur !== null || breakdown !== null ? (
                <>
                  <dl className="mt-2 flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-pine px-3 py-2.5 text-lg font-semibold text-surface">
                    <dt>Estimate</dt>
                    <dd>
                      <Figure value={valuation.estimatedValueEur === null ? null : formatEuro(valuation.estimatedValueEur)} />
                    </dd>
                  </dl>
                  {breakdown === null ? (
                    <p className="mt-4 text-sm leading-6 text-muted">
                      It is an estimate of a 2024 asking price, not a valuation.
                    </p>
                  ) : (
                    <p className="mt-4 text-sm leading-6 text-muted">
                      Starts from the average of the model's sample homes, not a typical price. It doesn't say what
                      changing the house would do. It is an estimate of a 2024 asking price, not a valuation.
                      Amounts are rounded to the nearest euro, so the rows can add up to a euro or two more or less
                      than the estimate.
                    </p>
                  )}
                </>
              ) : null}
              {breakdown !== null && breakdown.discrepancyEur !== null && Math.abs(breakdown.discrepancyEur) > 1 ? (
                <p className="mt-4 rounded-lg border border-line bg-danger-soft p-3 text-sm text-error" role="status">
                  The stored breakdown does not add up to the estimate: it is off by {formatEuro(Math.abs(breakdown.discrepancyEur))}.
                </p>
              ) : null}
          </>
        </div>
        {valuation.supportWarnings.length > 0 ? (
          <aside aria-labelledby="valuation-warnings-heading" className="mt-6 self-start rounded-lg border border-line bg-neutral p-4 text-sm text-neutral-text">
            <h3 className="font-semibold" id="valuation-warnings-heading">Why this estimate may be less reliable</h3>
            <ul className="mt-2 list-disc space-y-2 break-words pl-5 leading-6">
              {valuation.supportWarnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
