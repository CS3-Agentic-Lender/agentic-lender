import { useId, useState } from 'react';
import { useCommittee, useCommitteeCalls } from '../../context/CommitteeContext';
import { VOTING_AGENTS, type CommitteeRun } from '../../services/committeeService';
import { AgentMetadata, AgentVote, StoredList } from './AgentVote';

function timestamp(value: Date | null) {
  return value?.toLocaleString('en-IE') ?? 'Not stored';
}

function CallsList({ runId }: { runId: string }) {
  const state = useCommitteeCalls(runId);
  if (state.status !== 'ready') {
    const message = {
      loading: 'Loading logged AI calls…',
      'permission-denied': 'Permission denied: your account cannot read the logged AI calls.',
      error: 'Logged AI calls could not be loaded. Reload the page to try again.',
    }[state.status];
    return (
      <p role={state.status === 'loading' ? 'status' : 'alert'} className="mt-4 text-muted">
        {message}
      </p>
    );
  }
  if (state.calls.length === 0) return <p className="mt-4 text-muted">No AI calls stored yet.</p>;
  return (
    <ul aria-label="Logged AI calls" className="mt-4 space-y-3">
      {state.calls.map((call) => (
        <li className="rounded-xl border border-line p-4 text-sm" key={call.id}>
          <p className="font-medium">Agent: {call.agent ?? 'Not stored'}</p>
          <p className="mt-1 break-all font-mono text-muted">Call ID: {call.id}</p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-muted">Provider</dt>
              <dd className="break-words">{call.provider ?? 'Not stored'}</dd>
            </div>
            <div>
              <dt className="text-muted">Model</dt>
              <dd className="break-all font-mono">{call.model ?? 'Not stored'}</dd>
            </div>
            <div>
              <dt className="text-muted">Latency</dt>
              <dd>{call.latencyMs === null ? 'Not stored' : `${call.latencyMs} ms`}</dd>
            </div>
            <div>
              <dt className="text-muted">Created at</dt>
              <dd>{timestamp(call.createdAt)}</dd>
            </div>
          </dl>
          <details className="mt-3">
            <summary className="min-h-11 cursor-pointer py-3 font-medium text-pine hover:underline">Call output</summary>
            <p className="whitespace-pre-wrap break-words leading-6">{call.output ?? 'Output not stored'}</p>
          </details>
        </li>
      ))}
    </ul>
  );
}

function RunDetails({ run }: { run: CommitteeRun }) {
  const [showCalls, setShowCalls] = useState(false);
  const callsId = useId();
  const rerunNoteId = useId();
  const votes = Object.values(run.consensus.votes).filter((vote) => vote !== null);
  const disagreement = run.consensus.disagreement === true || new Set(votes).size > 1;
  const gate = run.policyGate;

  return (
    <div className="mt-5 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="break-all font-mono text-sm text-muted">Run ID: {run.id}</p>
          <p className="mt-1 text-sm text-muted">Started: {timestamp(run.startedAt)}</p>
          {run.finishedAt && (
            <p className="mt-1 text-sm text-muted">Finished: {timestamp(run.finishedAt)}</p>
          )}
        </div>
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-sm font-medium ${run.status === 'failed' ? 'bg-danger-soft text-error' : 'bg-tint text-pine'}`}
        >
          Run status: {run.status === null ? 'Not stored' : { running: 'Running', failed: 'Failed', complete: 'Complete' }[run.status]}
        </p>
      </div>
      {run.status === 'running' && (
        <p className="text-muted">The committee is running. Outputs not stored yet are pending.</p>
      )}
      {run.status === 'failed' && (
        <div className="rounded-xl bg-danger-soft p-5 text-error">
          <h3 className="font-semibold">Committee run failed</h3>
          <p className="mt-2 break-words">Failed step: {run.failedStep ?? 'Not stored'}</p>
          <p className="mt-2 whitespace-pre-wrap break-words">Reason: {run.failureReason ?? 'Not stored'}</p>
          <button
            aria-describedby={rerunNoteId}
            className="mt-4 min-h-11 cursor-not-allowed rounded-lg border border-line bg-neutral px-4 py-2 text-muted"
            disabled
            type="button"
          >
            Re-run
          </button>
          <p className="mt-2 text-sm" id={rerunNoteId}>Re-running is not available yet.</p>
        </div>
      )}
      <section aria-label="Committee recommendation" className="rounded-xl bg-tint p-5">
        <h3 className="text-lg font-semibold">Recommendation</h3>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted">Original recommendation</dt>
            <dd className="mt-1 font-medium">{run.originalRecommendation ?? 'Not stored yet'}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Effective recommendation</dt>
            <dd className="mt-1 font-medium">{run.effectiveRecommendation ?? 'Not stored yet'}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm leading-6">Final authority stays with the human underwriter. These stored AI recommendations support their review.</p>
      </section>
      {disagreement && (
        <p className="rounded-lg border border-line bg-neutral p-4 font-medium">Votes disagree — review each agent’s reasoning.</p>
      )}
      {run.consensus.disagreement === null && !disagreement && (
        <p className="text-sm text-muted">Consensus disagreement flag not stored yet.</p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {VOTING_AGENTS.map((name) => (
          <AgentVote agent={run.agents[name]} key={name} name={name} vote={run.consensus.votes[name]} />
        ))}
      </div>
      <section aria-label="Market & Macro outlook" className="rounded-xl border border-line p-5">
        <h3 className="text-lg font-semibold">Market &amp; Macro outlook</h3>
        <p className="mt-1 text-sm text-muted">Context only. Market &amp; Macro does not vote.</p>
        <p className="mt-4 whitespace-pre-wrap break-words leading-7">{run.agents.market?.report ?? 'Macro report not stored yet'}</p>
        <p className="mt-3 text-sm text-muted">Macro sources are not stored.</p>
        <div className="mt-4 border-t border-line pt-4">
          <AgentMetadata agent={run.agents.market} />
        </div>
      </section>
      <section aria-label="Credit memo">
        <h3 className="text-lg font-semibold">Credit memo</h3>
        <p className="mt-3 whitespace-pre-wrap break-words leading-7">{run.creditMemo ?? 'Credit memo not stored yet'}</p>
      </section>
      <section aria-label="Policy gate" className="rounded-xl border border-line p-5">
        <h3 className="text-lg font-semibold">Policy gate</h3>
        {gate === null ? (
          <p className="mt-3 text-muted">Policy gate not stored yet.</p>
        ) : (
          <>
            <p className="mt-3 font-medium">
              {gate.changed === null ? 'Policy-gate change not stored' : gate.changed ? 'Policy gate changed the recommendation' : 'Policy gate left the recommendation unchanged'}
            </p>
            <p className="mt-2">Original: {gate.original ?? 'Not stored'} · Effective: {gate.effective ?? 'Not stored'}</p>
            <dl className="mt-4 grid gap-4 text-sm leading-6 sm:grid-cols-2">
              <div>
                <dt className="font-medium">Policy conditions</dt>
                <dd><StoredList items={gate.conditions} /></dd>
              </div>
              <div>
                <dt className="font-medium">Policy breaches</dt>
                <dd><StoredList items={gate.breaches} /></dd>
              </div>
            </dl>
          </>
        )}
      </section>
      <div className="border-t border-line pt-5">
        <button
          aria-controls={callsId}
          aria-expanded={showCalls}
          className="min-h-11 cursor-pointer rounded-lg border border-line px-4 py-2 font-medium text-pine transition-colors hover:bg-tint"
          onClick={() => setShowCalls(!showCalls)}
          type="button"
        >
          {showCalls ? 'Hide calls' : 'View calls'}
        </button>
        <div id={callsId}>
          {showCalls && <CallsList runId={run.id} />}
        </div>
      </div>
    </div>
  );
}

export function CommitteeConsole({ applicationId }: { applicationId: string }) {
  const state = useCommittee(applicationId);
  return (
    <section
      aria-label="Committee"
      aria-busy={state.status === 'loading'}
      className="mt-6 min-w-0 rounded-2xl border border-line bg-surface p-6 sm:p-8"
    >
      <h2 className="text-xl font-semibold">Committee</h2>
      <p className="mt-2 text-sm text-muted">Stored reasoning for this application. Run status is separate from the application status.</p>
      {state.status === 'ready' ? (
        <RunDetails key={state.run.id} run={state.run} />
      ) : (
        <p className="mt-5 text-muted" role={state.status === 'error' || state.status === 'permission-denied' ? 'alert' : 'status'}>
          {{
            loading: 'Loading the committee run…',
            missing: 'No committee run stored yet.',
            'permission-denied': 'Permission denied: your account cannot read this committee run.',
            error: 'The committee run could not be loaded. Reload the page to try again.',
          }[state.status]}
        </p>
      )}
    </section>
  );
}
