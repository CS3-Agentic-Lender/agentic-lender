import { ApiError, createApiClient, type ApiClient } from './apiClient';

// The rate shock al-ai accepts: 100 to 300 basis points in steps of 25 (al-ai/app/rate_shock.py).
export const SHOCK_MIN_BPS = 100;
export const SHOCK_MAX_BPS = 300;
export const SHOCK_STEP_BPS = 25;

// Best to worst, as al-ai names them. The portal shows these names as they come, never a score.
export const AFFORDABILITY_BANDS = ['Comfortable', 'Caution', 'Adverse'] as const;
export type AffordabilityBand = (typeof AFFORDABILITY_BANDS)[number];

// al-ai is its own service: on the laptop it listens on 5001, and on AWS the same gateway as
// al-core serves it under /ai, so the deployed build sets this to that gateway.
export const AI_BASE_URL = import.meta.env.VITE_AI_BASE_URL || 'http://localhost:5001';

export interface ShockFigures {
  repaymentEur: number;
  // A percentage, 35.2 meaning 35.2%. al-ai sends a fraction (0.352); it is converted once, here.
  dtiPct: number;
  surplusEur: number;
  band: AffordabilityBand;
}

export interface ShockedApplication {
  applicationId: string;
  // "stored": the committee run's own benchmark rate. "current": today's ECB rate, because no run has stored one yet.
  rateSource: 'stored' | 'current';
  benchmarkRatePct: number;
  shockedRatePct: number;
  before: ShockFigures;
  after: ShockFigures;
  movedInto: Exclude<AffordabilityBand, 'Comfortable'> | null;
}

export interface BandCount {
  count: number;
  sharePct: number;
}

export type BandCounts = Record<AffordabilityBand, BandCount>;

export interface RateShockResult {
  shockBps: number;
  applications: ShockedApplication[];
  totals: {
    count: number;
    before: BandCounts;
    after: BandCounts;
    movedIntoCaution: number;
    movedIntoAdverse: number;
  };
  skipped: { applicationId: string; reason: string }[];
}

export interface StressService {
  rateShock(shockBps: number): Promise<RateShockResult>;
}

export function isValidShock(shockBps: number) {
  return Number.isInteger(shockBps) && shockBps >= SHOCK_MIN_BPS && shockBps <= SHOCK_MAX_BPS &&
    shockBps % SHOCK_STEP_BPS === 0;
}

class Unreadable extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Unreadable();
  }
  return value as Record<string, unknown>;
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Unreadable();
  }
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    throw new Unreadable();
  }
  return value;
}

function band(value: unknown): AffordabilityBand {
  if (!AFFORDABILITY_BANDS.includes(value as AffordabilityBand)) {
    throw new Unreadable();
  }
  return value as AffordabilityBand;
}

function figures(value: unknown): ShockFigures {
  const raw = record(value);
  return {
    repaymentEur: number(raw.repayment_eur),
    // al-ai rounds the fraction to 4 places, so the percentage has 2; rounding here drops float noise (0.4198 * 100).
    dtiPct: Math.round(number(raw.dti) * 10_000) / 100,
    surplusEur: number(raw.surplus_eur),
    band: band(raw.band),
  };
}

function shocked(value: unknown): ShockedApplication {
  const raw = record(value);
  const rateSource = raw.rate_source;
  if (rateSource !== 'stored' && rateSource !== 'current') {
    throw new Unreadable();
  }
  const movedInto = raw.moved_into;
  if (movedInto !== null && movedInto !== 'Caution' && movedInto !== 'Adverse') {
    throw new Unreadable();
  }
  return {
    applicationId: text(raw.application_id),
    rateSource,
    benchmarkRatePct: number(raw.benchmark_rate_pct),
    shockedRatePct: number(raw.shocked_rate_pct),
    before: figures(raw.before),
    after: figures(raw.after),
    movedInto,
  };
}

function counts(value: unknown): BandCounts {
  const raw = record(value);
  return Object.fromEntries(
    AFFORDABILITY_BANDS.map((name) => {
      const entry = record(raw[name]);
      return [name, { count: number(entry.count), sharePct: number(entry.share_pct) }];
    }),
  ) as BandCounts;
}

function list(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Unreadable();
  }
  return value;
}

// al-ai's snake_case answer, checked field by field and turned into the portal's names. Anything
// missing or of the wrong type makes the whole answer unreadable rather than half drawn.
export function toRateShockResult(value: unknown): RateShockResult {
  try {
    const raw = record(value);
    const totals = record(raw.totals);
    return {
      shockBps: number(raw.shock_bps),
      applications: list(raw.applications).map(shocked),
      totals: {
        count: number(totals.count),
        before: counts(totals.before),
        after: counts(totals.after),
        movedIntoCaution: number(totals.moved_into_caution),
        movedIntoAdverse: number(totals.moved_into_adverse),
      },
      skipped: list(raw.skipped).map((entry) => {
        const skippedEntry = record(entry);
        return { applicationId: text(skippedEntry.application_id), reason: text(skippedEntry.reason) };
      }),
    };
  } catch (error) {
    if (error instanceof Unreadable) {
      throw new ApiError('response', 'al-ai returned a rate shock result the portal cannot read. Try again.');
    }
    throw error;
  }
}

export function createStressService(client: ApiClient = createApiClient({ baseUrl: AI_BASE_URL })): StressService {
  return {
    async rateShock(shockBps) {
      if (!isValidShock(shockBps)) {
        throw new RangeError(`A rate shock must be ${SHOCK_MIN_BPS} to ${SHOCK_MAX_BPS} bps in steps of ${SHOCK_STEP_BPS}.`);
      }
      const result = toRateShockResult(
        await client.request<unknown>('/ai/portfolio/rate-shock', { method: 'POST', body: { shock_bps: shockBps } }),
      );
      if (result.shockBps !== shockBps) {
        throw new ApiError('response', 'al-ai answered for a different rate shock. Try again.');
      }
      return result;
    },
  };
}

export const apiStressService = createStressService();
