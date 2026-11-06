import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './apiClient';

function setup(response: Response = Response.json({ saved: true })) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  const authService = { getCurrentIdToken: vi.fn().mockResolvedValue('test-id-token') };
  return { fetcher, authService, client: createApiClient({ fetcher, authService }) };
}

describe('JSON API client', () => {
  it('sends one bearer-authenticated JSON POST to the gateway and returns the response', async () => {
    const { client, fetcher, authService } = setup();
    const body = { outcome: 'approved', reason: 'Reviewed the file.' };
    await expect(client.request('/core/applications/a/decision', { method: 'POST', body })).resolves.toEqual({ saved: true });
    expect(authService.getCurrentIdToken).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('http://localhost:8000/core/applications/a/decision', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-id-token', Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  });

  it('supports authenticated GET and an injected base URL', async () => {
    const { fetcher, authService } = setup();
    const client = createApiClient({ fetcher, authService, baseUrl: 'https://api.example.test/' });
    await client.request('/core/applications/a', { method: 'GET' });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://api.example.test/core/applications/a', {
      method: 'GET', headers: { Authorization: 'Bearer test-id-token', Accept: 'application/json' },
    });
  });

  it('uses VITE_API_BASE_URL when configured', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://gateway.example.test');
    try {
      const { client, fetcher } = setup();
      await client.request('/core/me', { method: 'GET' });
      expect(fetcher.mock.calls[0][0]).toBe('https://gateway.example.test/core/me');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    [409, { detail: 'This application is already decided.' }, 'This application is already decided.'],
    [422, { detail: [{ msg: 'Reason is too long' }, { msg: 'Second issue' }] }, 'Reason is too long'],
    [500, { detail: {} }, 'The request failed. Please try again.'],
  ])('maps HTTP %s without retrying', async (status, body, message) => {
    const { client, fetcher } = setup(Response.json(body, { status }));
    const error = await client.request('/core/test', { method: 'POST' }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'http', status, message });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('keeps an HTTP status even when its error body is not JSON', async () => {
    const { client } = setup(new Response('Bad gateway', { status: 502 }));
    await expect(client.request('/core/test', { method: 'GET' })).rejects.toMatchObject({ kind: 'http', status: 502 });
  });

  it('distinguishes a network failure from an HTTP error without retrying', async () => {
    const { client, fetcher } = setup();
    fetcher.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(client.request('/core/test', { method: 'POST' })).rejects.toMatchObject({ kind: 'network', status: null });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not send a request when obtaining the token fails', async () => {
    const { client, fetcher, authService } = setup();
    authService.getCurrentIdToken.mockRejectedValue(new Error('Signed out'));
    await expect(client.request('/core/test', { method: 'POST' })).rejects.toMatchObject({ kind: 'auth' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
