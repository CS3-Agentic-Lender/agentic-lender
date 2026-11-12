import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommitteeServiceContext } from '../../context/CommitteeContext';
import {
  toCommitteeRun, type CommitteeCallsState, type CommitteeService, type CommitteeState,
} from '../../services/committeeService';
import { CommitteeConsole } from './CommitteeConsole';

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

function consoleWith(service: CommitteeService, applicationId = 'LN-1001') {
  return (
    <CommitteeServiceContext.Provider value={service}>
      <CommitteeConsole applicationId={applicationId} />
    </CommitteeServiceContext.Provider>
  );
}

afterEach(cleanup);

describe('committee console', () => {
  it('shows disagreement and all three stored votes, reports and metadata', () => {
    render(consoleWith(fakeService().service));
    expect(screen.getByText(/Votes disagree/)).toBeInTheDocument();
    const affordability = within(screen.getByRole('region', { name: 'Affordability vote' }));
    for (const value of ['Vote: Approve', 'adequate', 'Variable income', 'Verify payslips', 'Repayments fit the household budget.', 'ollama', 'qwen3.5:9b', 'affordability-v1']) {
      expect(affordability.getByText(value)).toBeInTheDocument();
    }
    const valuation = within(screen.getByRole('region', { name: 'Valuation vote' }));
    for (const value of ['Vote: Conditionally Approve', 'weak', 'Limited comparables', 'Obtain a survey', 'The estimate needs a survey.', 'groq', 'openai/gpt-oss-120b']) {
      expect(valuation.getByText(value)).toBeInTheDocument();
    }
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
    expect(screen.getAllByText('Vote: Approve')).toHaveLength(3);
  });

  it('keeps Macro separate from the votes and explains that sources are not stored', () => {
    render(consoleWith(fakeService().service));
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
    expect(screen.getByRole('region', { name: 'Credit memo' }).querySelector('p')?.textContent).toBe(sampleRun().creditMemo);
    const gate = screen.getByRole('region', { name: 'Policy gate' });
    expect(gate).toHaveTextContent('Policy gate changed the recommendation');
    expect(gate).toHaveTextContent('Reduce the credit limit');
    expect(gate).toHaveTextContent('CLTV_CAP');
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

  it('shows running and missing outputs without manufacturing completed results', () => {
    render(consoleWith(fakeService({ status: 'ready', run: toCommitteeRun('run-LN-1001', { status: 'running' }) }).service));
    expect(screen.getByRole('status')).toHaveTextContent('Run status: Running');
    expect(screen.getByText(/Outputs not stored yet are pending/)).toBeInTheDocument();
    expect(screen.getAllByText('Vote: Not stored')).toHaveLength(3);
    expect(screen.getByText('Credit memo not stored yet')).toBeInTheDocument();
    expect(screen.getByText('Policy gate not stored yet.')).toBeInTheDocument();
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
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
    act(() => fake.pushCalls({ status: 'ready', calls: [{
      id: 'call-LN-1001-affordability', agent: 'affordability', provider: 'ollama', model: 'qwen3.5:9b',
      latencyMs: 1234, createdAt: new Date('2026-10-07T12:00:00Z'), output: 'Stored call output.',
    }] }));
    const calls = screen.getByRole('list', { name: 'Logged AI calls' });
    for (const text of ['affordability', 'call-LN-1001-affordability', 'ollama', 'qwen3.5:9b', '1234 ms', '2026']) {
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
});
