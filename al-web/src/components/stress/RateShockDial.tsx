import { SHOCK_MAX_BPS, SHOCK_MIN_BPS, SHOCK_STEP_BPS } from '../../services/stressService';

const CX = 160;
const CY = 170;
const R = 138;
const SPAN = SHOCK_MAX_BPS - SHOCK_MIN_BPS;

// +100 bps sits at the left end of the arc, +300 bps at the right.
function angleFor(bps: number) {
  return Math.PI * (1 - (bps - SHOCK_MIN_BPS) / SPAN);
}

function point(angle: number, radius: number) {
  return [CX + radius * Math.cos(angle), CY - radius * Math.sin(angle)] as const;
}

function arc(radius: number) {
  const [x0, y0] = point(Math.PI, radius);
  const [x1, y1] = point(0, radius);
  return `M${x0} ${y0} A${radius} ${radius} 0 0 1 ${x1} ${y1}`;
}

const ticks = Array.from({ length: SPAN / SHOCK_STEP_BPS + 1 }, (_, index) => SHOCK_MIN_BPS + index * SHOCK_STEP_BPS);

interface RateShockDialProps {
  shockBps: number;
  pointsText: string;
}

// The pine gauge beside the slider. It repeats what the slider already says, so it is hidden
// from screen readers; the needle and the fill glide by CSS transition, which reduced motion turns off.
export function RateShockDial({ shockBps, pointsText }: RateShockDialProps) {
  const filled = ((shockBps - SHOCK_MIN_BPS) / SPAN) * 100;
  const needleDeg = 90 - (angleFor(shockBps) * 180) / Math.PI;

  return (
    <div
      aria-hidden="true"
      className="relative grid justify-items-center"
      data-testid="shock-dial"
    >
      <svg
        className="h-auto w-full max-w-[26rem] overflow-visible"
        viewBox="0 0 320 190"
      >
        <path
          d={arc(R)}
          fill="none"
          stroke="var(--color-line)"
          strokeLinecap="round"
          strokeWidth="10"
        />
        <path
          className="shock-dial-fill"
          d={arc(R)}
          data-filled={filled}
          fill="none"
          pathLength={100}
          stroke="var(--color-pine)"
          strokeLinecap="round"
          strokeWidth="10"
          style={{ strokeDasharray: `${filled} 100` }}
        />
        {ticks.map((bps) => {
          const angle = angleFor(bps);
          const major = bps % 100 === 0;
          const [x0, y0] = point(angle, R - 16);
          const [x1, y1] = point(angle, R - (major ? 30 : 24));
          const [tx, ty] = point(angle, R + 18);
          return (
            <g key={bps}>
              <line
                stroke={major ? 'var(--color-muted)' : 'var(--color-line)'}
                strokeWidth={major ? 2 : 1.25}
                x1={x0}
                x2={x1}
                y1={y0}
                y2={y1}
              />
              {major ? (
                <text
                  className="font-mono"
                  fill="var(--color-muted)"
                  fontSize="16"
                  textAnchor="middle"
                  x={tx}
                  y={ty + 5}
                >
                  +{bps}
                </text>
              ) : null}
            </g>
          );
        })}
        <g
          className="shock-dial-needle"
          data-deg={needleDeg}
          style={{ transform: `rotate(${needleDeg}deg)`, transformOrigin: `${CX}px ${CY}px` }}
        >
          <circle
            cx={CX}
            cy={CY - R}
            fill="var(--color-ink)"
            r="7"
          />
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-x-0 bottom-[4%] text-center">
        <span className="shock-dial-number block font-mono text-[clamp(3rem,14vw,4.75rem)] leading-none font-semibold text-ink tabular-nums">
          +{shockBps}
        </span>
        <span className="mt-1.5 block font-mono text-base text-muted">bps · {pointsText}</span>
      </div>
    </div>
  );
}
