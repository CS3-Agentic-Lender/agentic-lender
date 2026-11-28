import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from './apiClient';
import { createStressService, isValidFall, toDownturnResult } from './stressService';
import { downturnFixture } from '../components/stress/housePriceFixture';

describe('house downturn response', () => {
  it('reads every backend field unchanged, including percentage units and exact boundary flags', () => {
    const raw = downturnFixture();
    expect(toDownturnResult(raw)).toEqual(raw);
    expect(toDownturnResult(raw).applications[0].after).toMatchObject({ ltv_pct: 80, above_80: false });
    expect(toDownturnResult(raw).applications[1].after).toMatchObject({ ltv_pct: 90, above_90: false });
  });
  it.each([undefined, null, [], { ...downturnFixture(), fall_pct: 11 }, { ...downturnFixture(), note: '' },
    { ...downturnFixture(), totals: { count: 4 } }, { ...downturnFixture(), applications: [{}] },
    { ...downturnFixture(), skipped: [{ application_id: 'x' }] }])('rejects malformed results', (raw) => {
    expect(() => toDownturnResult(raw)).toThrow(ApiError);
  });
  it.each(['loan_type', 'value_basis', 'before', 'after', 'loan_eur', 'starting_value_eur'])('rejects a malformed %s', (key) => {
    const raw = downturnFixture();
    (raw.applications[0] as unknown as Record<string, unknown>)[key] = 'invalid';
    expect(() => toDownturnResult(raw)).toThrow(ApiError);
  });
  it.each([null, 1, 'true', undefined])('requires actual boolean flags', (value) => {
    const raw = downturnFixture();
    (raw.applications[0].after as unknown as Record<string, unknown>).above_90 = value;
    expect(() => toDownturnResult(raw)).toThrow(ApiError);
  });
  it.each([NaN, Infinity, -1])('rejects non-finite and negative amounts', (value) => {
    const raw = downturnFixture(); raw.totals.after.above_90.loan_eur = value;
    expect(() => toDownturnResult(raw)).toThrow(ApiError);
  });
});
describe('house downturn request', () => {
  it.each([0, 5, 10, 20, 30, 40])('posts %s percent using the API client', async (fall) => {
    const request = vi.fn<ApiClient['request']>().mockResolvedValue(downturnFixture(fall));
    expect(isValidFall(fall)).toBe(true);
    expect(await createStressService({ request } as ApiClient).houseDownturn(fall)).toEqual(downturnFixture(fall));
    expect(request).toHaveBeenCalledExactlyOnceWith('/ai/portfolio/downturn', { method: 'POST', body: { fall_pct: fall } });
  });
  it.each([-5, 1, 10.5, 45, NaN, Infinity])('never sends invalid fall %s', async (fall) => {
    const request = vi.fn<ApiClient['request']>();
    expect(isValidFall(fall)).toBe(false);
    await expect(createStressService({ request } as ApiClient).houseDownturn(fall)).rejects.toThrow(RangeError);
    expect(request).not.toHaveBeenCalled();
  });
  it('refuses an answer for another fall', async () => {
    const request = vi.fn<ApiClient['request']>().mockResolvedValue(downturnFixture(20));
    await expect(createStressService({ request } as ApiClient).houseDownturn(10)).rejects.toThrow('different price fall');
  });
  it('preserves denied and failed responses', async () => {
    const denied = new ApiError('http', 'Forbidden', 403);
    const request = vi.fn<ApiClient['request']>().mockRejectedValue(denied);
    await expect(createStressService({ request } as ApiClient).houseDownturn(10)).rejects.toBe(denied);
  });
});
