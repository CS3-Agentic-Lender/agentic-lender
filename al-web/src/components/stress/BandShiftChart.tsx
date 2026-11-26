import { AFFORDABILITY_BANDS, type AffordabilityBand, type BandCounts } from '../../services/stressService';

const share = new Intl.NumberFormat('en-IE', { maximumFractionDigits: 1 });

// The same colours the band chips in the results table use: solid for after the shock, the soft tint for before.
const barColour: Record<AffordabilityBand, { before: string; after: string; text: string }> = {
  Comfortable: { before: 'border-success bg-success-soft', after: 'border-success bg-success', text: 'text-success' },
  Caution: { before: 'border-neutral-text bg-neutral', after: 'border-neutral-text bg-neutral-text', text: 'text-neutral-text' },
  Adverse: { before: 'border-error bg-danger-soft', after: 'border-error bg-error', text: 'text-error' },
};

function countText(count: number, sharePct: number) {
  return `${count} (${share.format(sharePct)}%)`;
}

function changeText(change: number) {
  if (change === 0) return 'no change';
  return `${change > 0 ? '+' : '−'}${Math.abs(change)}`;
}

function Bar({ label, count, sharePct, widthPct, colour }: {
  label: string;
  count: number;
  sharePct: number;
  widthPct: number;
  colour: string;
}) {
  return (
    <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-3">
      <span className="text-base text-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="h-4 min-w-0 flex-1">
          <span
            className={`block h-full rounded-full border motion-safe:transition-[width] motion-safe:duration-500 ${colour}`}
            data-testid="band-bar"
            // A band with no applications still draws a sliver, so its row never looks broken.
            style={{ width: count > 0 ? `${widthPct}%` : '0.5rem' }}
          />
        </span>
        <span className="shrink-0 font-mono text-base text-ink tabular-nums">{countText(count, sharePct)}</span>
      </span>
    </div>
  );
}

interface BandShiftChartProps {
  before: BandCounts;
  after: BandCounts;
  pointsText: string;
}

// How many applications sit in each affordability band before and after the shock, straight from al-ai's totals.
export function BandShiftChart({ before, after, pointsText }: BandShiftChartProps) {
  const largest = Math.max(1, ...AFFORDABILITY_BANDS.flatMap((band) => [before[band].count, after[band].count]));
  const width = (count: number) => (100 * count) / largest;

  return (
    <section
      aria-labelledby="bands-heading"
      className="mb-6 rounded-[20px] border border-line bg-surface p-5.5 shadow-card"
    >
      <h2
        className="text-xl font-semibold"
        id="bands-heading"
      >
        Affordability bands, before and after
      </h2>
      <p className="mt-1.5 text-muted">Applications in each band at their benchmark rate, then {pointsText} higher.</p>

      <div
        aria-hidden="true"
        className="mt-4 grid gap-5 min-[761px]:grid-cols-3"
        data-testid="band-chart"
      >
        {AFFORDABILITY_BANDS.map((band) => {
          const colour = barColour[band];
          const change = after[band].count - before[band].count;
          return (
            <div key={band}>
              <p className="flex items-baseline justify-between gap-3">
                <span className={`font-semibold ${colour.text}`}>{band}</span>
                <span className="font-mono text-base text-muted tabular-nums">{changeText(change)}</span>
              </p>
              <div className="mt-2 grid gap-1.5">
                <Bar
                  colour={colour.before}
                  count={before[band].count}
                  label="Before"
                  sharePct={before[band].sharePct}
                  widthPct={width(before[band].count)}
                />
                <Bar
                  colour={colour.after}
                  count={after[band].count}
                  label="After"
                  sharePct={after[band].sharePct}
                  widthPct={width(after[band].count)}
                />
              </div>
            </div>
          );
        })}
      </div>

      <table className="sr-only">
        <caption>Applications in each affordability band before and after the {pointsText} rate shock</caption>
        <thead>
          <tr>
            <th scope="col">Band</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {AFFORDABILITY_BANDS.map((band) => (
            <tr key={band}>
              <th scope="row">{band}</th>
              <td>{countText(before[band].count, before[band].sharePct)}</td>
              <td>{countText(after[band].count, after[band].sharePct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
