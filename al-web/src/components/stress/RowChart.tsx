import { useEffect, useRef, useState, type ReactNode } from 'react';

export const ROW_HEIGHT = 46;
export const CHART_TOP = 12;
export const CHART_AXIS = 34;
export const LABEL_WIDTH = 86;
// Used until the chart has been measured, and where it cannot be (the test environment).
const FALLBACK_WIDTH = 640;
const MIN_WIDTH = 280;
const TIP_WIDTH = 272;

export function chartHeight(rows: number) {
  return CHART_TOP + rows * ROW_HEIGHT + CHART_AXIS;
}

export interface ChartRow {
  key: string;
  label: string;
  // Over the 40% limit: the label is drawn in the decline colour and the row is marked for tests and styles.
  emphasis?: boolean;
  // What a screen reader hears on the row's focus target.
  description: string;
  tip: ReactNode;
  // The row's marks, drawn with the row's vertical centre at ROW_HEIGHT / 2.
  marks: ReactNode;
}

interface RowChartProps {
  label: string;
  // Gets the measured width and returns what to draw: the grid behind the rows, and the rows top to bottom.
  draw: (width: number) => { backdrop: ReactNode; rows: ChartRow[] };
}

function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const measure = () => {
      if (host.clientWidth > 0) setWidth(Math.max(MIN_WIDTH, host.clientWidth));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

// One row per application on the dark stage, each a keyboard stop with a tooltip on hover, focus or tap.
// Rows move with a CSS transform, so a new result glides them into place; reduced motion turns it off.
export function RowChart({ label, draw }: RowChartProps) {
  const [hostRef, width] = useMeasuredWidth();
  const [active, setActive] = useState<string | null>(null);
  const { backdrop, rows } = draw(width);
  const height = chartHeight(rows.length);
  const activeIndex = rows.findIndex((row) => row.key === active);
  const activeRow = activeIndex >= 0 ? rows[activeIndex] : null;

  // A tap anywhere else closes the tooltip.
  useEffect(() => {
    if (active === null) return;
    const close = (event: MouseEvent) => {
      if (!hostRef.current?.contains(event.target as Node)) setActive(null);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [active, hostRef]);

  return (
    <div
      className="relative mt-4"
      ref={hostRef}
    >
      <svg
        aria-label={label}
        className="block w-full overflow-visible font-mono"
        height={height}
        role="group"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
      >
        {backdrop}
        {rows.map((row, index) => (
          <g
            className="shock-row"
            data-active={row.key === active}
            data-over-limit={row.emphasis ? 'true' : undefined}
            data-testid={`chart-row-${row.key}`}
            key={row.key}
            style={{ transform: `translateY(${CHART_TOP + index * ROW_HEIGHT}px)` }}
          >
            <rect
              className="shock-row-bg"
              height={ROW_HEIGHT - 6}
              rx="8"
              width={width}
              x="0"
              y="3"
            />
            <text
              fill={row.emphasis ? 'var(--color-vote-decline)' : 'var(--color-tint)'}
              fontSize="15"
              fontWeight={row.emphasis ? 600 : 500}
              x="4"
              y={ROW_HEIGHT / 2 + 5}
            >
              {row.label}
            </text>
            {row.marks}
            <rect
              aria-label={row.description}
              className="shock-row-hit"
              height={ROW_HEIGHT}
              onBlur={() => setActive((current) => (current === row.key ? null : current))}
              onClick={(event) => {
                event.stopPropagation();
                setActive((current) => (current === row.key ? null : row.key));
              }}
              onFocus={() => setActive(row.key)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setActive(null);
              }}
              onMouseEnter={() => setActive(row.key)}
              onMouseLeave={() => setActive((current) => (current === row.key ? null : current))}
              role="button"
              tabIndex={0}
              width={width}
              x="0"
              y="0"
            />
          </g>
        ))}
      </svg>
      {activeRow ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-[5] max-w-[17rem] min-w-[13rem] animate-rise rounded-xl bg-surface px-3.5 py-3 text-[15px] leading-snug text-ink shadow-raised"
          data-testid="chart-tip"
          style={{
            left: Math.max(0, Math.min(width - TIP_WIDTH, width * 0.42)),
            top: CHART_TOP + (activeIndex + 1) * ROW_HEIGHT + 4,
          }}
        >
          <b className="mb-1 block font-mono text-pine">{activeRow.label}</b>
          {activeRow.tip}
        </div>
      ) : null}
    </div>
  );
}
