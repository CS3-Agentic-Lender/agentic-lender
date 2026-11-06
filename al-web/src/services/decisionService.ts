import { ApiError, createApiClient, type ApiClient } from './apiClient';
import { DECISION_OUTCOMES, type DecisionOutcome } from './loanFileService';

// The fields this screen uses from al-core's ApplicationOut (API names, not Firestore names).
export interface DecisionResult {
  id: string;
  status: string;
  decision: { outcome: DecisionOutcome };
}

export interface DecisionService {
  signOff(applicationId: string, outcome: DecisionOutcome, reason: string): Promise<DecisionResult>;
}

export function createDecisionService(client: ApiClient = createApiClient()): DecisionService {
  return {
    async signOff(applicationId, outcome, reason) {
      const result = await client.request<DecisionResult>(
        `/core/applications/${encodeURIComponent(applicationId)}/decision`,
        { method: 'POST', body: { outcome, reason } },
      );
      if (result?.id !== applicationId || typeof result.status !== 'string' ||
          !DECISION_OUTCOMES.includes(result.decision?.outcome)) {
        throw new ApiError('response', 'The server returned an unreadable decision. Reload to see the current status.');
      }
      return result;
    },
  };
}

export const apiDecisionService = createDecisionService();
