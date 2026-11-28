import type { DownturnResult } from '../../services/stressService';

// Draw the backend portfolio totals directly, including on browsers without WebGL.
export function LtvExposureChart({ result }: { result: DownturnResult }) {
  const rows = [
    { key: 'above_80', label: 'Above 80%' },
    { key: 'above_90', label: 'Above 90%' },
  ] as const;
  const largest = Math.max(1, ...rows.flatMap(({ key }) => [result.totals.before[key].count, result.totals.after[key].count]));
  return (
    <section aria-labelledby="exposure-heading" className="mt-6 rounded-[20px] border border-line bg-surface p-5 shadow-card">
      <h2 id="exposure-heading" className="text-xl font-semibold">LTV exposure, before and after</h2>
      <p className="mt-2 text-muted">Applications above each threshold. Exactly 80% or 90% stays in the lower band.</p>
      <div aria-hidden="true" className="mt-4 grid gap-6 sm:grid-cols-2">
        {rows.map(({ key, label }) => (
          <div key={key}>
            <p className="font-semibold">{label}</p>
            {(['before', 'after'] as const).map((when) => (
              <div key={when} className="mt-2 grid grid-cols-[3.75rem_minmax(0,1fr)_2rem] items-center gap-3">
                <span className="text-muted">{when === 'before' ? 'Before' : 'After'}</span>
                <span className="h-4 rounded-full bg-oat">
                  <span data-testid="exposure-bar"
                    className={`block h-full rounded-full ${when === 'before' ? 'bg-neutral-text' : 'bg-pine'}`}
                    style={{ width: `${100 * result.totals[when][key].count / largest}%` }} />
                </span>
                <span className="text-right font-mono tabular-nums">{result.totals[when][key].count}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>Applications above LTV thresholds before and after the price fall</caption>
        <thead><tr><th scope="col">Threshold</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
        <tbody>{rows.map(({ key, label }) => (
          <tr key={key}><th scope="row">{label}</th><td>{result.totals.before[key].count}</td><td>{result.totals.after[key].count}</td></tr>
        ))}</tbody>
      </table>
    </section>
  );
}
