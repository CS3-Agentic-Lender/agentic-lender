// Test data only: mirrors app.house_price_fall.run, never imported by production.
import type { DownturnApplication, DownturnResult } from '../../services/stressService';
export function downturnFixture(fall = 10): DownturnResult {
  const applications: DownturnApplication[] = [144000, 162000, 180000, 190000].map((loan, index) => {
    const starting = 200000;
    const newValue = starting * (100 - fall) / 100;
    const figures = (value: number) => {
      const pct = Math.round(loan / value * 10000) / 100;
      return { ltv_pct: pct, above_80: pct > 80, above_90: pct > 90 };
    };
    return { application_id: `LN-${1001 + index}`, loan_type: index === 3 ? 'heloc' : 'mortgage',
      value_basis: index === 3 ? 'model_estimate' : 'asking_price', loan_eur: loan, starting_value_eur: starting,
      before: figures(starting), after: { ...figures(newValue), property_value_eur: newValue } };
  });
  const exposure = (when: 'before' | 'after', flag: 'above_80' | 'above_90') => {
    const hit = applications.filter((entry) => entry[when][flag]);
    return { count: hit.length, loan_eur: hit.reduce((sum, entry) => sum + entry.loan_eur, 0) };
  };
  return { fall_pct: fall, note: 'An indicative, model-based loan to value. It is not a verified valuation.', applications,
    totals: { count: 4,
      before: { above_80: exposure('before', 'above_80'), above_90: exposure('before', 'above_90') },
      after: { above_80: exposure('after', 'above_80'), above_90: exposure('after', 'above_90') } },
    skipped: [{ application_id: 'LN-1009', reason: "a HELOC is measured against the model's estimate, and this one has no estimate yet" }] };
}
