import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Timestamp } from 'firebase/firestore';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommitteeServiceContext } from '../../context/CommitteeContext';
import {
  COMMITTEE_STEPS, toCommitteeRun, type CommitteeCall, type CommitteeStep, type CommitteeCallsState, type CommitteeService, type CommitteeState,
} from '../../services/committeeService';
import { toLoanFileReview } from '../../services/loanFileService';
import type { AffordabilityInputs } from './AffordabilityFigures';
import { CommitteeConsole } from './CommitteeConsole';

function callOf(fields: Partial<CommitteeCall> & { id: string }): CommitteeCall {
  return {
    agent: null, provider: null, model: null, output: null, latencyMs: null, createdAt: null,
    attempt: null, inputTokens: null, outputTokens: null, outcome: null, error: null, reusedFrom: null,
    marketReply: null, ...fields,
  };
}

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'underwriter-1' }, role: 'underwriter' }),
}));

function sampleRun() {
  return toCommitteeRun('run-LN-1001', {
    applicationId: 'LN-1001', brokerId: 'broker-1', status: 'complete',
    originalRecommendation: 'Approve', effectiveRecommendation: 'Conditionally Approve',
    creditMemo: 'Summary\nHousehold can meet repayments.\nConditions\nReview the valuation.',
    consensus: {
      votes: { affordability: 'Approve', valuation: 'Conditionally Approve', strategist: 'Approve' },
      disagreement: true,
    },
    policyGate: {
      original: 'Approve', effective: 'Conditionally Approve', changed: true,
      conditions: ['Reduce the credit limit'], breaches: ['CLTV_CAP'],
    },
    agents: {
      affordability: {
        recommendation: 'Approve', rating: 'adequate', concerns: ['Variable income'],
        conditions: ['Verify payslips'], report: 'Repayments fit the household budget.',
        provider: 'ollama', model: 'qwen3.5:9b', promptVersion: 'affordability-v1',
      },
      valuation: {
        recommendation: 'Conditionally Approve', rating: 'weak', concerns: ['Limited comparables'],
        conditions: ['Obtain a survey'], report: 'The estimate needs a survey.',
        provider: 'groq', model: 'openai/gpt-oss-120b', promptVersion: 'valuation-v1',
      },
      strategist: {
        recommendation: 'Approve', rating: null, concerns: null,
        conditions: ['Confirm borrower documents'], report: 'Review the specialist reports.',
        provider: 'gemini', model: 'gemini-3.1-flash-lite', promptVersion: 'strategist-v1',
      },
      market: {
        recommendation: null, rating: null, concerns: null, conditions: null,
        report: 'Rates remain uncertain.', provider: 'gemini', model: 'gemini-3.1-flash-lite',
      },
    },
  });
}

function fakeService(initial: CommitteeState = { status: 'ready', run: sampleRun() }) {
  let updateRun: (state: CommitteeState) => void = () => {};
  let updateCalls: (state: CommitteeCallsState) => void = () => {};
  const stopRun = vi.fn();
  const stopCalls = vi.fn();
  const service: CommitteeService = {
    subscribeToRun: vi.fn((_id, _viewer, listener) => {
      updateRun = listener;
      listener(initial);
      return stopRun;
    }),
    subscribeToCalls: vi.fn((_id, _viewer, listener) => {
      updateCalls = listener;
      return stopCalls;
    }),
  };
  return { service, stopRun, stopCalls, pushRun: (state: CommitteeState) => updateRun(state), pushCalls: (state: CommitteeCallsState) => updateCalls(state) };
}

function consoleWith(service: CommitteeService, applicationId = 'LN-1001', affordability?: AffordabilityInputs) {
  return (
    <CommitteeServiceContext.Provider value={service}>
      <CommitteeConsole affordability={affordability} applicationId={applicationId} />
    </CommitteeServiceContext.Provider>
  );
}

const storedFigures: AffordabilityInputs = {
  dtiPct: 33.4,
  review: toLoanFileReview({
    dtiBreakdown: {
      incomeMonthlyEur: 6250, newRepaymentMonthlyEur: 1265.13, stressedRepaymentMonthlyEur: 1555.4,
      stressedDtiPct: 42.4, surplusMonthlyEur: 900, stressedSurplusMonthlyEur: 610.5,
      dtiBand: 'Caution', surplusBand: 'Comfortable',
    },
  }),
};

afterEach(cleanup);

// Each member's results sit behind its own tab.
function openTab(name: string) {
  fireEvent.click(screen.getByRole('tab', { name }));
}

describe('committee console', () => {
  it('shows disagreement and all three stored votes, reports and metadata', () => {
    render(consoleWith(fakeService().service));
    expect(screen.getByText(/Votes disagree/)).toBeInTheDocument();
    const affordability = within(screen.getByRole('region', { name: 'Affordability vote' }));
    for (const value of ['Vote: Approve', 'adequate', 'Variable income', 'Verify payslips', 'Repayments fit the household budget.', 'ollama', 'qwen3.5:9b', 'affordability-v1']) {
      expect(affordability.getByText(value)).toBeInTheDocument();
    }
    openTab('Valuation');
    const valuation = within(screen.getByRole('region', { name: 'Valuation vote' }));
    for (const value of ['Vote: Conditionally Approve', 'weak', 'Limited comparables', 'Obtain a survey', 'The estimate needs a survey.', 'groq', 'openai/gpt-oss-120b']) {
      expect(valuation.getByText(value)).toBeInTheDocument();
    }
    openTab('Strategist');
    const strategist = within(screen.getByRole('region', { name: 'Strategist vote' }));
    for (const value of ['Vote: Approve', 'Confirm borrower documents', 'Review the specialist reports.', 'gemini', 'gemini-3.1-flash-lite']) {
      expect(strategist.getByText(value)).toBeInTheDocument();
    }
    expect(strategist.getAllByText('Not applicable to the strategist')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('Run status: Complete');
    expect(screen.getByRole('region', { name: 'Committee' })).not.toHaveTextContent(/majority|funding|\d+\s*\/\s*100/);
  });

  it('does not show a disagreement marker for agreeing votes', () => {
    const run = sampleRun();
    run.consensus = { votes: { affordability: 'Approve', valuation: 'Approve', strategist: 'Approve' }, disagreement: false };
    render(consoleWith(fakeService({ status: 'ready', run }).service));
    expect(screen.queryByText(/Votes disagree/)).not.toBeInTheDocument();
    for (const name of ['Affordability', 'Valuation', 'Strategist']) {
      openTab(name);
      expect(within(screen.getByRole('region', { name: `${name} vote` })).getByText('Vote: Approve')).toBeInTheDocument();
    }
  });

  it('keeps Macro separate from the votes and explains that sources are not stored', () => {
    const fake = fakeService();
    render(consoleWith(fake.service));
    openTab('Market & Macro');
    // No market call in this run carries sources.
    act(() => fake.pushCalls({ status: 'ready', calls: [] }));
    const macro = screen.getByRole('region', { name: 'Market & Macro outlook' });
    expect(macro).toHaveTextContent('Market & Macro does not vote.');
    expect(macro).toHaveTextContent('Rates remain uncertain.');
    expect(macro).toHaveTextContent('Macro sources are not stored.');
    expect(macro).not.toHaveTextContent(/Vote:|Rating|Concerns|Conditions/);
    expect(within(macro).queryByRole('link')).not.toBeInTheDocument();
  });

  it('preserves the memo text and shows original/effective recommendations and the policy change', () => {
    render(consoleWith(fakeService().service));
    const recommendation = screen.getByRole('region', { name: 'Committee recommendation' });
    expect(recommendation).toHaveTextContent('Original recommendationApprove');
    expect(recommendation).toHaveTextContent('Effective recommendationConditionally Approve');
    expect(recommendation).toHaveTextContent('Final authority stays with the human underwriter.');
    openTab('Credit memo');
    expect(screen.getByRole('region', { name: 'Credit memo' }).querySelector('p')?.textContent).toBe(sampleRun().creditMemo);
    openTab('Policy gate');
    const gate = screen.getByRole('region', { name: 'Policy gate' });
    expect(gate).toHaveTextContent('Policy gate changed the recommendation');
    expect(gate).toHaveTextContent('Reduce the credit limit');
    expect(gate).toHaveTextContent('CLTV_CAP');
  });

  it('shows a stored memo under its own headings, in the stored order', () => {
    // The text al-ai's strategist stores: one "## heading" line, then that section's text, with a blank line between sections.
    const sections = [
      ['Application summary', 'A couple buying a three-bed semi in Cork.'],
      ['Affordability', 'Repayments fit the budget.\nThe stressed rate still leaves a surplus.'],
      ['Property assessment', 'The estimate is close to the asking price.'],
      ['Market context', 'Rates are stable.'],
      ['Disagreements', 'The valuation agent asked for a condition.'],
      ['Recommendation and conditions', 'Approve with a surveyor valuation.'],
    ];
    const creditMemo = `${sections.map(([heading, body]) => `## ${heading}\n${body}`).join('\n\n')}\n`;
    render(consoleWith(fakeService({ status: 'ready', run: { ...sampleRun(), creditMemo } }).service));
    openTab('Credit memo');

    const memo = screen.getByRole('region', { name: 'Credit memo' });
    const headings = within(memo).getAllByRole('heading', { level: 4 });
    expect(headings.map((heading) => heading.textContent)).toEqual(sections.map(([heading]) => heading));
    headings.forEach((heading, index) => expect(heading.nextElementSibling?.textContent).toBe(sections[index][1]));
    expect(memo).not.toHaveTextContent('##');
  });

  it('keeps memo text that comes before the first heading', () => {
    const run = { ...sampleRun(), creditMemo: 'Draft memo.\n\n## Affordability\nRepayments fit the budget.' };
    render(consoleWith(fakeService({ status: 'ready', run }).service));
    openTab('Credit memo');
    const memo = screen.getByRole('region', { name: 'Credit memo' });
    expect(memo.querySelector('p')?.textContent).toBe('Draft memo.');
    expect(within(memo).getByRole('heading', { level: 4, name: 'Affordability' }).nextElementSibling?.textContent).toBe('Repayments fit the budget.');
  });

  it('shows a failed step, reason and a disabled re-run with its explanation', () => {
    const run = { ...sampleRun(), status: 'failed' as const, failedStep: 'valuation_agent', failureReason: 'Provider quota exceeded.' };
    render(consoleWith(fakeService({ status: 'ready', run }).service));
    expect(screen.getByRole('status')).toHaveTextContent('Run status: Failed');
    expect(screen.getByText('Failed step: valuation_agent')).toBeInTheDocument();
    expect(screen.getByText('Reason: Provider quota exceeded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-run' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Re-run' })).toHaveAccessibleDescription('Re-running is not available yet.');
  });

  it('shows a read-only viewer the failed step and reason with no re-run control', () => {
    const run = { ...sampleRun(), status: 'failed' as const, failedStep: 'valuation_agent', failureReason: 'Provider quota exceeded.' };
    render(
      <CommitteeServiceContext.Provider value={fakeService({ status: 'ready', run }).service}>
        <CommitteeConsole applicationId="LN-1001" readOnly />
      </CommitteeServiceContext.Provider>,
    );
    expect(screen.getByText('Failed step: valuation_agent')).toBeInTheDocument();
    expect(screen.getByText('Reason: Provider quota exceeded.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-run' })).not.toBeInTheDocument();
    expect(screen.queryByText('Re-running is not available yet.')).not.toBeInTheDocument();
  });

  it('shows running and missing outputs without manufacturing completed results', () => {
    render(consoleWith(fakeService({ status: 'ready', run: toCommitteeRun('run-LN-1001', { status: 'running' }) }).service));
    expect(screen.getByRole('status')).toHaveTextContent('Run status: Running');
    expect(screen.getByText(/Outputs not stored yet are pending/)).toBeInTheDocument();
    for (const name of ['Affordability', 'Valuation', 'Strategist']) {
      openTab(name);
      expect(within(screen.getByRole('region', { name: `${name} vote` })).getByText('Vote: Not stored')).toBeInTheDocument();
    }
    openTab('Credit memo');
    expect(screen.getByText('Credit memo not stored yet')).toBeInTheDocument();
    openTab('Policy gate');
    expect(screen.getByText('Policy gate not stored yet.')).toBeInTheDocument();
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
  });

  it('shows one member at a time in tabs and moves between them with the arrow keys', () => {
    render(consoleWith(fakeService().service));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Affordability', 'Valuation', 'Strategist', 'Market & Macro', 'Credit memo', 'Policy gate']);
    expect(screen.getByRole('tab', { name: 'Affordability' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Affordability');
    expect(screen.queryByRole('region', { name: 'Valuation vote' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Valuation' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Valuation' })).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Valuation vote' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    expect(screen.getByRole('region', { name: 'Policy gate' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Affordability' })).toHaveAttribute('aria-selected', 'true');
  });
  it.each([
    ['loading', 'Loading the committee run…'], ['missing', 'No committee run stored yet.'],
    ['permission-denied', 'Permission denied: your account cannot read this committee run.'],
    ['error', 'The committee run could not be loaded. Reload the page to try again.'],
  ] as const)('shows the %s state', (status, message) => {
    render(consoleWith(fakeService({ status }).service));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Affordability vote' })).not.toBeInTheDocument();
  });

  it('loads calls on disclosure, updates their states and stops listening when closed', async () => {
    const fake = fakeService();
    const user = userEvent.setup();
    render(consoleWith(fake.service));
    expect(fake.service.subscribeToCalls).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'View calls' }));
    expect(screen.getByText('Loading logged AI calls…')).toBeInTheDocument();
    act(() => fake.pushCalls({ status: 'permission-denied' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Permission denied');
    act(() => fake.pushCalls({ status: 'error' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Logged AI calls could not be loaded');
    act(() => fake.pushCalls({ status: 'ready', calls: [] }));
    expect(screen.getByText('No AI calls stored yet.')).toBeInTheDocument();
    act(() => fake.pushCalls({ status: 'ready', calls: [callOf({
      id: 'call-LN-1001-affordability', agent: 'affordability', provider: 'ollama', model: 'qwen3.5:9b',
      latencyMs: 1234, createdAt: new Date('2026-10-07T12:00:00Z'), output: 'Stored call output.',
      attempt: 2, inputTokens: 1200, outputTokens: 340, outcome: 'ok',
    })] }));
    const calls = screen.getByRole('list', { name: 'Logged AI calls' });
    for (const text of ['affordability', 'call-LN-1001-affordability', 'ollama', 'qwen3.5:9b', '1234 ms', '2026', 'Outcome: OK', 'Attempt 2', 'Tokens: 1,200 in · 340 out']) {
      expect(calls).toHaveTextContent(text);
    }
    await user.click(within(calls).getByText('Call output'));
    expect(within(calls).getByText('Stored call output.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Hide calls' }));
    expect(fake.stopCalls).toHaveBeenCalledOnce();
    expect(screen.queryByRole('list', { name: 'Logged AI calls' })).not.toBeInTheDocument();
  });

  it('clears calls when a newer run arrives and ignores old callbacks after navigation/unmount', async () => {
    const fake = fakeService();
    const view = render(consoleWith(fake.service));
    await userEvent.setup().click(screen.getByRole('button', { name: 'View calls' }));
    act(() => fake.pushRun({ status: 'ready', run: { ...sampleRun(), id: 'run-LN-1001-new' } }));
    expect(fake.stopCalls).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'View calls' })).toHaveAttribute('aria-expanded', 'false');
    const oldCallback = vi.mocked(fake.service.subscribeToRun).mock.calls[0][2];
    view.rerender(consoleWith(fake.service, 'LN-1002'));
    expect(fake.stopRun).toHaveBeenCalledOnce();
    act(() => oldCallback({ status: 'permission-denied' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    view.unmount();
    expect(fake.stopRun).toHaveBeenCalledTimes(2);
  });

  it('loads the market call only when its tab opens and shows the stored outlook and dated sources', () => {
    const fake = fakeService();
    render(consoleWith(fake.service));
    expect(fake.service.subscribeToCalls).not.toHaveBeenCalled();
    openTab('Market & Macro');
    expect(fake.service.subscribeToCalls).toHaveBeenCalledOnce();
    expect(vi.mocked(fake.service.subscribeToCalls).mock.calls[0][0]).toBe('run-LN-1001');
    const macro = screen.getByRole('region', { name: 'Market & Macro outlook' });
    expect(macro).toHaveTextContent('Loading the stored outlook and sources…');
    expect(macro).toHaveTextContent('Rates remain uncertain.');
    act(() => fake.pushCalls({ status: 'ready', calls: [
      // A search's parsedReply is a list of hits, so it carries no market reply.
      callOf({ id: 'run-LN-1001-market-search-1', agent: 'market', provider: 'serper', outcome: 'ok' }),
      callOf({ id: 'run-LN-1001-market-1', agent: 'market', outcome: 'ok', marketReply: {
        outlook: 'rising', summary: 'Rates remain uncertain.',
        sources: [
          { url: 'https://www.ecb.europa.eu/press/pr/date/2026/html/decision.en.html', date: '2026-10-29' },
          { url: 'https://www.reuters.com/business/ecb-rates/', date: '2026-10-28' },
        ],
      } }),
    ] }));
    expect(within(macro).getByText('Outlook for rates').nextElementSibling).toHaveTextContent('rising');
    const sources = within(macro).getByRole('list', { name: 'Macro sources' });
    const links = within(sources).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://www.ecb.europa.eu/press/pr/date/2026/html/decision.en.html');
    expect(links[0]).toHaveAccessibleName('ecb.europa.eu, dated 2026-10-29 (opens in a new tab)');
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
    }
    expect(sources).toHaveTextContent('2026-10-28');
    expect(macro).not.toHaveTextContent('Macro sources are not stored.');
    expect(macro).not.toHaveTextContent(/Vote:|Rating|Concerns|Conditions/);
  });

  it('says a reused market report keeps its sources with the call that made it', () => {
    const fake = fakeService();
    render(consoleWith(fake.service));
    openTab('Market & Macro');
    act(() => fake.pushCalls({ status: 'ready', calls: [
      callOf({ id: 'run-LN-1001-market-reused', agent: 'market', outcome: 'reused', reusedFrom: 'run-earlier-market-1' }),
    ] }));
    const macro = screen.getByRole('region', { name: 'Market & Macro outlook' });
    expect(macro).toHaveTextContent('Macro sources are not stored.');
    expect(macro).toHaveTextContent('reused the day’s earlier Market & Macro report (call run-earlier-market-1)');
    expect(within(macro).queryByRole('link')).not.toBeInTheDocument();
  });

  it('reports a market call permission failure instead of claiming sources are absent', () => {
    const fake = fakeService();
    render(consoleWith(fake.service));
    openTab('Market & Macro');
    act(() => fake.pushCalls({ status: 'permission-denied' }));
    expect(screen.getByRole('alert')).toHaveTextContent('cannot read the logged AI calls');
    expect(screen.queryByText('Macro sources are not stored.')).not.toBeInTheDocument();
  });

  it('shows vote and rating chips, and does not repeat the fixed affordability report as prose', async () => {
    const run = sampleRun();
    const report = 'Rating: adequate. Recommendation: Approve.\nConcerns: Variable income.\nConditions: Verify payslips.';
    run.agents.affordability = { ...run.agents.affordability!, report };
    render(consoleWith(fakeService({ status: 'ready', run }).service));
    const affordability = within(screen.getByRole('region', { name: 'Affordability vote' }));
    expect(affordability.getByText('Vote: Approve')).toBeInTheDocument();
    expect(affordability.getByText('Rating').nextElementSibling).toHaveTextContent('adequate');
    expect(affordability.queryByText(/writes no free text/)).not.toBeInTheDocument();
    expect(affordability.getByText('Stored report text')).toBeInTheDocument();
    expect(affordability.getByText((_, node) => node?.tagName === 'P' && node.textContent === report)).not.toBeVisible();
    await userEvent.setup().click(affordability.getByText('Stored report text'));
    expect(affordability.getByText((_, node) => node?.tagName === 'P' && node.textContent === report)).toBeVisible();
    for (const heading of ['Report', 'Concerns', 'Conditions']) {
      expect(affordability.getByRole('heading', { level: 4, name: heading })).toBeInTheDocument();
    }
    expect(affordability.getAllByRole('list')).toHaveLength(2);
  });

  it('shows the stored figures the affordability agent judged, with bars against the band limits', async () => {
    const run = sampleRun();
    const report = 'Rating: adequate. Recommendation: Approve.\nConcerns: Variable income.\nConditions: Verify payslips.';
    run.agents.affordability = { ...run.agents.affordability!, report };
    render(consoleWith(fakeService({ status: 'ready', run }).service, 'LN-1001', storedFigures));
    const affordability = within(screen.getByRole('region', { name: 'Affordability vote' }));

    const repayment = affordability.getByText('Monthly repayment').closest('div')!;
    expect(repayment).toHaveTextContent('€1,265 benchmark');
    expect(repayment).toHaveTextContent('€1,555 stressed');
    const dti = affordability.getByText('Debt to income').closest('div.py-3')!;
    expect(dti).toHaveTextContent('33.4%');
    expect(dti).toHaveTextContent('Within the 40% Comfortable limit');
    const stressed = affordability.getByText('Stressed debt to income').closest('div.py-3')!;
    expect(stressed).toHaveTextContent('42.4%');
    expect(stressed).toHaveTextContent('Caution');
    expect(stressed).toHaveTextContent('Above the 40% Comfortable limit, within the 50% Caution limit');
    const bar = stressed.querySelector('[data-ratio-bar]')!;
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(bar.firstElementChild).toHaveClass('bg-vote-conditional');
    const surplus = affordability.getByText('Monthly surplus').closest('div')!;
    expect(surplus).toHaveTextContent('€900 benchmark');
    expect(surplus).toHaveTextContent('€611 stressed');
    expect(surplus).toHaveTextContent('Comfortable');
    // The run's policy gate in sampleRun records one breach.
    expect(affordability.getByRole('list', { name: 'Policy breaches' })).toHaveTextContent('Combined loan-to-value cap CLTV_CAP');
    expect(affordability.getByText(/Source: the DTI breakdown stored on the underwriting review/)).toBeInTheDocument();

    expect(affordability.queryByText(/writes no free text/)).not.toBeInTheDocument();
    await userEvent.setup().click(affordability.getByText('Stored report text'));
    expect(affordability.getByText((_, node) => node?.tagName === 'P' && node.textContent === report)).toBeVisible();
  });

  it('says Not stored for each figure the review does not hold, and for breaches without a stored gate', () => {
    const run = { ...sampleRun(), policyGate: null };
    render(consoleWith(fakeService({ status: 'ready', run }).service, 'LN-1001', {
      dtiPct: null, review: toLoanFileReview({}),
    }));
    const affordability = within(screen.getByRole('region', { name: 'Affordability vote' }));
    for (const label of ['Monthly repayment', 'Monthly surplus']) {
      expect(within(affordability.getByText(label).closest('div')!).getAllByText('Not stored')).toHaveLength(2);
    }
    for (const label of ['Debt to income', 'Stressed debt to income']) {
      const row = affordability.getByText(label).closest('div.py-3')!;
      expect(row).toHaveTextContent('Not stored');
      expect(row.querySelector('[data-ratio-bar]')).toBeNull();
    }
    expect(affordability.getByText('Policy breaches').nextElementSibling).toHaveTextContent(/^Not stored$/);
  });

  it('says None for a stored gate with no breaches and explains an unreadable review', () => {
    const run = sampleRun();
    run.policyGate = { ...run.policyGate!, breaches: [] };
    const view = render(consoleWith(fakeService({ status: 'ready', run }).service, 'LN-1001', storedFigures));
    expect(screen.getByText('Policy breaches').nextElementSibling).toHaveTextContent(/^None$/);
    view.unmount();
    render(consoleWith(fakeService().service, 'LN-1001', { dtiPct: 33.4, review: { state: 'unavailable' } }));
    expect(screen.getByText(/underwriting review could not be read/)).toBeInTheDocument();
    expect(screen.queryByText('Monthly repayment')).not.toBeInTheDocument();
  });

  it('points the strategist report to the credit memo tab when it is the stored memo', () => {
    const run = sampleRun();
    run.agents.strategist = { ...run.agents.strategist!, report: run.creditMemo };
    render(consoleWith(fakeService({ status: 'ready', run }).service));
    openTab('Strategist');
    const strategist = within(screen.getByRole('region', { name: 'Strategist vote' }));
    expect(strategist.getByText(/report is the credit memo/)).toBeInTheDocument();
    expect(strategist.queryByText('Household can meet repayments.', { exact: false })).not.toBeInTheDocument();
    fireEvent.click(strategist.getByRole('button', { name: 'Read the credit memo' }));
    expect(screen.getByRole('tab', { name: 'Credit memo' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Credit memo' })).toHaveFocus();
  });

  it('shows how long the run took and marks a re-run with the run it repeats', () => {
    const run = {
      ...sampleRun(), trigger: 'rerun' as const, rerunOf: 'run-LN-1001-old',
      startedAt: new Date('2026-11-04T13:26:00.000Z'), finishedAt: new Date('2026-11-04T13:27:23.400Z'),
    };
    render(consoleWith(fakeService({ status: 'ready', run }).service));
    expect(screen.getByRole('status')).toHaveTextContent('Run status: Complete · Took 1 min 23 s · Re-run');
    expect(screen.getByText('Re-run of').nextElementSibling).toHaveTextContent('run-LN-1001-old');
  });

  it('keeps the run ID, times and original run behind a Run details disclosure', async () => {
    const run = {
      ...sampleRun(), trigger: 'rerun' as const, rerunOf: 'run-LN-1001-old',
      startedAt: new Date('2026-11-04T13:26:00.000Z'), finishedAt: new Date('2026-11-04T13:27:23.400Z'),
    };
    render(consoleWith(fakeService({ status: 'ready', run }).service));
    const summary = screen.getByText('Run details');
    const details = summary.closest('details')!;
    expect(details).not.toHaveAttribute('open');
    for (const label of ['Run ID', 'Started', 'Finished', 'Re-run of']) {
      expect(within(details).getByText(label)).not.toBeVisible();
    }
    expect(within(details).getByText('run-LN-1001')).not.toBeVisible();

    // A native <details>: the summary is in the tab order and opens with Enter or a click.
    const user = userEvent.setup();
    await user.click(summary);
    expect(details).toHaveAttribute('open');
    expect(within(details).getByText('run-LN-1001')).toBeVisible();
    expect(within(details).getByText('Started').nextElementSibling).toHaveTextContent('2026');
    expect(within(details).getByText('Finished').nextElementSibling).toHaveTextContent('2026');
  });

  it('copies the run ID and the original run ID and says Copied politely', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const run = { ...sampleRun(), trigger: 'rerun' as const, rerunOf: 'run-LN-1001-old' };
    render(consoleWith(fakeService({ status: 'ready', run }).service));
    await user.click(screen.getByText('Run details'));

    await user.click(screen.getByRole('button', { name: 'Copy run ID' }));
    expect(writeText).toHaveBeenLastCalledWith('run-LN-1001');
    const copied = await screen.findByText('Copied');
    expect(copied).toHaveAttribute('aria-live', 'polite');

    screen.getByRole('button', { name: 'Copy original run ID' }).focus();
    await user.keyboard('{Enter}');
    expect(writeText).toHaveBeenLastCalledWith('run-LN-1001-old');
    expect(await screen.findAllByText('Copied')).toHaveLength(2);
  });

  it('says it could not copy when the clipboard is refused', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(consoleWith(fakeService().service));
    await user.click(screen.getByText('Run details'));
    await user.click(screen.getByRole('button', { name: 'Copy run ID' }));
    expect(await screen.findByText('Could not copy')).toBeInTheDocument();
  });

  it('shows a short run in seconds and no re-run marker for a submitted run', () => {
    const run = {
      ...sampleRun(), trigger: 'submit' as const, rerunOf: null,
      startedAt: new Date('2026-11-04T13:26:00.000Z'), finishedAt: new Date('2026-11-04T13:26:42.250Z'),
    };
    render(consoleWith(fakeService({ status: 'ready', run }).service));
    expect(screen.getByRole('status')).toHaveTextContent('Run status: Complete · Took 42.3 s');
    expect(screen.getByRole('status')).not.toHaveTextContent('Re-run');
    expect(screen.queryByText(/Re-run of/)).not.toBeInTheDocument();
  });

  it('words an interrupted run plainly and keeps the stored reason', () => {
    const run = { ...sampleRun(), status: 'failed' as const, failedStep: 'run', failureReason: 'interrupted' };
    render(consoleWith(fakeService({ status: 'ready', run }).service));
    expect(screen.getByText('Reason: Interrupted by a restart or deploy')).toBeInTheDocument();
    expect(screen.getByText('interrupted').parentElement).toHaveTextContent('Stored reason: interrupted');
  });

  it('says in one line when an agent raised no concerns or conditions', () => {
    const run = sampleRun();
    run.agents.valuation = { ...run.agents.valuation!, concerns: [], conditions: [] };
    render(consoleWith(fakeService({ status: 'ready', run }).service));
    openTab('Valuation');
    const valuation = within(screen.getByRole('region', { name: 'Valuation vote' }));
    expect(valuation.getByText('No concerns or conditions raised')).toBeInTheDocument();
    expect(valuation.queryByRole('heading', { name: 'Concerns' })).not.toBeInTheDocument();
    expect(valuation.queryByRole('heading', { name: 'Conditions' })).not.toBeInTheDocument();
    expect(valuation.queryByText('None recorded')).not.toBeInTheDocument();
  });

  it('shows both lists when one has items, with None beside an empty one', () => {
    const run = sampleRun();
    run.agents.valuation = { ...run.agents.valuation!, concerns: [], conditions: ['Obtain a survey'] };
    render(consoleWith(fakeService({ status: 'ready', run }).service));
    openTab('Valuation');
    const valuation = within(screen.getByRole('region', { name: 'Valuation vote' }));
    expect(valuation.getByRole('heading', { name: 'Concerns' })).toBeInTheDocument();
    expect(valuation.getByText('None')).toBeInTheDocument();
    expect(valuation.getByText('Obtain a survey')).toBeInTheDocument();
    expect(valuation.queryByText('No concerns or conditions raised')).not.toBeInTheDocument();
  });

  it('keeps Not stored apart from an empty list', () => {
    const run = sampleRun();
    run.agents.valuation = { ...run.agents.valuation!, concerns: null, conditions: [] };
    render(consoleWith(fakeService({ status: 'ready', run }).service));
    openTab('Valuation');
    const valuation = within(screen.getByRole('region', { name: 'Valuation vote' }));
    expect(valuation.getByText('Not stored')).toBeInTheDocument();
    expect(valuation.getByText('None')).toBeInTheDocument();
  });

  it('shows a failed call outcome and its stored error', async () => {
    const fake = fakeService();
    render(consoleWith(fake.service));
    await userEvent.setup().click(screen.getByRole('button', { name: 'View calls' }));
    act(() => fake.pushCalls({ status: 'ready', calls: [callOf({
      id: 'run-LN-1001-valuation_agent-1', agent: 'valuation', outcome: 'provider_error', attempt: 1,
      error: 'HTTP 503 from the provider',
    })] }));
    const calls = screen.getByRole('list', { name: 'Logged AI calls' });
    expect(within(calls).getByText('Outcome: Provider error')).toBeInTheDocument();
    expect(within(calls).getByText('Error: HTTP 503 from the provider')).toBeInTheDocument();
    expect(calls).not.toHaveTextContent('Tokens:');
  });
});

describe('committee console while the run goes', () => {
  const at = (second: number) => Timestamp.fromMillis(Date.UTC(2026, 10, 24, 18, 0, second));
  const affordabilityReport = {
    recommendation: 'Approve', rating: 'adequate', concerns: ['Variable income'], conditions: ['Verify payslips'],
    report: 'Repayments fit the household budget.', provider: 'ollama', model: 'qwen3.5:9b', promptVersion: 'affordability-v1',
  };

  // A run al-ai is still working on: every step queued unless `progress` says otherwise.
  function liveRun(progress: Partial<Record<CommitteeStep, Record<string, unknown>>>, fields: Record<string, unknown> = {}, id = 'run-LN-1001') {
    const steps = Object.fromEntries(COMMITTEE_STEPS.map((step) => [step, { status: 'queued', startedAt: null, finishedAt: null, ...progress[step] }]));
    return toCommitteeRun(id, { applicationId: 'LN-1001', brokerId: 'broker-1', status: 'running', startedAt: at(0), steps, ...fields });
  }
  const ok = (second: number) => ({ status: 'ok', startedAt: at(second - 1), finishedAt: at(second) });
  const running = (second: number) => ({ status: 'running', startedAt: at(second) });

  it('shows each tab queued or thinking and the steps done so far', () => {
    render(consoleWith(fakeService({ status: 'ready', run: liveRun({ validate: ok(1), valuation_model: ok(2), market: running(3) }) }).service));
    const overall = screen.getByRole('progressbar', { name: 'Committee progress' });
    expect(overall).toHaveAttribute('aria-valuenow', '2');
    expect(overall).toHaveAttribute('aria-valuemax', '8');
    expect(screen.getByText('2 of 8 steps done')).toBeInTheDocument();
    expect(screen.getByText('Working on: Market & Macro')).toBeInTheDocument();
    for (const name of ['Affordability, queued', 'Valuation, queued', 'Strategist, queued', 'Market & Macro, thinking', 'Credit memo, queued', 'Policy gate, queued']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(within(screen.getByRole('tabpanel')).getByText('Queued. It starts when the steps before it finish.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Affordability vote' })).not.toBeInTheDocument();
    openTab('Market & Macro, thinking');
    const panel = within(screen.getByRole('tabpanel'));
    expect(panel.getByText('Thinking…')).toBeInTheDocument();
    expect(panel.getByRole('progressbar', { name: 'Market & Macro in progress' })).not.toHaveAttribute('aria-valuenow');
  });

  it('fills a tab with its figures and report as soon as its agent finishes, without a reload', async () => {
    const storedReport = 'Rating: adequate. Recommendation: Approve.\nConcerns: Variable income.\nConditions: Verify payslips.';
    const before = { validate: ok(1), valuation_model: ok(2), market: ok(3), calculations: ok(4), affordability: running(5), valuation_agent: running(5) };
    const fake = fakeService({ status: 'ready', run: liveRun(before) });
    render(consoleWith(fake.service, 'LN-1001', storedFigures));
    expect(screen.getByRole('tab', { name: 'Affordability, thinking' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Working on: Affordability and Valuation')).toBeInTheDocument();
    expect(screen.queryByText('Monthly repayment')).not.toBeInTheDocument();
    act(() => fake.pushRun({ status: 'ready', run: liveRun({ ...before, affordability: ok(9) }, { agents: { affordability: { ...affordabilityReport, report: storedReport } } }) }));
    expect(screen.getByRole('tab', { name: 'Affordability, done' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Valuation, thinking' })).toBeInTheDocument();
    const affordability = within(screen.getByRole('region', { name: 'Affordability vote' }));
    expect(affordability.getByText('Monthly repayment')).toBeVisible();
    expect(affordability.getByText('33.4%')).toBeVisible();
    const report = affordability.getByText((_, node) => node?.tagName === 'P' && node.textContent === storedReport);
    expect(report).not.toBeVisible();
    await userEvent.setup().click(affordability.getByText('Stored report text'));
    expect(report).toBeVisible();
    expect(affordability.getByText('Vote: Approve')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Committee progress' })).toHaveAttribute('aria-valuenow', '5');
  });

  it('shows a failed step and its reason on its tab while the run is still going', () => {
    const run = liveRun({ validate: ok(1), valuation_agent: { status: 'failed', startedAt: at(5), finishedAt: at(6), failureReason: 'Groq answered 503 three times.' } });
    render(consoleWith(fakeService({ status: 'ready', run }).service));
    openTab('Valuation, failed');
    expect(within(screen.getByRole('tabpanel')).getByText('This step failed: Groq answered 503 three times.')).toBeInTheDocument();
  });

  it('marks the failed step on a failed run with the run\'s stored reason', () => {
    const run = { ...sampleRun(), status: 'failed' as const, failedStep: 'valuation_agent', failureReason: 'Provider quota exceeded.' };
    render(consoleWith(fakeService({ status: 'ready', run }).service));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Affordability' })).toBeInTheDocument();
    openTab('Valuation, failed');
    expect(within(screen.getByRole('tabpanel')).getByText('This step failed: Provider quota exceeded.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Valuation vote' })).toBeInTheDocument();
  });

  it('renders a finished run the same whether or not it stored its steps', () => {
    const allOk = liveRun(Object.fromEntries(COMMITTEE_STEPS.map((step, index) => [step, ok(index + 1)]))).steps;
    const without = render(consoleWith(fakeService().service));
    const expected = without.container.textContent;
    without.unmount();
    const withSteps = render(consoleWith(fakeService({ status: 'ready', run: { ...sampleRun(), steps: allOk } }).service));
    expect(withSteps.container.textContent).toBe(expected);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Affordability', 'Valuation', 'Strategist', 'Market & Macro', 'Credit memo', 'Policy gate']);
  });

  it('starts the progress again when a re-run replaces the run', () => {
    const fake = fakeService();
    render(consoleWith(fake.service));
    act(() => fake.pushRun({ status: 'ready', run: liveRun({}, { trigger: 'rerun', rerunOf: 'run-LN-1001' }, 'run-LN-1001-rerun') }));
    expect(screen.getByRole('progressbar', { name: 'Committee progress' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('tab', { name: 'Affordability, queued' })).toBeInTheDocument();
  });
});
