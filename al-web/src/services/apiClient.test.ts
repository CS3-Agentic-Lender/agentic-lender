import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiBaseUrl, createApiClient, serviceUrl } from './apiClient';

describe('API base URL', () => {
  it('falls back to the local gateway only in a development build', () => {
    expect(apiBaseUrl(undefined, true)).toBe('http://localhost:8000');
    expect(apiBaseUrl('  ', true)).toBe('http://localhost:8000');
    expect(() => apiBaseUrl(undefined, false)).toThrow('Missing required API configuration: VITE_API_BASE_URL');
  });

  it('accepts a configured https gateway in a production build', () => {
    expect(apiBaseUrl('https://api.example.test', false)).toBe('https://api.example.test');
  });

  it.each(['http://api.example.test', 'https://localhost:8000', 'http://127.0.0.1:8000', 'api.example.test'])(
    'refuses %s in a production build',
    (configured) => {
      expect(() => apiBaseUrl(configured, false)).toThrow(/VITE_API_BASE_URL must be/);
    },
  );

  it('keeps any configured gateway in a development build', () => {
    expect(apiBaseUrl('http://localhost:8001', true)).toBe('http://localhost:8001');
  });

  it('names the variable it checks, so another service URL gets the same rule', () => {
    expect(serviceUrl('VITE_OTHER_URL', undefined, true, 'http://localhost:5001')).toBe('http://localhost:5001');
    expect(() => serviceUrl('VITE_OTHER_URL', undefined, false, 'http://localhost:5001')).toThrow(
      'Missing required API configuration: VITE_OTHER_URL',
    );
    expect(() => serviceUrl('VITE_OTHER_URL', 'http://[::1]:5001', false, 'http://localhost:5001')).toThrow(
      'VITE_OTHER_URL must be an https:// URL that is not localhost in a production build',
    );
  });
});

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
    [409, { error: { code: 'CONFLICT', message: 'This application is already decided.', field: null, request_id: 'r-1' } }, 'This application is already decided.'],
    [422, { error: { code: 'INVALID_FIELD', message: 'reason: String should have at most 1000 characters', field: 'reason', request_id: 'r-2' } }, 'reason: String should have at most 1000 characters'],
    [502, { error: { code: 'INTERNAL', message: 'a different audit hash is already stored for this application', field: null, request_id: 'r-3' } }, 'a different audit hash is already stored for this application'],
    [500, { error: { code: 'INTERNAL', message: '  ', field: null, request_id: 'r-4' } }, 'The request failed. Please try again.'],
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

  it('keeps the field al-core names on a refusal', async () => {
    const body = { error: { code: 'INVALID_FIELD', message: 'firm: is required for a broker', field: 'firm', request_id: 'r-5' } };
    const { client } = setup(Response.json(body, { status: 422 }));
    await expect(client.request('/core/admin/staff', { method: 'POST' })).rejects.toMatchObject({
      status: 422,
      field: 'firm',
      message: 'firm: is required for a broker',
    });
  });

  it('sends PATCH with a JSON body and DELETE without one', async () => {
    const { client, fetcher } = setup(Response.json({ uid: 'u1' }));
    fetcher.mockResolvedValueOnce(Response.json({ uid: 'u1' })).mockResolvedValueOnce(Response.json({ deleted: 'u1' }));
    await client.request('/core/admin/staff/u1', { method: 'PATCH', body: { disabled: true } });
    await expect(client.request('/core/admin/staff/u1', { method: 'DELETE' })).resolves.toEqual({ deleted: 'u1' });
    expect(fetcher.mock.calls.map(([, init]) => [init?.method, init?.body])).toEqual([
      ['PATCH', JSON.stringify({ disabled: true })],
      ['DELETE', undefined],
    ]);
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
