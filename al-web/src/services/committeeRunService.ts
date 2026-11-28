import { ApiError, createApiClient, type ApiClient } from './apiClient';
import { AI_BASE_URL } from './stressService';

// al-ai's POST /ai/committee/runs (al-ai/app/committee_endpoint.py): an underwriter re-runs the committee for an
// application whose run failed or is stale. The answer comes once the new run is claimed; the run goes on in the
// background and the portal watches it through the committee listener, like any other run.
export interface CommitteeRerunStarted {
  runId: string;
  applicationId: string;
}

// What the endpoint can refuse with, as the console words it:
// 409 is either a run still going or nothing failed/stale to re-run; 403 not an underwriter; 404 no such application;
// 503 the service is stopping or has no listener; 422 a malformed id.
export type CommitteeRerunErrorKind =
  | 'running'
  | 'nothing-to-rerun'
  | 'forbidden'
  | 'not-found'
  | 'unavailable'
  | 'invalid'
  | 'auth'
  | 'network'
  | 'response'
  | 'failed';

export class CommitteeRerunError extends Error {
  constructor(public readonly kind: CommitteeRerunErrorKind, message: string) {
    super(message);
    this.name = 'CommitteeRerunError';
  }
}

export interface CommitteeRunService {
  startCommitteeRerun(applicationId: string): Promise<CommitteeRerunStarted>;
}

// The request body al-ai accepts: a Firestore document id, never a path.
const APPLICATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

// The answer is checked field by field: anything else means the portal cannot tell which run started.
export function toCommitteeRerunStarted(value: unknown, applicationId: string): CommitteeRerunStarted {
  const raw = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (
    raw === null ||
    typeof raw.run_id !== 'string' || !raw.run_id.trim() ||
    raw.application_id !== applicationId ||
    raw.status !== 'running' ||
    raw.trigger !== 'rerun'
  ) {
    throw new CommitteeRerunError('response', 'al-ai returned an answer the portal cannot read. Reload to see whether a new run started.');
  }
  return { runId: raw.run_id, applicationId };
}

// Both refusals are 409 CONFLICT; only al-ai's message tells a run still going from a run with nothing to re-run.
function conflictKind(message: string): CommitteeRerunErrorKind {
  return /still going/i.test(message) ? 'running' : 'nothing-to-rerun';
}

function toRerunError(error: ApiError): CommitteeRerunError {
  if (error.kind === 'network') return new CommitteeRerunError('network', 'Could not reach the AI service. Check your connection and try again.');
  if (error.kind === 'auth') return new CommitteeRerunError('auth', 'Could not confirm your sign-in. Sign in again, then try again.');
  if (error.kind === 'response') return new CommitteeRerunError('response', error.message);
  switch (error.status) {
    case 409:
      return conflictKind(error.message) === 'running'
        ? new CommitteeRerunError('running', 'A run is already in progress. Its progress shows here as it goes.')
        : new CommitteeRerunError('nothing-to-rerun', 'This application has no failed or stale run to re-run.');
    case 401:
      return new CommitteeRerunError('auth', 'Could not confirm your sign-in. Sign in again, then try again.');
    case 403:
      return new CommitteeRerunError('forbidden', 'Only an underwriter can re-run the committee.');
    case 404:
      return new CommitteeRerunError('not-found', 'This application was not found by the AI service.');
    case 422:
      return new CommitteeRerunError('invalid', 'The AI service could not read this application ID.');
    case 503:
      return new CommitteeRerunError('unavailable', 'The AI service cannot start a run right now. Try again shortly.');
    default:
      return new CommitteeRerunError('failed', 'The re-run could not be started. Try again.');
  }
}

export function createCommitteeRunService(client: ApiClient = createApiClient({ baseUrl: AI_BASE_URL })): CommitteeRunService {
  return {
    async startCommitteeRerun(applicationId) {
      if (!APPLICATION_ID.test(applicationId)) {
        throw new CommitteeRerunError('invalid', 'The AI service could not read this application ID.');
      }
      let answer: unknown;
      try {
        answer = await client.request<unknown>('/ai/committee/runs', { method: 'POST', body: { application_id: applicationId } });
      } catch (error) {
        throw error instanceof ApiError ? toRerunError(error) : error;
      }
      return toCommitteeRerunStarted(answer, applicationId);
    },
  };
}

export const apiCommitteeRunService = createCommitteeRunService();
