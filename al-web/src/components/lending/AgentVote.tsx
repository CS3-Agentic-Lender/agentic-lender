import type { CommitteeAgent, Recommendation, VotingAgent } from '../../services/committeeService';
import { CreditMemo } from './CreditMemo';

export const agentLabels = {
  affordability: 'Affordability', valuation: 'Valuation', strategist: 'Strategist', market: 'Market & Macro',
};

export const voteDot: Record<Recommendation, string> = {
  Approve: 'bg-vote-approve',
  'Conditionally Approve': 'bg-vote-conditional',
  Decline: 'bg-vote-decline',
};

// al-ai's reasoning trail writes the affordability report in this fixed form, because that reply has no free text.
const FIXED_AFFORDABILITY_REPORT = /^Rating: [^\n]*\. Recommendation: [^\n]*\.\nConcerns: [^\n]*\.\nConditions: [^\n]*\.$/;

export function StoredList({ items }: { items: string[] | null | undefined }) {
  if (items == null) return <p className="text-muted">Not stored</p>;
  if (items.length === 0) return <p className="text-muted">None recorded</p>;
  return (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-muted">
      {items.map((item, index) => (
        <li className="whitespace-pre-wrap break-words" key={index}>{item}</li>
      ))}
    </ul>
  );
}

// Provider, model and prompt version on one compact line.
export function AgentMetadata({ agent }: { agent: CommitteeAgent | null }) {
  const rows = [
    ['Provider', agent?.provider, 'break-words'],
    ['Model', agent?.model, 'break-all font-mono'],
    ['Prompt version', agent?.promptVersion, 'break-all font-mono'],
  ] as const;
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1.5 text-[15px]">
      {rows.map(([label, value, style]) => (
        <div className="flex min-w-0 items-baseline gap-2" key={label}>
          <dt className="text-muted">{label}</dt>
          <dd className={value ? `${style} text-ink` : 'text-muted'}>{value ?? 'Not stored'}</dd>
        </div>
      ))}
    </dl>
  );
}

function Report({ name, agent, creditMemo, onOpenMemo }: {
  name: VotingAgent;
  agent: CommitteeAgent | null;
  creditMemo: string | null;
  onOpenMemo?: () => void;
}) {
  const report = agent?.report ?? null;
  if (report === null) return <p className="text-muted">Report not stored yet</p>;
  if (name === 'affordability' && FIXED_AFFORDABILITY_REPORT.test(report)) {
    return (
      <>
        <p className="text-muted">This agent writes no free text: its stored report repeats the rating, recommendation, concerns and conditions shown here.</p>
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer py-3 font-medium text-pine hover:underline">Stored report text</summary>
          <p className="whitespace-pre-wrap break-words leading-7">{report}</p>
        </details>
      </>
    );
  }
  if (name === 'strategist') {
    if (report === creditMemo && onOpenMemo) {
      return (
        <>
          <p>The strategist’s report is the credit memo, stored once and shown in its own tab.</p>
          <button className="btn btn-secondary mt-3" onClick={onOpenMemo} type="button">Read the credit memo</button>
        </>
      );
    }
    return <CreditMemo headingLevel={5} memo={report} />;
  }
  return <p className="whitespace-pre-wrap break-words leading-7">{report}</p>;
}

export function AgentVote({ name, agent, vote, creditMemo = null, onOpenMemo }: {
  name: VotingAgent;
  agent: CommitteeAgent | null;
  vote: Recommendation | null;
  creditMemo?: string | null;
  onOpenMemo?: () => void;
}) {
  const strategist = name === 'strategist';
  const rating = strategist ? 'Not applicable to the strategist' : agent?.rating ?? 'Not stored';
  const ratingStored = !strategist && agent?.rating != null;
  return (
    <section aria-label={`${agentLabels[name]} vote`} className="min-w-0 rounded-xl border border-line bg-surface p-5 text-base">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{agentLabels[name]}</h3>
        <div className="flex flex-wrap gap-2">
          <p className="inline-flex items-center gap-2 rounded-full bg-tint px-3 py-1.5 font-medium text-pine">
            {vote ? <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${voteDot[vote]}`} /> : null}
            Vote: {vote ?? 'Not stored'}
          </p>
          <p className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5">
            <span className="text-muted">Rating</span>
            <span className={ratingStored ? 'font-semibold capitalize' : 'text-muted'}>{rating}</span>
          </p>
        </div>
      </div>

      <div className="mt-5">
        <h4 className="eyebrow">Report</h4>
        <div className="mt-2 max-w-prose">
          <Report agent={agent} creditMemo={creditMemo} name={name} onOpenMemo={onOpenMemo} />
        </div>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <h4 className="eyebrow">Concerns</h4>
          <div className="mt-2">
            {strategist ? <p className="text-muted">Not applicable to the strategist</p> : <StoredList items={agent?.concerns} />}
          </div>
        </div>
        <div>
          <h4 className="eyebrow">Conditions</h4>
          <div className="mt-2"><StoredList items={agent?.conditions} /></div>
        </div>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <AgentMetadata agent={agent} />
      </div>
    </section>
  );
}
