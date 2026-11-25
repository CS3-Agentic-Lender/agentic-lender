import {
  clientName,
  newestFirst,
  type ApplicationSummary,
  type BrokerApplication,
  type BrokerClient,
  type StatusMove,
} from '../../services/clientsService';
import type { CommitteeRun } from '../../services/committeeService';
import { NO_LTV, ltvBand } from '../underwriter/pipelineGroups';

export const RECENT_ACTIVITY_LIMIT = 10;

// Monday 00:00 in the viewer's time zone: "this week" on both overviews.
export function startOfWeek(now: Date): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

// When the application last moved into `status`, from its stored statusHistory. Null when no entry records it
// (seeded applications and applications moved before the history was written have none).
export function enteredStatusAt(application: ApplicationSummary, status: string): Date | null {
  const moves = application.statusHistory ?? [];

  for (let index = moves.length - 1; index >= 0; index -= 1) {
    if (moves[index].to === status) {
      return moves[index].at;
    }
  }

  return null;
}

function usableLtv(ltvPct: number | null): ltvPct is number {
  return ltvPct !== null && ltvBand(ltvPct) !== NO_LTV;
}

export interface UnderwriterFigures {
  awaitingDecision: number;
  aiRunning: number;
  aiFailed: number;
  // Approval moves recorded in statusHistory since Monday, whatever the application's status is now.
  approvedThisWeek: number;
  // The mean stored ltvPct of the non-Draft applications that have one; null when none has.
  averageLtvPct: number | null;
  ltvCount: number;
}

export function underwriterFigures(applications: readonly ApplicationSummary[], now: Date): UnderwriterFigures {
  const weekStart = startOfWeek(now).getTime();
  const ltvs = applications
    .filter((application) => application.status !== 'Draft')
    .map((application) => application.ltvPct)
    .filter(usableLtv);

  return {
    awaitingDecision: applications.filter((application) => application.status === 'AI Deliberated').length,
    aiRunning: applications.filter((application) => application.aiRunStatus === 'running').length,
    aiFailed: applications.filter((application) => application.aiRunStatus === 'failed').length,
    approvedThisWeek: applications.filter((application) =>
      (application.statusHistory ?? []).some(
        (move) => move.to === 'Underwriter Approved' && move.at.getTime() >= weekStart,
      ),
    ).length,
    averageLtvPct: ltvs.length === 0 ? null : ltvs.reduce((sum, ltv) => sum + ltv, 0) / ltvs.length,
    ltvCount: ltvs.length,
  };
}

export interface WaitingApplication<T extends ApplicationSummary> {
  application: T;
  // When the committee's result arrived (the move into AI Deliberated), else the last update.
  since: Date | null;
}

// AI Deliberated applications, the one waiting longest first. An application with no time at all goes last.
export function awaitingDecision<T extends ApplicationSummary>(applications: readonly T[]): WaitingApplication<T>[] {
  return applications
    .filter((application) => application.status === 'AI Deliberated')
    .map((application) => ({
      application,
      since: enteredStatusAt(application, 'AI Deliberated') ?? application.updatedAt,
    }))
    .sort(
      (a, b) =>
        (a.since?.getTime() ?? Number.POSITIVE_INFINITY) - (b.since?.getTime() ?? Number.POSITIVE_INFINITY) ||
        a.application.id.localeCompare(b.application.id),
    );
}

export interface ActivityEntry {
  key: string;
  applicationId: string;
  // Whose application it is, when the portal knows the name.
  name: string | null;
  move: StatusMove;
}

// Every stored status move, newest first.
export function recentActivity(
  applications: readonly ApplicationSummary[],
  nameOf: (application: ApplicationSummary) => string | null = (application) => application.borrowerName ?? null,
  limit = RECENT_ACTIVITY_LIMIT,
): ActivityEntry[] {
  return applications
    .flatMap((application) =>
      (application.statusHistory ?? []).map((move, index) => ({
        key: `${application.id}-${index}`,
        applicationId: application.id,
        name: nameOf(application),
        move,
      })),
    )
    .sort((a, b) => b.move.at.getTime() - a.move.at.getTime() || a.key.localeCompare(b.key))
    .slice(0, limit);
}

const ACTIVE_STATUSES = new Set(['Applied', 'AI Deliberated', 'Underwriter Approved']);
const APPROVED_STATUSES = new Set(['Underwriter Approved', 'Funded']);
// The statuses at which a policy condition still has to be met before the loan is funded.
const CONDITION_STATUSES = new Set(['AI Deliberated', 'Underwriter Approved']);

export interface BrokerFigures {
  // Submitted and not yet decided or funded: Applied, AI Deliberated, Underwriter Approved.
  active: number;
  // Applied: submitted, and the committee's result is not in yet.
  awaitingAi: number;
  // Approved by the bank: Underwriter Approved or Funded.
  approved: number;
  awaitingFunding: number;
}

export function brokerFigures(applications: readonly ApplicationSummary[]): BrokerFigures {
  return {
    active: applications.filter((application) => ACTIVE_STATUSES.has(application.status)).length,
    awaitingAi: applications.filter((application) => application.status === 'Applied').length,
    approved: applications.filter((application) => APPROVED_STATUSES.has(application.status)).length,
    awaitingFunding: applications.filter((application) => application.status === 'Underwriter Approved').length,
  };
}

export interface AttentionItem {
  application: BrokerApplication;
  clientName: string | null;
  declined: boolean;
  // The policy gate's conditions on the application's current run.
  conditions: string[];
  unread: number;
}

// Declined applications, applications with conditions still to meet, and threads with unread messages, most
// recently updated first. `runs` is null while the committee runs are unavailable: no conditions are claimed then.
export function needsAttention(
  clients: readonly BrokerClient[],
  runs: ReadonlyMap<string, CommitteeRun> | null,
  unreadByApplication: ReadonlyMap<string, number>,
): AttentionItem[] {
  return clients
    .flatMap((client) =>
      client.applications.map((application) => {
        const run = application.aiRunId ? runs?.get(application.aiRunId) : undefined;
        const conditions =
          CONDITION_STATUSES.has(application.status) && run?.applicationId === application.id
            ? run.policyGate?.conditions ?? []
            : [];

        return {
          application,
          clientName: clientName(client),
          declined: application.status === 'Declined',
          conditions,
          unread: unreadByApplication.get(application.id) ?? 0,
        };
      }),
    )
    .filter((item) => item.declined || item.conditions.length > 0 || item.unread > 0)
    .sort((a, b) => newestFirst(a.application, b.application));
}

const actorLabels: Record<string, string> = {
  borrower: 'the borrower',
  committee: 'the AI committee',
  underwriter: 'an underwriter',
  mint: 'the loan note mint',
};

// Who made a move, as a phrase: "you", "the AI committee". Null when the stored actor is not one we know.
export function actorPhrase(move: StatusMove, viewerUid: string | null): string | null {
  if (viewerUid && move.actorId === viewerUid) {
    return 'you';
  }

  return move.actor ? actorLabels[move.actor] ?? null : null;
}
