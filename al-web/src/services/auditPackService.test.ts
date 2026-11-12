import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, type ApiClient } from './apiClient';
import { auditPackFailureMessage, createAuditPackService } from './auditPackService';

const pack = {
  application_id: 'app a',
  audit_hash: 'h',
  record: { applicationId: 'app a' },
  application: { id: 'app a', status: 'Funded' },
  valuation: null,
  affordability: null,
  policy_gate: null,
  agent_calls: [],
  audit_tx_hash: null,
  verification: {
    computed_hash: 'h', stored_hash: 'h', loan_note_hash: 'h', on_chain_hash: null,
    on_chain_checked: false, calls_match: true, verified: true,
  },
};

describe('audit pack service', () => {
  it('gets the encoded application path and returns the pack as received', async () => {
    const request = vi.fn<ApiClient['request']>().mockResolvedValue(pack);
    await expect(createAuditPackService({ request: request as ApiClient['request'] }).getAuditPack('app a')).resolves.toEqual(pack);
    expect(request).toHaveBeenCalledExactlyOnceWith('/core/applications/app%20a/audit-pack', { method: 'GET' });
  });

  it('sends the bearer token through the API client', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...pack, application_id: 'a' }));
    const service = createAuditPackService(createApiClient({
      fetcher, authService: { getCurrentIdToken: async () => 'test-token' }, baseUrl: 'https://api.example.test',
    }));
    await service.getAuditPack('a');
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://api.example.test/core/applications/a/audit-pack', {
      method: 'GET', headers: { Authorization: 'Bearer test-token', Accept: 'application/json' },
    });
  });

  it.each([
    null,
    { ...pack, application_id: 'other' },
    { ...pack, record: null },
    { ...pack, agent_calls: {} },
    { ...pack, verification: { ...pack.verification, verified: 'yes' } },
  ])('rejects an unreadable pack (%j)', async (result) => {
    const request = vi.fn<ApiClient['request']>().mockResolvedValue(result);
    await expect(createAuditPackService({ request: request as ApiClient['request'] }).getAuditPack('app a'))
      .rejects.toMatchObject({ kind: 'response' });
  });

  it.each([
    [new ApiError('http', 'available once the loan note is minted', 409), 'The audit pack is available once the loan note is minted.'],
    [new ApiError('http', 'Forbidden', 403), 'You are not allowed to download this audit pack.'],
    [new ApiError('http', 'Not found', 404), 'You are not allowed to download this audit pack.'],
    [new ApiError('network', 'offline'), 'Could not reach the server. Check your connection and try again.'],
    [new ApiError('http', 'Server detail', 500), 'Server detail'],
    [new Error('boom'), 'Could not prepare the audit pack. Please try again.'],
  ])('maps %s', (error, message) => {
    expect(auditPackFailureMessage(error)).toBe(message);
  });
});
