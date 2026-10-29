import type { LoanFileApplication, LoanFileProperty, LoanFileReview } from '../../services/loanFileService';
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

function inputValue(feature: string, property: LoanFileProperty) {
  switch (feature) {
    case 'county':
      return property.county;
    case 'property_type':
      return property.propertyType;
    case 'bedrooms':
      return property.bedrooms;
    case 'floor_area':
      return property.floorAreaSqm === null ? null : `${property.floorAreaSqm} m²`;
    case 'ber':
      return property.berRating;
    default:
      return null;
  }
}

export function ValuationBreakdown({ application, review }: ValuationBreakdownProps) {
  const valuation = review.state === 'available' ? review.valuation : null;
  const breakdown = valuation?.state === 'available' ? valuation : null;
  const notice = review.state === 'available' ? 'missing' : review.state;
  const maxEffect = breakdown?.contributions.reduce((max, { eur }) => Math.max(max, Math.abs(eur)), 0) ?? 0;

  return (
    <section aria-labelledby="valuation-heading" className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <h2 className="text-xl font-semibold" id="valuation-heading">
        Valuation
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        Feature effects compared with a typical listing
      </p>

      {breakdown === null ? (
        <div aria-live="polite" className="mt-4 rounded-lg border border-line bg-tint p-3 text-sm text-ink" role="status">
          {review.state === 'pending' ? null : (
            <p className="font-medium">Valuation breakdown not available</p>
          )}
          <p>{reviewNotices[notice]}</p>
        </div>
      ) : (
        <>
          <dl className="mt-6 flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <dt className="text-muted">Typical listing</dt>
            <dd>
              <Figure value={formatEuro(breakdown.baselineEur)} />
            </dd>
          </dl>

          <ol aria-label="Valuation contributions" className="mt-4 divide-y divide-line border-y border-line">
            {breakdown.contributions.map(({ feature, eur }) => {
              const input = inputValue(feature, application.property);
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

          <dl className="mt-4 flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold">
            <dt>Estimate</dt>
            <dd>
              <Figure value={breakdown.estimatedValueEur === null ? null : formatEuro(breakdown.estimatedValueEur)} />
            </dd>
          </dl>
          <p className="mt-4 text-sm leading-6 text-muted">
            Each bar is how much that feature moved the estimate away from a typical listing. It is an
            estimate of a 2024 asking price, not a valuation.
          </p>
          {breakdown.discrepancyEur !== null && Math.abs(breakdown.discrepancyEur) > 1 ? (
            <p className="mt-4 rounded-lg border border-line bg-danger-soft p-3 text-sm text-error" role="status">
              The stored breakdown does not add up to the estimate: it is off by {formatEuro(Math.abs(breakdown.discrepancyEur))}.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
