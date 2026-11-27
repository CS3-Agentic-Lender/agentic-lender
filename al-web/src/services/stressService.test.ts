import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from './apiClient';
import { aiBaseUrl, createStressService, isValidShock, toRateShockResult } from './stressService';

// al-ai's answer for one application at +200 bps, as app/rate_shock.py builds it.
function answer(overrides: Record<string, unknown> = {}) {
  return {
    shock_bps: 200,
    applications: [
      {
        application_id: 'app-applied',
        rate_source: 'stored',
        benchmark_rate_pct: 4.0,
        shocked_rate_pct: 6.0,
        before: { repayment_eur: 1432.25, dti: 0.3349, surplus_eur: 1367.75, band: 'Comfortable' },
        after: { repayment_eur: 1798.65, dti: 0.4198, surplus_eur: 1001.35, band: 'Caution' },
        moved_into: 'Caution',
      },
    ],
    totals: {
      count: 1,
      before: {
        Comfortable: { count: 1, share_pct: 100.0 },
        Caution: { count: 0, share_pct: 0.0 },
        Adverse: { count: 0, share_pct: 0.0 },
      },
      after: {
        Comfortable: { count: 0, share_pct: 0.0 },
        Caution: { count: 1, share_pct: 100.0 },
        Adverse: { count: 0, share_pct: 0.0 },
      },
      moved_into_caution: 1,
      moved_into_adverse: 0,
    },
    skipped: [{ application_id: 'app-draftish', reason: 'a figure on the application is not a number' }],
    ...overrides,
  };
}

function client(response: unknown) {
  const request = vi.fn<ApiClient['request']>().mockResolvedValue(response);
  return { client: { request } as ApiClient, request };
}

describe('reading the rate shock answer', () => {
  it('maps al-ai fields to the portal names and turns the debt-to-income fraction into a percentage', () => {
    const result = toRateShockResult(answer());

    expect(result.shockBps).toBe(200);
    expect(result.applications[0]).toEqual({
      applicationId: 'app-applied',
      rateSource: 'stored',
      benchmarkRatePct: 4.0,
      shockedRatePct: 6.0,
      before: { repaymentEur: 1432.25, dtiPct: 33.49, surplusEur: 1367.75, band: 'Comfortable' },
      after: { repaymentEur: 1798.65, dtiPct: 41.98, surplusEur: 1001.35, band: 'Caution' },
      movedInto: 'Caution',
    });
    expect(result.totals.after.Caution).toEqual({ count: 1, sharePct: 100 });
    expect(result.totals.movedIntoCaution).toBe(1);
    expect(result.skipped).toEqual([
      { applicationId: 'app-draftish', reason: 'a figure on the application is not a number' },
    ]);
  });

  it.each([
    ['a band al-ai does not use', { totals: { ...answer().totals, after: { ...answer().totals.after, Caution: undefined } } }],
    ['a figure sent as text', { shock_bps: '200' }],
    ['an unknown rate source', { applications: [{ ...answer().applications[0], rate_source: 'guessed' }] }],
    ['a band name that is not one of the three', {
      applications: [{ ...answer().applications[0], after: { ...answer().applications[0].after, band: 'Elevated' } }],
    }],
    ['no list of skipped applications', { skipped: null }],
  ])('refuses the whole answer when it has %s', (_name, overrides) => {
    expect(() => toRateShockResult(answer(overrides))).toThrow(ApiError);
  });
});

describe('the rate shock request', () => {
  it('posts the shock to al-ai and returns the mapped result', async () => {
    const { client: api, request } = client(answer());

    const result = await createStressService(api).rateShock(200);

    expect(request).toHaveBeenCalledExactlyOnceWith('/ai/portfolio/rate-shock', {
      method: 'POST',
      body: { shock_bps: 200 },
    });
    expect(result.totals.count).toBe(1);
  });

  it('refuses an answer for a different shock than the one asked for', async () => {
    const { client: api } = client(answer({ shock_bps: 100 }));

    await expect(createStressService(api).rateShock(200)).rejects.toThrow('different rate shock');
  });

  it.each([75, 99, 110, 325, 200.5])('never sends %s bps, which al-ai would refuse', async (shockBps) => {
    const { client: api, request } = client(answer());

    expect(isValidShock(shockBps)).toBe(false);
    await expect(createStressService(api).rateShock(shockBps)).rejects.toThrow(RangeError);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([100, 125, 200, 275, 300])('accepts %s bps', (shockBps) => {
    expect(isValidShock(shockBps)).toBe(true);
  });
});

describe('where the rate shock is sent', () => {
  it('uses the deployed gateway when no al-ai address is set, never localhost', () => {
    expect(aiBaseUrl(undefined, 'https://api.agentic-lender.com', false)).toBe('https://api.agentic-lender.com');
    expect(aiBaseUrl('  ', 'https://api.agentic-lender.com', false)).toBe('https://api.agentic-lender.com');
  });

  it('uses the al-ai address when one is set', () => {
    expect(aiBaseUrl('https://ai.example.test', 'https://api.agentic-lender.com', false)).toBe('https://ai.example.test');
  });

  it('talks to al-ai on the laptop during development', () => {
    expect(aiBaseUrl(undefined, undefined, true)).toBe('http://localhost:5001');
  });

  it('refuses to build without any address rather than calling localhost', () => {
    expect(() => aiBaseUrl(undefined, undefined, false)).toThrow('Missing required API configuration: VITE_API_BASE_URL');
  });
});