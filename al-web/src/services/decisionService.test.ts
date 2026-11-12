import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from './apiClient';
import { createDecisionService } from './decisionService';

describe('decision service', () => {
  it.each(['approved', 'declined'] as const)('posts the agreed %s contract and returns the backend result', async (outcome) => {
    const result = { id: 'app a', status: outcome === 'approved' ? 'Underwriter Approved' : 'Declined', decision: { outcome } };
    const request = vi.fn<ApiClient['request']>().mockResolvedValue(result);
    await expect(createDecisionService({ request: request as ApiClient['request'] }).signOff('app a', outcome, 'Reviewed.')).resolves.toEqual(result);
    expect(request).toHaveBeenCalledExactlyOnceWith('/core/applications/app%20a/decision', {
      method: 'POST', body: { outcome, reason: 'Reviewed.' },
    });
  });

  it('preserves typed errors without retrying', async () => {
    const error = new ApiError('http', 'Already decided', 409);
    const request = vi.fn<ApiClient['request']>().mockRejectedValue(error);
    await expect(createDecisionService({ request: request as ApiClient['request'] }).signOff('a', 'declined', 'Reviewed.')).rejects.toBe(error);
    expect(request).toHaveBeenCalledOnce();
  });

  it('does not manufacture a decision from an incomplete response', async () => {
    const request = vi.fn<ApiClient['request']>().mockResolvedValue({ id: 'a', status: 'AI Deliberated' });
    await expect(createDecisionService({ request: request as ApiClient['request'] }).signOff('a', 'approved', 'Reviewed.')).rejects.toMatchObject({ kind: 'response' });
  });
});
