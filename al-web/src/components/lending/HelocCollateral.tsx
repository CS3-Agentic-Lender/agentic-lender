import type { LoanFileApplication } from '../../services/loanFileService';
import { formatEuro, formatPercent } from '../../utils/formatters';
import { Figure } from './Figure';

const COMBINED_LTV_CAP = 80;

interface HelocCollateralProps {
  application: LoanFileApplication;
}

function euro(value: number | null) {
  return value === null ? null : formatEuro(value);
}

// All financial figures come from the application. The bar uses the stored percentage
// on a 0–100% scale; overflow is clipped visually without changing the displayed figure.
export function HelocCollateral({ application }: HelocCollateralProps) {
  const { ltvPct } = application;
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
    <section aria-label="Collateral (HELOC)" className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <h2 className="text-xl font-semibold">Collateral (HELOC)</h2>
      <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {facts.map(({ label, note, value }) => (
          <div key={label}>
            <dt className="text-sm text-muted">
              {label}
              {note ? <span className="block text-xs">{note}</span> : null}
            </dt>
            <dd className="mt-1"><Figure value={value} /></dd>
          </div>
        ))}
      </dl>
      {ltvPct === null ? null : (
        <div className="mt-6">
          <div aria-hidden="true">
            <div className="relative h-3 rounded-full bg-neutral">
              <div className="h-full max-w-full rounded-full bg-pine" style={{ width: `${ltvPct}%` }} />
              <div className="absolute -top-1 h-5 w-0.5 bg-ink" style={{ left: `${COMBINED_LTV_CAP}%` }} />
            </div>
            <div className="relative mt-2 h-5 text-xs text-muted">
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
    </section>
  );
}
