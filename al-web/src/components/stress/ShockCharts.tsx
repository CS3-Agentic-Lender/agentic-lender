import type { CSSProperties, ReactNode } from 'react';
import type { AffordabilityBand, ShockedApplication } from '../../services/stressService';
import { formatEuro, formatPercent, signedEuro } from '../../utils/formatters';
import { CHART_AXIS, CHART_TOP, LABEL_WIDTH, ROW_HEIGHT, RowChart, chartHeight } from './RowChart';
import { crossesDtiLimit, DTI_CAUTION_MAX_PCT, DTI_COMFORTABLE_MAX_PCT, surplusChangeEur } from './rateShockFigures';

// Match the loan file's Comfortable, Caution and Adverse band tokens.
const bandColours: Record<AffordabilityBand, string> = {
  Comfortable: 'var(--color-success)',
  Caution: 'var(--color-neutral-text)',
  Adverse: 'var(--color-error)',
};

export function bandColour(band: AffordabilityBand) {
  return bandColours[band];
}

const rate = new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ratePct(value: number) {
  return `${rate.format(value)}%`;
}

const MID = ROW_HEIGHT / 2;

// Places an element along the x axis with a transform, so a CSS transition can glide it to a new value.
function along(x: number, extra = ''): CSSProperties {
  return { transform: `translateX(${x}px)${extra}` };
}

// A bar of the given pixel length, grown from its left end.
function bar(length: number): CSSProperties {
  return { transform: `scaleX(${Math.max(0, length)})`, transformBox: 'fill-box', transformOrigin: 'left center' };
}

function TipLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="block">
      <span className="text-muted">{label}</span> {children}
    </span>
  );
}

function Bad({ when, children }: { when: boolean; children: ReactNode }) {
  return <span className={when ? 'font-semibold text-error' : undefined}>{children}</span>;
}

function LimitLine({ x, bottom, colour }: { x: number; bottom: number; colour: string }) {
  return (
    <line
      stroke={colour}
      strokeDasharray="5 5"
      strokeWidth="1.5"
      x1={x}
      x2={x}
      y1={CHART_TOP - 6}
      y2={bottom + 6}
    />
  );
}

export function DtiDumbbellChart({ applications }: { applications: ShockedApplication[] }) {
  const largest = Math.max(0, ...applications.map((application) => application.after.dtiPct));
  const maxPct = Math.max(60, Math.ceil(largest / 10) * 10);

  return (
    <RowChart
      draw={(width) => {
        const x0 = LABEL_WIDTH + 8;
        const x1 = width - 14;
        const x = (pct: number) => x0 + (Math.max(0, pct) / maxPct) * (x1 - x0);
        const height = chartHeight(applications.length);
        const bottom = height - CHART_AXIS;
        const gridSteps = Array.from({ length: maxPct / 10 + 1 }, (_, index) => index * 10);

        return {
          backdrop: (
            <g aria-hidden="true">
              {gridSteps.map((pct) => (
                <g key={pct}>
                  <line
                    stroke="var(--color-line)"
                    x1={x(pct)}
                    x2={x(pct)}
                    y1={CHART_TOP - 4}
                    y2={bottom + 4}
                  />
                  {width > 420 || pct % 20 === 0 ? (
                    <text
                      fill="var(--color-muted)"
                      fontSize="16"
                      textAnchor="middle"
                      x={x(pct)}
                      y={height - 10}
                    >
                      {pct}%
                    </text>
                  ) : null}
                </g>
              ))}
              <LimitLine
                bottom={bottom}
                colour="var(--color-neutral-text)"
                x={x(DTI_COMFORTABLE_MAX_PCT)}
              />
              <LimitLine
                bottom={bottom}
                colour="var(--color-error)"
                x={x(DTI_CAUTION_MAX_PCT)}
              />
            </g>
          ),
          rows: applications.map((application) => {
            const before = x(application.before.dtiPct);
            const after = x(application.after.dtiPct);
            const colour = bandColour(application.after.band);
            const crossed = crossesDtiLimit(application);
            return {
              key: application.applicationId,
              label: application.applicationId,
              emphasis: crossed,
              description: `${application.applicationId}: debt to income ${formatPercent(application.before.dtiPct)} to ${formatPercent(application.after.dtiPct)}, ${application.before.band} to ${application.after.band}`,
              tip: (
                <>
                  <TipLine label="Rate">
                    {ratePct(application.benchmarkRatePct)} → {ratePct(application.shockedRatePct)}
                  </TipLine>
                  <TipLine label="DTI">
                    {formatPercent(application.before.dtiPct)} →{' '}
                    <Bad when={application.after.dtiPct > DTI_COMFORTABLE_MAX_PCT}>
                      {formatPercent(application.after.dtiPct)}
                    </Bad>
                  </TipLine>
                  <TipLine label="Band">
                    {application.before.band} →{' '}
                    <Bad when={application.after.band === 'Adverse'}>{application.after.band}</Bad>
                  </TipLine>
                  {crossed ? (
                    <span className="block font-semibold text-error">Crosses the 40% limit</span>
                  ) : null}
                </>
              ),
              marks: (
                <g aria-hidden="true">
                  <g
                    className="shock-move"
                    style={along(Math.min(before, after))}
                  >
                    <rect
                      className="shock-move animate-grow"
                      fill={colour}
                      height="3"
                      opacity="0.55"
                      style={bar(Math.abs(after - before))}
                      width="1"
                      x="0"
                      y={MID - 1.5}
                    />
                  </g>
                  <circle
                    className="shock-move"
                    cx="0"
                    cy={MID}
                    fill="var(--color-surface)"
                    r="6"
                    stroke="var(--color-muted)"
                    strokeWidth="2"
                    style={along(before)}
                  />
                  <g
                    className="shock-move shock-travel"
                    data-testid="dti-after"
                    style={{ ...along(after), '--shock-from-x': `${before}px` } as CSSProperties}
                  >
                    <circle
                      cx="0"
                      cy={MID}
                      fill={colour}
                      opacity="0.18"
                      r="12"
                    />
                    <circle
                      cx="0"
                      cy={MID}
                      fill={colour}
                      r="7"
                    />
                  </g>
                </g>
              ),
            };
          }),
        };
      }}
      label="Debt to income before and after the rise for each application. The table below has the same figures."
    />
  );
}

export function SurplusChangeChart({ applications }: { applications: ShockedApplication[] }) {
  const changes = applications.map(surplusChangeEur);
  const low = Math.min(0, ...changes) * 1.08;
  const high = Math.max(0, ...changes) * 1.08 || 1;
  const valueRoom = 78;

  return (
    <RowChart
      draw={(width) => {
        const x0 = LABEL_WIDTH + 8 + valueRoom;
        const x1 = width - 12;
        const x = (eur: number) => x0 + ((eur - low) / (high - low || 1)) * (x1 - x0);
        const height = chartHeight(applications.length);
        const bottom = height - CHART_AXIS;

        return {
          backdrop: (
            <g aria-hidden="true">
              <line
                stroke="var(--color-line)"
                x1={x(0)}
                x2={x(0)}
                y1={CHART_TOP - 6}
                y2={bottom + 6}
              />
              <text
                fill="var(--color-muted)"
                fontSize="16"
                textAnchor="end"
                x={x(0)}
                y={height - 10}
              >
                €0
              </text>
            </g>
          ),
          rows: applications.map((application) => {
            const change = surplusChangeEur(application);
            const start = x(Math.min(0, change));
            const end = x(Math.max(0, change));
            return {
              key: application.applicationId,
              label: application.applicationId,
              description: `${application.applicationId}: surplus ${formatEuro(application.before.surplusEur)} to ${formatEuro(application.after.surplusEur)} a month`,
              tip: (
                <>
                  <TipLine label="Repayment">
                    {formatEuro(application.before.repaymentEur)} → {formatEuro(application.after.repaymentEur)}
                  </TipLine>
                  <TipLine label="Surplus">
                    {formatEuro(application.before.surplusEur)} →{' '}
                    <Bad when={application.after.surplusEur < 0}>{formatEuro(application.after.surplusEur)}</Bad>
                  </TipLine>
                  <TipLine label="Change">{signedEuro(Math.round(change))} a month</TipLine>
                </>
              ),
              marks: (
                <g aria-hidden="true">
                  <g
                    className="shock-move"
                    style={along(start)}
                  >
                    <rect
                      className="shock-move animate-grow"
                      data-testid="surplus-bar"
                      fill={bandColour(application.after.band)}
                      height="18"
                      style={bar(Math.max(2, end - start))}
                      width="1"
                      x="0"
                      y={MID - 9}
                    />
                  </g>
                  <text
                    className="shock-move"
                    fill="var(--color-ink)"
                    fontSize="16"
                    style={along(start - 8)}
                    textAnchor="end"
                    x="0"
                    y={MID + 5}
                  >
                    {signedEuro(Math.round(change))}
                  </text>
                </g>
              ),
            };
          }),
        };
      }}
      label="Change in monthly surplus for each application. The table below has the same figures."
    />
  );
}
