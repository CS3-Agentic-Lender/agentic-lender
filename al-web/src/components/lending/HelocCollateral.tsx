import type { LoanFileApplication, PolicyGate } from '../../services/loanFileService';
import { formatEuro, formatPercent } from '../../utils/formatters';
import { Skeleton } from '../Skeleton';
import { Figure, PENDING } from './Figure';

const COMBINED_LTV_CAP = 80;

interface HelocCollateralProps {
  application: LoanFileApplication;
  // PENDING while the review loads, undefined when it can't be read, null when there is no stored gate.
  policyGate?: PolicyGate | null | typeof PENDING;
}

function euro(value: number | null) {
  return value === null ? null : formatEuro(value);
}

// All financial figures come from the application. The bar uses the stored percentage
// on a 0–100% scale; overflow is clipped visually without changing the displayed figure.
export function HelocCollateral({ application, policyGate: storedGate }: HelocCollateralProps) {
  const { ltvPct } = application;
  const loadingGate = storedGate === PENDING;
  const policyGate = loadingGate ? undefined : storedGate;
  const facts = [
    {
      label: 'Estimated value',
      note: 'indicative estimate of a 2024 asking price, not a valuation',
      value: euro(application.estimatedValueEur),
    },
    { label: 'Existing mortgage balance', value: euro(application.existingMortgageBalanceEur) },
    { label: 'Credit limit requested', value: euro(application.loanAmountEur) },
    { label: 'Combined LTV', value: ltvPct === null ? null : formatPercent(ltvPct) },
    { label: 'Combined LTV cap', value: formatPercent(COMBINED_LTV_CAP) },
  ];

  return (
    <section aria-label="Collateral (HELOC)" className="card">
      <h2 className="card-title">Collateral (HELOC)</h2>
      <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {facts.map(({ label, note, value }) => (
          <div key={label}>
            <dt className="text-sm text-muted">
              {label}
              {note ? <span className="block">{note}</span> : null}
            </dt>
            <dd className="mt-1 text-lg tabular-nums"><Figure value={value} /></dd>
          </div>
        ))}
      </dl>
      {ltvPct === null ? null : (
        <div className="mt-6">
          <div aria-hidden="true">
            <div className="relative h-2 rounded-full bg-neutral">
              <div className={`h-full max-w-full origin-left animate-grow rounded-full ${ltvPct > COMBINED_LTV_CAP ? 'bg-error' : 'bg-pine'}`} style={{ width: `${ltvPct}%` }} />
              <div className="absolute -top-1.5 h-5 w-0.5 rounded-full bg-ink" style={{ left: `${COMBINED_LTV_CAP}%` }} />
            </div>
            <div className="relative mt-2 h-5 font-mono text-xs text-muted">
              <span className="absolute -translate-x-1/2" style={{ left: `${COMBINED_LTV_CAP}%` }}>80% cap</span>
            </div>
          </div>
          <p className="mt-2 text-sm text-muted">Combined LTV {formatPercent(ltvPct)} against the 80% cap</p>
          {ltvPct > COMBINED_LTV_CAP ? (
            <p className="mt-3 rounded-lg border border-line bg-neutral p-3 text-sm text-ink">
              Above the 80% combined LTV cap
            </p>
          ) : null}
        </div>
      )}
      {policyGate?.breaches.includes('CLTV_CAP') ? (
        <p className="mt-4 rounded-lg bg-danger-soft p-3 text-sm text-error">
          Requires lender exception review: the combined LTV is above the 80% cap (CLTV_CAP).
        </p>
      ) : null}
      {loadingGate ? (
        <div aria-busy="true" className="mt-6">
          <p className="sr-only" role="status">Loading the policy check.</p>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-3 h-3.5 w-3/4" />
          <Skeleton className="mt-2 h-3.5 w-1/2" />
        </div>
      ) : policyGate === undefined ? null : policyGate === null ? (
        <p className="mt-4 text-sm text-muted">The policy check is not stored with this application yet.</p>
      ) : policyGate.conditions.length > 0 ? (
        <div className="mt-6">
          <h3 className="font-semibold">Conditions</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
            {policyGate.conditions.map((condition, index) => (
              <li key={index}>{condition}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">
            Conditions are for the underwriter's decision; they do not approve or mint the loan.
          </p>
        </div>
      ) : null}
    </section>
  );
}
