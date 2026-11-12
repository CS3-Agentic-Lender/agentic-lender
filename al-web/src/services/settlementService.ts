import { ApiError, createApiClient, type ApiClient } from './apiClient';

export interface SettlementResult {
  id: string;
  status: 'Funded';
}

export interface SettlementService {
  mint(applicationId: string): Promise<SettlementResult>;
}

export function createSettlementService(client: ApiClient = createApiClient()): SettlementService {
  return {
    async mint(applicationId) {
      const result = await client.request<SettlementResult>(
        `/core/applications/${encodeURIComponent(applicationId)}/mint`,
        { method: 'POST' },
      );
      if (result?.id !== applicationId || result.status !== 'Funded') {
        throw new ApiError('response', 'The server returned an unreadable mint result. Reload to see the current status.');
      }
      return { id: result.id, status: result.status };
    },
  };
}

export function mintFailureMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Could not mint the loan note. Please try again.';
  }
  if (error.status === 401 || error.status === 403) {
    return 'You are not allowed to mint this loan note.';
  }
  if (error.kind === 'network') {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return error.message;
}

export const apiSettlementService = createSettlementService();
