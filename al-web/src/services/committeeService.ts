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

// SCHEMA.md `ai_runs.steps`, in the order al-ai runs them.
export const COMMITTEE_STEPS = [
  'validate', 'valuation_model', 'market', 'calculations', 'affordability', 'valuation_agent', 'strategist', 'policy_gate',
] as const;
export type CommitteeStep = (typeof COMMITTEE_STEPS)[number];
export type StepStatus = 'queued' | 'running' | 'ok' | 'failed';
export interface StepProgress {
  status: StepStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  failureReason: string | null;
}

export interface CommitteeRun {
  id: string;
  applicationId: string | null;
  brokerId: string | null;
  status: 'running' | 'failed' | 'complete' | null;
  // SCHEMA.md: `submit` or `rerun`; `rerunOf` is the failed or stale run a re-run repeats.
  trigger: 'submit' | 'rerun' | null;
  rerunOf: string | null;
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
  // Each step's progress while the run goes. Null on a run stored before al-ai wrote progress.
  steps: Record<CommitteeStep, StepProgress> | null;
}

export const CALL_OUTCOMES = ['ok', 'invalid_reply', 'provider_error', 'missing_key', 'error', 'reused'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export type MarketOutlook = 'rising' | 'stable' | 'falling';
export interface MarketSource { url: string; date: string }

// The Market & Macro model call's checked reply (al-ai market_agent.check_reply): exactly outlook, summary and sources.
export interface MarketReply {
  outlook: MarketOutlook | null;
  summary: string | null;
  // Null when the stored list is absent or any item is not a {url, date} pair with a web address.
  sources: MarketSource[] | null;
}

export interface CommitteeCall {
  id: string;
  agent: string | null;
  provider: string | null;
  model: string | null;
  output: string | null;
  latencyMs: number | null;
  createdAt: Date | null;
  attempt: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  outcome: CallOutcome | null;
  error: string | null;
  reusedFrom: string | null;
  // Read only for a Market & Macro call whose parsedReply is a map; a search call's parsedReply is a list of hits.
  marketReply: MarketReply | null;
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

const STEP_STATUSES: readonly unknown[] = ['queued', 'running', 'ok', 'failed'] satisfies StepStatus[];

// The claim writes every step as queued, so a step with no readable status has not started.
function stepProgress(value: unknown): StepProgress {
  const data = map(value);
  return {
    status: STEP_STATUSES.includes(data.status) ? data.status as StepStatus : 'queued',
    startedAt: readDate(data.startedAt), finishedAt: readDate(data.finishedAt),
    failureReason: readString(data.failureReason),
  };
}

function steps(value: unknown): Record<CommitteeStep, StepProgress> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = map(value);
  return Object.fromEntries(COMMITTEE_STEPS.map((step) => [step, stepProgress(data[step])])) as Record<CommitteeStep, StepProgress>;
}

export function toCommitteeRun(id: string, data: DocumentData): CommitteeRun {
  const agents = map(data.agents);
  const consensus = map(data.consensus);
  const votes = map(consensus.votes);
  const gate = map(data.policyGate);
  return {
    id, applicationId: readString(data.applicationId), brokerId: readString(data.brokerId),
    status: ['running', 'failed', 'complete'].includes(data.status) ? data.status : null,
    trigger: data.trigger === 'submit' || data.trigger === 'rerun' ? data.trigger : null,
    rerunOf: readString(data.rerunOf),
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
    steps: steps(data.steps),
  };
}

// How long the run took, from its stored start and finish. Null while running or when either time is missing.
export function runDuration(run: Pick<CommitteeRun, 'startedAt' | 'finishedAt'>): string | null {
  if (!run.startedAt || !run.finishedAt) return null;
  const ms = run.finishedAt.getTime() - run.startedAt.getTime();
  if (ms < 0) return null;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)} min ${totalSeconds % 60} s`;
}

function count(value: unknown, min: number): number | null {
  const number = readNumber(value);
  return number !== null && Number.isInteger(number) && number >= min ? number : null;
}

function webAddress(value: unknown): string | null {
  const text = readString(value);
  if (text === null) return null;
  try {
    const url = new URL(text);
    // Only web links become anchors: a stored javascript: or data: address is never rendered as one.
    return url.protocol === 'https:' || url.protocol === 'http:' ? text : null;
  } catch {
    return null;
  }
}

function marketSources(value: unknown): MarketSource[] | null {
  if (!Array.isArray(value)) return null;
  const sources: MarketSource[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    const entry = item as DocumentData;
    const url = webAddress(entry.url);
    const date = readString(entry.date);
    if (url === null || date === null) return null;
    sources.push({ url, date });
  }
  return sources;
}

function marketReply(agentName: string | null, value: unknown): MarketReply | null {
  if (agentName !== 'market' || value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const reply = value as DocumentData;
  return {
    outlook: reply.outlook === 'rising' || reply.outlook === 'stable' || reply.outlook === 'falling' ? reply.outlook : null,
    summary: readString(reply.summary),
    sources: marketSources(reply.sources),
  };
}

export function toCommitteeCall(id: string, data: DocumentData): CommitteeCall {
  const agentName = readString(data.agent);
  const latency = readNumber(data.latencyMs);
  return {
    id, agent: agentName, provider: readString(data.provider), model: readString(data.model),
    output: readString(data.output), latencyMs: latency !== null && latency >= 0 ? latency : null,
    createdAt: readDate(data.createdAt),
    attempt: count(data.attempt, 1),
    inputTokens: count(data.inputTokens, 0), outputTokens: count(data.outputTokens, 0),
    outcome: (CALL_OUTCOMES as readonly unknown[]).includes(data.outcome) ? data.outcome as CallOutcome : null,
    error: readString(data.error), reusedFrom: readString(data.reusedFrom),
    marketReply: marketReply(agentName, data.parsedReply),
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
