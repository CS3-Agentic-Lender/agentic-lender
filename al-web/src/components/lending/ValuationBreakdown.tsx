import type { LoanFileApplication, LoanFileReview } from '../../services/loanFileService';
import { formatEuro, signedEuro } from '../../utils/formatters';
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

const reviewNotices = {
  pending: 'Loading the valuation breakdown.',
  absent: 'The valuation breakdown will appear once the underwriting review is written.',
  unavailable: 'The valuation breakdown could not be read from the underwriting review.',
  missing: 'A usable baseline and all feature contributions are not stored with this application yet.',
};

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

  return (
    <section aria-labelledby="valuation-heading" className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <h2 className="text-xl font-semibold" id="valuation-heading">
        Valuation
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        How each detail moved the estimate
      </p>

      <div className={valuation?.supportWarnings.length ? 'grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : ''}>
        <div className="min-w-0">
          {valuation === null ? (
            <div aria-live="polite" className="mt-4 rounded-lg border border-line bg-tint p-3 text-sm text-ink" role="status">
              {review.state === 'pending' ? null : (
                <p className="font-medium">Valuation breakdown not available</p>
              )}
              <p>{reviewNotices[notice]}</p>
            </div>
          ) : (
            <>
              {breakdown === null ? (
                <p className="mt-4 text-sm text-muted">The breakdown of this estimate isn't available.</p>
              ) : (
                <>
                  <dl className="mt-6 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <dt className="text-muted">
                      Starting point
                      <span className="block text-xs">average of the model's sample homes</span>
                    </dt>
                    <dd>
                      <Figure value={formatEuro(breakdown.baselineEur)} />
                    </dd>
                  </dl>

                  <ol aria-label="Valuation contributions" className="mt-4 divide-y divide-line border-y border-line">
                    {breakdown.contributions.map(({ feature, value, eur }) => {
                      const input = inputValue(feature, value);
                      const width = maxEffect === 0 ? 0 : (Math.abs(eur) / maxEffect) * 50;

                      return (
                        <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 py-3" key={feature}>
                          <div className="min-w-0 break-words text-sm">
                            <span>{featureLabels.get(feature) ?? feature}</span>
                            {input === null ? null : (
                              <span className="block text-xs text-muted">{input}</span>
                            )}
                          </div>
                          <span className={`font-mono text-sm ${eur < 0 ? 'text-error' : eur > 0 ? 'text-success' : 'text-muted'}`}>
                            {signedEuro(eur)}
                          </span>
                          <div aria-hidden="true" className="relative col-span-2 h-5 rounded bg-tint">
                            <div
                              className={`absolute top-1 h-3 ${eur < 0 ? 'right-1/2 rounded-l bg-error' : 'left-1/2 rounded-r bg-success'}`}
                              style={{ width: `${width}%` }}
                            />
                            <div className="absolute inset-y-0 left-1/2 w-px bg-muted" />
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}

              {valuation.estimatedValueEur !== null || breakdown !== null ? (
                <>
                  <dl className="mt-4 flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold">
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
          )}
        </div>
        {valuation !== null && valuation.supportWarnings.length > 0 ? (
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
