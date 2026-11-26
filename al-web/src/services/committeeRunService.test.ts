import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, type ApiClient } from './apiClient';
import { CommitteeRerunError, createCommitteeRunService, toCommitteeRerunStarted } from './committeeRunService';

// al-ai's 201 answer, as app/committee_endpoint.py builds it.
const started = { run_id: 'run-2', application_id: 'app-1', status: 'running', trigger: 'rerun' };

function client(response: unknown) {
  const request = vi.fn<ApiClient['request']>().mockResolvedValue(response);
  return { client: { request } as ApiClient, request };
}

function failing(error: unknown) {
  const request = vi.fn<ApiClient['request']>().mockRejectedValue(error);
  return { request } as ApiClient;
}

// A real api client over a fake fetch, so al-ai's error body goes through the same reading as in production.
function overFetch(status: number, body: unknown) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
  const api = createApiClient({ authService: { getCurrentIdToken: async () => 'id-token' }, fetcher, baseUrl: 'http://ai.test/' });
  return { service: createCommitteeRunService(api), fetcher };
}

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(CommitteeRerunError);
  return error as CommitteeRerunError;
}

describe('reading the re-run answer', () => {
  it('takes the new run id from the real answer shape', () => {
    expect(toCommitteeRerunStarted(started, 'app-1')).toEqual({ runId: 'run-2', applicationId: 'app-1' });
  });

  it.each([
    ['null', null],
    ['a list', [started]],
    ['no run id', { ...started, run_id: undefined }],
    ['a blank run id', { ...started, run_id: '  ' }],
    ['a number run id', { ...started, run_id: 7 }],
    ['another application', { ...started, application_id: 'app-9' }],
    ['another status', { ...started, status: 'complete' }],
    ['another trigger', { ...started, trigger: 'submit' }],
  ])('rejects an answer with %s', (_label, value) => {
    expect(() => toCommitteeRerunStarted(value, 'app-1')).toThrow(CommitteeRerunError);
    try {
      toCommitteeRerunStarted(value, 'app-1');
    } catch (error) {
      expect((error as CommitteeRerunError).kind).toBe('response');
    }
  });
});

describe('starting a re-run', () => {
  it('posts the application id to al-ai once and returns the new run', async () => {
    const { client: api, request } = client(started);
    await expect(createCommitteeRunService(api).startCommitteeRerun('app-1')).resolves.toEqual({ runId: 'run-2', applicationId: 'app-1' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/ai/committee/runs', { method: 'POST', body: { application_id: 'app-1' } });
  });

  it('sends the Firebase ID token and JSON body to the AI service URL', async () => {
    const { service, fetcher } = overFetch(201, started);
    await service.startCommitteeRerun('app-1');
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('http://ai.test/ai/committee/runs');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer id-token');
    expect(init?.body).toBe(JSON.stringify({ application_id: 'app-1' }));
  });

  it('rejects a malformed answer', async () => {
    const { client: api } = client({ run_id: 'run-2' });
    expect((await rejection(createCommitteeRunService(api).startCommitteeRerun('app-1'))).kind).toBe('response');
  });

  it('refuses an id al-ai would not accept without calling it', async () => {
    const { client: api, request } = client(started);
    for (const id of ['', 'a/b', 'x'.repeat(129)]) {
      expect((await rejection(createCommitteeRunService(api).startCommitteeRerun(id))).kind).toBe('invalid');
    }
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [409, 'CONFLICT', "The application's committee run is still going: watch aiRunStatus for its result", 'running', 'A run is already in progress'],
    [409, 'CONFLICT', "The application has no failed or stale committee run to re-run", 'nothing-to-rerun', 'no failed or stale run'],
    [403, 'FORBIDDEN', 'Only an underwriter can re-run the committee', 'forbidden', 'Only an underwriter'],
    [404, 'NOT_FOUND', 'No application has that id', 'not-found', 'not found'],
    [422, 'VALIDATION_ERROR', 'bad body', 'invalid', 'could not read'],
    [503, 'UPSTREAM_UNAVAILABLE', 'The service is shutting down', 'unavailable', 'cannot start a run right now'],
    [500, 'INTERNAL', 'boom', 'failed', 'could not be started'],
  ])('turns a %i %s into a typed error', async (status, code, message, kind, words) => {
    const { service } = overFetch(status, { error: { code, message } });
    const error = await rejection(service.startCommitteeRerun('app-1'));
    expect(error.kind).toBe(kind);
    expect(error.message).toContain(words);
  });

  it('turns a network failure into a network error', async () => {
    const api = failing(new ApiError('network', 'Could not reach the server.'));
    const error = await rejection(createCommitteeRunService(api).startCommitteeRerun('app-1'));
    expect(error.kind).toBe('network');
    expect(error.message).toContain('Could not reach the AI service');
  });

  it('turns a sign-in failure into an auth error', async () => {
    const api = failing(new ApiError('auth', 'no token'));
    expect((await rejection(createCommitteeRunService(api).startCommitteeRerun('app-1'))).kind).toBe('auth');
  });
});
