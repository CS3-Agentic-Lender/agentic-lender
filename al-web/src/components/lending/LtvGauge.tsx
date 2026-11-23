interface LtvGaugeProps {
  // A stored percentage on a 0–100 scale. The drawing clips above 100; the figure beside it never does.
  valuePct: number;
  limitPct: number;
  limitLabel: string;
}

const CENTRE_X = 110;
const CENTRE_Y = 112;
const RADIUS = 88;

function pointAt(pct: number, radius: number) {
  const angle = Math.PI * (1 - pct / 100);

  return { x: CENTRE_X + radius * Math.cos(angle), y: CENTRE_Y - radius * Math.sin(angle) };
}

// Decorative half-dial for one LTV against its limit. The numbers it draws are always written
// out next to it, so it is hidden from assistive technology.
export function LtvGauge({ valuePct, limitPct, limitLabel }: LtvGaugeProps) {
  const clipped = Math.min(Math.max(valuePct, 0), 100);
  const above = valuePct > limitPct;
  const tickInner = pointAt(limitPct, RADIUS - 13);
  const tickOuter = pointAt(limitPct, RADIUS + 13);
  const labelRight = limitPct > 50;
  const arc = `M${CENTRE_X - RADIUS} ${CENTRE_Y} A${RADIUS} ${RADIUS} 0 0 1 ${CENTRE_X + RADIUS} ${CENTRE_Y}`;

  return (
    <svg
      aria-hidden="true"
      className="mx-auto block w-full max-w-96"
      viewBox="-52 0 324 130"
    >
      <path
        className="stroke-neutral"
        d={arc}
        fill="none"
        strokeLinecap="round"
        strokeWidth="14"
      />
      <path
        className={`animate-draw ${above ? 'stroke-error' : 'stroke-pine'}`}
        d={arc}
        fill="none"
        pathLength="100"
        strokeDasharray={`${clipped} 100`}
        strokeLinecap="round"
        strokeWidth="14"
      />
      <line
        className="stroke-ink"
        strokeLinecap="round"
        strokeWidth="2"
        x1={tickInner.x}
        x2={tickOuter.x}
        y1={tickInner.y}
        y2={tickOuter.y}
      />
      <text
        className="fill-muted font-mono text-[10px]"
        textAnchor={labelRight ? 'start' : 'end'}
        x={tickOuter.x + (labelRight ? 7 : -7)}
        y={tickOuter.y + 1}
      >
        {limitLabel}
      </text>
      <g
        className="animate-sweep"
        style={{ transform: `rotate(${-90 + (180 * clipped) / 100}deg)`, transformOrigin: `${CENTRE_X}px ${CENTRE_Y}px` }}
      >
        <line
          className="stroke-ink"
          strokeLinecap="round"
          strokeWidth="3"
          x1={CENTRE_X}
          x2={CENTRE_X}
          y1={CENTRE_Y}
          y2={CENTRE_Y - RADIUS + 22}
        />
      </g>
      <circle className="fill-ink" cx={CENTRE_X} cy={CENTRE_Y} r="6" />
      <circle className="fill-surface" cx={CENTRE_X} cy={CENTRE_Y} r="2" />
    </svg>
  );
}
