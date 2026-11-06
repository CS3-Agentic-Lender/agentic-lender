import { ApiError, createApiClient, type ApiClient } from './apiClient';

// GET /core/applications/{id}/audit-pack (al-core app/audit_pack.py), with the API's snake_case names.
// The record is the canonical one the audit hash was worked out from, so it is kept exactly as returned.
export interface AuditPackVerification {
  computed_hash: string;
  stored_hash: string;
  loan_note_hash: string | null;
  on_chain_hash: string | null;
  on_chain_checked: boolean;
  calls_match: boolean;
  verified: boolean;
}

export interface AuditPackCall {
  id: string;
  agent: string | null;
  provider: string | null;
  model: string | null;
  output: string | null;
  created_at: string | null;
  sha256: string;
  matches: boolean;
}

export interface AuditPack {
  application_id: string;
  audit_hash: string;
  record: Record<string, unknown>;
  application: Record<string, unknown>;
  valuation: Record<string, unknown> | null;
  affordability: Record<string, unknown> | null;
  policy_gate: Record<string, unknown> | null;
  agent_calls: AuditPackCall[];
  audit_tx_hash: string | null;
  verification: AuditPackVerification;
}

export interface AuditPackService {
  getAuditPack(applicationId: string): Promise<AuditPack>;
}

function isMap(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAuditPack(value: unknown, applicationId: string): value is AuditPack {
  if (!isMap(value) || value.application_id !== applicationId || typeof value.audit_hash !== 'string') {
    return false;
  }
  const { verification } = value;

  return (
    isMap(value.record) &&
    isMap(value.application) &&
    Array.isArray(value.agent_calls) &&
    isMap(verification) &&
    typeof verification.verified === 'boolean' &&
    typeof verification.on_chain_checked === 'boolean' &&
    typeof verification.calls_match === 'boolean'
  );
}

export function createAuditPackService(client: ApiClient = createApiClient()): AuditPackService {
  return {
    async getAuditPack(applicationId) {
      const pack = await client.request<unknown>(
        `/core/applications/${encodeURIComponent(applicationId)}/audit-pack`,
        { method: 'GET' },
      );
      if (!isAuditPack(pack, applicationId)) {
        throw new ApiError('response', 'The server returned an unreadable audit pack. Reload and try again.');
      }
      return pack;
    },
  };
}

export function auditPackFailureMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Could not prepare the audit pack. Please try again.';
  }
  if (error.status === 409) {
    return 'The audit pack is available once the loan note is minted.';
  }
  if (error.status === 401 || error.status === 403 || error.status === 404) {
    return 'You are not allowed to download this audit pack.';
  }
  if (error.kind === 'network') {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return error.message;
}

export const apiAuditPackService = createAuditPackService();
