import type { CommitteeAgent, Recommendation, VotingAgent } from '../../services/committeeService';

export const agentLabels = {
  affordability: 'Affordability', valuation: 'Valuation', strategist: 'Strategist', market: 'Market & Macro',
};

export function StoredList({ items }: { items: string[] | null | undefined }) {
  if (items == null) return <p className="text-muted">Not stored</p>;
  if (items.length === 0) return <p className="text-muted">None recorded</p>;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item, index) => (
        <li className="whitespace-pre-wrap break-words" key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function AgentMetadata({ agent }: { agent: CommitteeAgent | null }) {
  return (
    <dl className="grid gap-2 text-sm">
      <div>
        <dt className="text-muted">Provider</dt>
        <dd className="break-words">{agent?.provider ?? 'Not stored'}</dd>
      </div>
      <div>
        <dt className="text-muted">Model</dt>
        <dd className="break-all font-mono">{agent?.model ?? 'Not stored'}</dd>
      </div>
      <div>
        <dt className="text-muted">Prompt version</dt>
        <dd className="break-words">{agent?.promptVersion ?? 'Not stored'}</dd>
      </div>
    </dl>
  );
}

export function AgentVote({ name, agent, vote }: {
  name: VotingAgent;
  agent: CommitteeAgent | null;
  vote: Recommendation | null;
}) {
  return (
    <section aria-label={`${agentLabels[name]} vote`} className="min-w-0 rounded-xl border border-line bg-surface p-5">
      <h3 className="text-lg font-semibold">{agentLabels[name]}</h3>
      <p className="mt-3 rounded-lg bg-tint px-3 py-2 font-medium text-pine">
        Vote: {vote ?? 'Not stored'}
      </p>
      <dl className="mt-4 space-y-4 text-sm leading-6">
        <div>
          <dt className="font-medium">Rating</dt>
          <dd>{name === 'strategist' ? 'Not applicable to the strategist' : agent?.rating ?? 'Not stored'}</dd>
        </div>
        <div>
          <dt className="font-medium">Concerns</dt>
          <dd>
            {name === 'strategist' ? 'Not applicable to the strategist' : <StoredList items={agent?.concerns} />}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Conditions</dt>
          <dd><StoredList items={agent?.conditions} /></dd>
        </div>
        <div>
          <dt className="font-medium">Report</dt>
          <dd className="whitespace-pre-wrap break-words">{agent?.report ?? 'Report not stored yet'}</dd>
        </div>
      </dl>
      <div className="mt-5 border-t border-line pt-4">
        <AgentMetadata agent={agent} />
      </div>
    </section>
  );
}
