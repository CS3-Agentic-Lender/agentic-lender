import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useCommittee, useCommitteeCalls } from '../../context/CommitteeContext';
import { runDuration, type CommitteeCall, type CommitteeRun } from '../../services/committeeService';
import { AgentMetadata, AgentVote, StoredList, voteDot } from './AgentVote';
import { CommitteeStage } from './CommitteeStage';
import { CreditMemo } from './CreditMemo';
import type { SceneAgent } from './council/councilScene';

function timestamp(value: Date | null) {
  return value?.toLocaleString('en-IE') ?? 'Not stored';
}

// SCHEMA.md: `interrupted` marks a stale run whose task stopped part-way (a deploy replaced it, or it crashed).
const failureWording: Record<string, string> = { interrupted: 'Interrupted by a restart or deploy' };

const outcomeWording: Record<NonNullable<CommitteeCall['outcome']>, string> = {
  ok: 'OK', invalid_reply: 'Invalid reply', provider_error: 'Provider error', missing_key: 'Missing key',
  error: 'Error', reused: 'Reused',
};

function tokens(value: number | null) {
  return value === null ? 'not stored' : value.toLocaleString('en-IE');
}

function CallFacts({ call }: { call: CommitteeCall }) {
  const failed = call.outcome !== null && call.outcome !== 'ok' && call.outcome !== 'reused';
  const hasTokens = call.inputTokens !== null || call.outputTokens !== null;
  if (call.attempt === null && !hasTokens && call.outcome === null && call.error === null) return null;
  return (
    <>
      <ul aria-label="Call facts" className="mt-2 flex flex-wrap gap-2">
        {call.outcome !== null && (
          <li className={`rounded-full px-2.5 py-0.5 font-medium ${failed ? 'bg-danger-soft text-error' : 'bg-tint text-pine'}`}>
            Outcome: {outcomeWording[call.outcome]}
          </li>
        )}
        {call.attempt !== null && <li className="rounded-full border border-line px-2.5 py-0.5">Attempt {call.attempt}</li>}
        {hasTokens && (
          <li className="rounded-full border border-line px-2.5 py-0.5">
            Tokens: {tokens(call.inputTokens)} in · {tokens(call.outputTokens)} out
          </li>
        )}
      </ul>
      {call.error !== null && <p className="mt-2 whitespace-pre-wrap break-words text-error">Error: {call.error}</p>}
    </>
  );
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
          <CallFacts call={call} />
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

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function MarketSources({ calls }: { calls: CommitteeCall[] }) {
  const marketCalls = calls.filter((call) => call.agent === 'market');
  // A retry is its own call: the last stored reply that passed the check is the one the run used.
  const reply = marketCalls.filter((call) => call.outcome === 'ok' && call.marketReply !== null).at(-1)?.marketReply ?? null;
  const reused = marketCalls.find((call) => call.outcome === 'reused');
  const sources = reply?.sources ?? [];
  return (
    <>
      {reply?.outlook ? (
        <p className="inline-flex items-center gap-2 rounded-full bg-tint px-3 py-1.5 font-medium text-pine">
          <span className="text-muted">Outlook for rates</span>
          <span className="capitalize">{reply.outlook}</span>
        </p>
      ) : null}
      {sources.length > 0 ? (
        <div className={reply?.outlook ? 'mt-4' : undefined}>
          <h4 className="eyebrow">Sources</h4>
          <ul aria-label="Macro sources" className="mt-2 space-y-2">
            {sources.map((source, index) => (
              // Two sources can share a url, so the url alone is not a unique key.
              <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5" key={`${source.url}-${index}`}>
                <a
                  className="break-all font-medium text-pine underline underline-offset-2 hover:text-pine-pressed"
                  href={source.url}
                  rel="noreferrer"
                  target="_blank"
                  title={source.url}
                >
                  {hostOf(source.url)}
                  <span className="sr-only">, dated {source.date} (opens in a new tab)</span>
                </a>
                <span className="text-muted">{source.date}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={`text-muted ${reply?.outlook ? 'mt-3' : ''}`}>Macro sources are not stored.</p>
      )}
      {reused && !reply ? (
        <p className="mt-2 text-muted">
          This run reused the day’s earlier Market &amp; Macro report
          {reused.reusedFrom ? <> (call <span className="break-all font-mono">{reused.reusedFrom}</span>)</> : null}
          ; its sources are stored with the call that made it.
        </p>
      ) : null}
    </>
  );
}

// The Market & Macro model call's checked reply holds the outlook and the dated sources the summary cites.
// Calls are read only when this tab is opened; the run record keeps just the summary.
function MarketDetails({ run }: { run: CommitteeRun }) {
  const state = useCommitteeCalls(run.id);
  return (
    <>
      <div className="mt-5">
        <h4 className="eyebrow">Summary</h4>
        <p className="mt-2 max-w-prose whitespace-pre-wrap break-words leading-7">{run.agents.market?.report ?? 'Macro report not stored yet'}</p>
      </div>
      <div className="mt-5">
        {state.status === 'ready' ? (
          <MarketSources calls={state.calls} />
        ) : state.status === 'loading' ? (
          <p className="text-muted" role="status">Loading the stored outlook and sources…</p>
        ) : (
          <p className="text-error" role="alert">
            {state.status === 'permission-denied'
              ? 'Permission denied: your account cannot read the logged AI calls, so the outlook and sources cannot be shown.'
              : 'The outlook and sources could not be loaded. Reload the page to try again.'}
          </p>
        )}
      </div>
    </>
  );
}

type CommitteeTab = SceneAgent | 'memo' | 'gate';

const TABS: { key: CommitteeTab; label: string }[] = [
  { key: 'affordability', label: 'Affordability' },
  { key: 'valuation', label: 'Valuation' },
  { key: 'strategist', label: 'Strategist' },
  { key: 'market', label: 'Market & Macro' },
  { key: 'memo', label: 'Credit memo' },
  { key: 'gate', label: 'Policy gate' },
];

const isAgentTab = (tab: CommitteeTab): tab is SceneAgent => tab !== 'memo' && tab !== 'gate';

function RunDetails({ run }: { run: CommitteeRun }) {
  const [showCalls, setShowCalls] = useState(false);
  const [tab, setTab] = useState<CommitteeTab>('affordability');
  const callsId = useId();
  const rerunNoteId = useId();
  const tabsId = useId();
  const tabRefs = useRef(new Map<CommitteeTab, HTMLButtonElement>());
  const votes = Object.values(run.consensus.votes).filter((vote) => vote !== null);
  const disagreement = run.consensus.disagreement === true || new Set(votes).size > 1;
  const gate = run.policyGate;
  const duration = runDuration(run);
  const failureText = run.failureReason === null ? null : failureWording[run.failureReason] ?? null;

  function moveTab(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((item) => item.key === tab);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const edge = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
    if (step === 0 && edge === null) return;
    event.preventDefault();
    const next = TABS[edge ?? (index + step + TABS.length) % TABS.length].key;
    setTab(next);
    tabRefs.current.get(next)?.focus();
  }

  function pickFromStage(agent: SceneAgent) {
    setTab(agent);
    tabRefs.current.get(agent)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  return (
    <div className="mt-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="break-all font-mono text-sm text-muted">Run ID: {run.id}</p>
          <p className="mt-1 text-sm text-muted">Started: {timestamp(run.startedAt)}</p>
          {run.finishedAt && (
            <p className="mt-1 text-sm text-muted">Finished: {timestamp(run.finishedAt)}</p>
          )}
          {duration && <p className="mt-1 text-sm text-muted">Took {duration}</p>}
          {run.trigger === 'rerun' && (
            <p className="mt-2 inline-flex flex-wrap items-baseline gap-x-1.5 rounded-lg border border-line px-3 py-1 text-sm">
              {run.rerunOf
                ? <>Re-run of <span className="break-all font-mono">{run.rerunOf}</span></>
                : 'Re-run (the earlier run is not stored)'}
            </p>
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
          <p className="mt-2 whitespace-pre-wrap break-words">Reason: {failureText ?? run.failureReason ?? 'Not stored'}</p>
          {failureText !== null && (
            <p className="mt-1 text-sm">Stored reason: <code className="font-mono">{run.failureReason}</code></p>
          )}
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

      <CommitteeStage onPick={pickFromStage} run={run} selected={isAgentTab(tab) ? tab : null} />

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

      <div>
        <div
          aria-label="Committee members"
          className="flex flex-wrap gap-1 border-b border-line"
          onKeyDown={moveTab}
          role="tablist"
        >
          {TABS.map((item) => {
            const vote = isAgentTab(item.key) && item.key !== 'market' ? run.consensus.votes[item.key] : null;
            const on = tab === item.key;
            return (
              <button
                aria-controls={`${tabsId}-panel`}
                aria-selected={on}
                className={`-mb-px inline-flex min-h-11 cursor-pointer items-center gap-2 border-b-2 px-3.5 py-2 font-semibold transition-colors duration-200 ${on ? 'border-pine text-pine' : 'border-transparent text-muted hover:text-ink'}`}
                id={`${tabsId}-${item.key}`}
                key={item.key}
                onClick={() => setTab(item.key)}
                ref={(node) => { if (node) tabRefs.current.set(item.key, node); else tabRefs.current.delete(item.key); }}
                role="tab"
                tabIndex={on ? 0 : -1}
                type="button"
              >
                {vote ? <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${voteDot[vote]}`} /> : null}
                {item.key === 'market' ? <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-vote-observer" /> : null}
                {item.label}
              </button>
            );
          })}
        </div>
        <div aria-labelledby={`${tabsId}-${tab}`} className="animate-rise pt-5" id={`${tabsId}-panel`} key={tab} role="tabpanel">
          {tab === 'affordability' || tab === 'valuation' || tab === 'strategist' ? (
            <AgentVote
              agent={run.agents[tab]}
              creditMemo={run.creditMemo}
              name={tab}
              onOpenMemo={() => { setTab('memo'); tabRefs.current.get('memo')?.focus(); }}
              vote={run.consensus.votes[tab]}
            />
          ) : tab === 'market' ? (
            <section aria-label="Market & Macro outlook" className="min-w-0 rounded-xl border border-line bg-surface p-5">
              <h3 className="text-lg font-semibold">Market &amp; Macro outlook</h3>
              <p className="mt-1 text-[15px] text-muted">Context only. Market &amp; Macro does not vote.</p>
              <MarketDetails run={run} />
              <div className="mt-5 border-t border-line pt-4">
                <AgentMetadata agent={run.agents.market} />
              </div>
            </section>
          ) : tab === 'memo' ? (
            <section aria-label="Credit memo" className="rounded-xl border border-line p-5">
              <h3 className="text-lg font-semibold">Credit memo</h3>
              {run.creditMemo === null ? (
                <p className="mt-3 whitespace-pre-wrap break-words leading-7">Credit memo not stored yet</p>
              ) : (
                <CreditMemo memo={run.creditMemo} />
              )}
            </section>
          ) : (
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
          )}
        </div>
      </div>

      <div className="border-t border-line pt-5">
        <button
          aria-controls={callsId}
          aria-expanded={showCalls}
          className="btn btn-secondary"
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
      className="card mt-5 min-w-0"
    >
      <h2 className="card-title">Committee</h2>
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
