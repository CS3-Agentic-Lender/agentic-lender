import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, type ApiClient } from './apiClient';
import { createSettlementService, mintFailureMessage } from './settlementService';

describe('settlement service', () => {
  it('posts the encoded application path without a body and returns the confirmed result', async () => {
    const result = { id: 'app a', status: 'Funded' };
    const request = vi.fn<ApiClient['request']>().mockResolvedValue(result);
    await expect(createSettlementService({ request: request as ApiClient['request'] }).mint('app a')).resolves.toEqual(result);
    expect(request).toHaveBeenCalledExactlyOnceWith('/core/applications/app%20a/mint', { method: 'POST' });
  });

  it.each([200, 201])('accepts HTTP %s through the authenticated API client', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'a', status: 'Funded' }, { status }));
    const service = createSettlementService(createApiClient({
      fetcher, authService: { getCurrentIdToken: async () => 'test-token' }, baseUrl: 'https://api.example.test',
    }));
    await expect(service.mint('a')).resolves.toEqual({ id: 'a', status: 'Funded' });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://api.example.test/core/applications/a/mint', {
      method: 'POST', headers: { Authorization: 'Bearer test-token', Accept: 'application/json' },
    });
  });

  it.each([409, 502, 503, 401, 403])('maps HTTP %s and does not retry', async (status) => {
    const detail = 'Backend mint detail';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ detail }, { status }));
    const service = createSettlementService(createApiClient({ fetcher, authService: { getCurrentIdToken: async () => 'token' } }));
    const error = await service.mint('a').catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'http', status, message: detail });
    expect(mintFailureMessage(error)).toBe([401, 403].includes(status)
      ? 'You are not allowed to mint this loan note.' : detail);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('maps a network failure without retrying', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    const service = createSettlementService(createApiClient({ fetcher, authService: { getCurrentIdToken: async () => 'token' } }));
    const error = await service.mint('a').catch((failure: unknown) => failure);
    expect(mintFailureMessage(error)).toBe('Could not reach the server. Check your connection and try again.');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([null, {}, { id: 'other', status: 'Funded' }, { id: 'a', status: 'Underwriter Approved' }])(
    'rejects an unconfirmed or malformed response (%j)', async (result) => {
      const request = vi.fn<ApiClient['request']>().mockResolvedValue(result);
      await expect(createSettlementService({ request: request as ApiClient['request'] }).mint('a')).rejects.toMatchObject({ kind: 'response' });
    },
  );
});
