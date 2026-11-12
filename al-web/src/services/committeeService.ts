import {
  collection, doc, onSnapshot, query, where,
  type DocumentData, type FirestoreError,
} from 'firebase/firestore';
import type { PortalRole } from './authService';
import { readDate, readNumber, readString } from './clientsService';
import { db } from './firebase';
import { isDocumentId } from './loanFileService';

export const VOTING_AGENTS = ['affordability', 'valuation', 'strategist'] as const;
export type VotingAgent = (typeof VOTING_AGENTS)[number];
export type Recommendation = 'Approve' | 'Conditionally Approve' | 'Decline';
export interface CommitteeViewer { uid: string; role: PortalRole }

export interface CommitteeAgent {
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  report: string | null;
  recommendation: Recommendation | null;
  rating: string | null;
  concerns: string[] | null;
  conditions: string[] | null;
}

export interface CommitteeRun {
  id: string;
  applicationId: string | null;
  brokerId: string | null;
  status: 'running' | 'failed' | 'complete' | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  failedStep: string | null;
  failureReason: string | null;
  creditMemo: string | null;
  originalRecommendation: Recommendation | null;
  effectiveRecommendation: Recommendation | null;
  consensus: { votes: Record<VotingAgent, Recommendation | null>; disagreement: boolean | null };
  policyGate: {
    original: Recommendation | null;
    effective: Recommendation | null;
    conditions: string[] | null;
    breaches: string[] | null;
    changed: boolean | null;
  } | null;
  agents: Record<VotingAgent | 'market', CommitteeAgent | null>;
}

export interface CommitteeCall {
  id: string;
  agent: string | null;
  provider: string | null;
  model: string | null;
  output: string | null;
  latencyMs: number | null;
  createdAt: Date | null;
}

export type CommitteeState =
  | { status: 'loading' | 'missing' | 'permission-denied' | 'error' }
  | { status: 'ready'; run: CommitteeRun };
export type CommitteeCallsState =
  | { status: 'loading' | 'permission-denied' | 'error' }
  | { status: 'ready'; calls: CommitteeCall[] };

export interface CommitteeService {
  subscribeToRun(applicationId: string, viewer: CommitteeViewer, listener: (state: CommitteeState) => void): () => void;
  subscribeToCalls(runId: string, viewer: CommitteeViewer, listener: (state: CommitteeCallsState) => void): () => void;
}

function map(value: unknown): DocumentData {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function recommendation(value: unknown): Recommendation | null {
  return value === 'Approve' || value === 'Conditionally Approve' || value === 'Decline' ? value : null;
}

function agent(value: unknown): CommitteeAgent | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = map(value);
  return {
    provider: readString(data.provider), model: readString(data.model),
    promptVersion: readString(data.promptVersion), report: readString(data.report),
    recommendation: recommendation(data.recommendation), rating: readString(data.rating),
    concerns: strings(data.concerns), conditions: strings(data.conditions),
  };
}

export function toCommitteeRun(id: string, data: DocumentData): CommitteeRun {
  const agents = map(data.agents);
  const consensus = map(data.consensus);
  const votes = map(consensus.votes);
  const gate = map(data.policyGate);
  return {
    id, applicationId: readString(data.applicationId), brokerId: readString(data.brokerId),
    status: ['running', 'failed', 'complete'].includes(data.status) ? data.status : null,
    startedAt: readDate(data.startedAt), finishedAt: readDate(data.finishedAt),
    failedStep: readString(data.failedStep), failureReason: readString(data.failureReason),
    creditMemo: readString(data.creditMemo),
    originalRecommendation: recommendation(data.originalRecommendation),
    effectiveRecommendation: recommendation(data.effectiveRecommendation),
    consensus: {
      votes: {
        affordability: recommendation(votes.affordability), valuation: recommendation(votes.valuation),
        strategist: recommendation(votes.strategist),
      },
      disagreement: boolean(consensus.disagreement),
    },
    policyGate: data.policyGate == null ? null : {
      original: recommendation(gate.original), effective: recommendation(gate.effective),
      changed: boolean(gate.changed), conditions: strings(gate.conditions), breaches: strings(gate.breaches),
    },
    agents: {
      affordability: agent(agents.affordability), valuation: agent(agents.valuation),
      strategist: agent(agents.strategist), market: agent(agents.market),
    },
  };
}

export function toCommitteeCall(id: string, data: DocumentData): CommitteeCall {
  const latency = readNumber(data.latencyMs);
  return {
    id, agent: readString(data.agent), provider: readString(data.provider), model: readString(data.model),
    output: readString(data.output), latencyMs: latency !== null && latency >= 0 ? latency : null,
    createdAt: readDate(data.createdAt),
  };
}

function scopedQuery(name: 'ai_runs' | 'ai_calls', field: 'applicationId' | 'runId', id: string, viewer: CommitteeViewer) {
  // Broker rules require this constraint on the query, even when an application/run ID is known.
  return query(collection(db, name), where(field, '==', id),
    ...(viewer.role === 'broker' ? [where('brokerId', '==', viewer.uid)] : []));
}

function errorStatus(error: FirestoreError): 'permission-denied' | 'error' {
  return error.code === 'permission-denied' ? 'permission-denied' : 'error';
}

export const firestoreCommitteeService: CommitteeService = {
  subscribeToRun(applicationId, viewer, listener) {
    if (!isDocumentId(applicationId)) {
      listener({ status: 'error' });
      return () => {};
    }
    let stopped = false;
    let generation = 0;
    let selection: string | null | undefined;
    let stopRun = () => {};
    let stopApplication = () => {};
    const stop = () => {
      if (stopped) return;
      stopped = true;
      ++generation;
      stopRun();
      stopApplication();
    };
    const fail = (error: FirestoreError) => {
      if (stopped) return;
      listener({ status: errorStatus(error) });
      stop();
    };
    listener({ status: 'loading' });
    stopApplication = onSnapshot(doc(db, 'applications', applicationId), { includeMetadataChanges: true }, (snapshot) => {
      // Wait for server authorisation, including after a user change; cached data isn't proof of access.
      if (stopped || snapshot.metadata.fromCache) return;
      const application = snapshot.data();
      if (!application || (viewer.role === 'broker' && application.brokerId !== viewer.uid)) {
        listener({ status: application ? 'permission-denied' : 'missing' });
        stop();
        return;
      }
      const runId = readString(application.aiRunId);
      if (selection === runId) return;
      selection = runId;
      const current = ++generation;
      stopRun();
      listener({ status: 'loading' });
      const active = () => !stopped && current === generation;
      const receive = (run: CommitteeRun | null) => {
        if (!active()) return;
        if (run && (run.applicationId !== applicationId || (viewer.role === 'broker' && run.brokerId !== viewer.uid))) {
          listener({ status: 'error' });
          return;
        }
        listener(run ? { status: 'ready', run } : { status: 'missing' });
      };
      const onError = (error: FirestoreError) => { if (active()) fail(error); };
      if (runId !== null) {
        if (!isDocumentId(runId)) {
          listener({ status: 'error' });
          return;
        }
        stopRun = onSnapshot(doc(db, 'ai_runs', runId), { includeMetadataChanges: true }, (runSnapshot) => {
          if (runSnapshot.metadata.fromCache) return;
          const data = runSnapshot.data();
          receive(data ? toCommitteeRun(runSnapshot.id, data) : null);
        }, onError);
      } else {
        // No ordered-query index exists. Sort the authorised results by startedAt in the client.
        stopRun = onSnapshot(scopedQuery('ai_runs', 'applicationId', applicationId, viewer), { includeMetadataChanges: true }, (runs) => {
          if (runs.metadata.fromCache) return;
          const latest = runs.docs.map((entry) => toCommitteeRun(entry.id, entry.data()))
            .sort((a, b) => (b.startedAt?.getTime() ?? -Infinity) - (a.startedAt?.getTime() ?? -Infinity) || a.id.localeCompare(b.id))[0];
          receive(latest ?? null);
        }, onError);
      }
    }, fail);
    return stop;
  },

  subscribeToCalls(runId, viewer, listener) {
    let active = true;
    listener({ status: 'loading' });
    const stop = onSnapshot(scopedQuery('ai_calls', 'runId', runId, viewer), { includeMetadataChanges: true }, (snapshot) => {
      if (!active || snapshot.metadata.fromCache) return;
      const calls = snapshot.docs.map((entry) => toCommitteeCall(entry.id, entry.data()))
        .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) || a.id.localeCompare(b.id));
      listener({ status: 'ready', calls });
    }, (error) => {
      if (!active) return;
      active = false;
      listener({ status: errorStatus(error) });
    });
    return () => { active = false; stop(); };
  },
};
