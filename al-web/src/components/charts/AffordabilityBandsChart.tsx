import { AFFORDABILITY_BANDS, type BandCounts } from '../../services/stressService';

interface AffordabilityBandsChartProps {
  before: BandCounts;
  after: BandCounts;
  // What "after" means, for the caption, e.g. "+2 points".
  shockLabel: string;
}

const share = new Intl.NumberFormat('en-IE', { maximumFractionDigits: 1 });

function applications(count: number) {
  return count === 1 ? '1 application' : `${count} applications`;
}

function barHeight(count: number, largest: number) {
  return largest === 0 ? '0%' : `${(count / largest) * 100}%`;
}

// Before and after bars for each affordability band. The bars are decoration: every count and
// share is also written out as text beside them, so the chart reads the same without seeing it.
export function AffordabilityBandsChart({ before, after, shockLabel }: AffordabilityBandsChartProps) {
  const largest = Math.max(...AFFORDABILITY_BANDS.flatMap((band) => [before[band].count, after[band].count]));

  return (
    <figure className="m-0">
      <figcaption className="text-sm text-muted">
        Applications in each affordability band, before and after a {shockLabel} rise.
      </figcaption>

      <ul className="mt-6 grid gap-6 sm:grid-cols-3">
        {AFFORDABILITY_BANDS.map((band) => {
          const headingId = `band-${band.toLowerCase()}`;

          return (
            <li aria-labelledby={headingId} className="rounded-xl border border-line p-5" key={band}>
              <h3 className="font-semibold" id={headingId}>
                {band}
              </h3>

              <div aria-hidden="true" className="mt-4 flex h-40 items-end gap-3 border-b border-line">
                <div
                  className="w-1/2 rounded-t-md bg-line transition-[height] duration-300"
                  data-testid={`bar-before-${band}`}
                  style={{ height: barHeight(before[band].count, largest) }}
                />
                <div
                  className="w-1/2 rounded-t-md bg-pine transition-[height] duration-300"
                  data-testid={`bar-after-${band}`}
                  style={{ height: barHeight(after[band].count, largest) }}
                />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="flex items-center gap-2 text-muted">
                    <span aria-hidden="true" className="size-2.5 rounded-sm bg-line" />
                    Before
                  </dt>
                  <dd className="mt-1">
                    <span className="font-mono text-lg">{before[band].count}</span>
                    <span className="sr-only"> {applications(before[band].count)},</span>
                    <span className="ml-2 text-xs text-muted">{share.format(before[band].sharePct)}%</span>
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-2 text-muted">
                    <span aria-hidden="true" className="size-2.5 rounded-sm bg-pine" />
                    After
                  </dt>
                  <dd className="mt-1">
                    <span className="font-mono text-lg">{after[band].count}</span>
                    <span className="sr-only"> {applications(after[band].count)},</span>
                    <span className="ml-2 text-xs text-muted">{share.format(after[band].sharePct)}%</span>
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
