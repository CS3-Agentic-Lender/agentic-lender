import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DecisionServiceContext } from '../../context/DecisionContext';
import { ApiError } from '../../services/apiClient';
import type { DecisionResult, DecisionService } from '../../services/decisionService';
import type { PolicyGate } from '../../services/loanFileService';
import { SignOffPanel } from './SignOffPanel';

const gate: PolicyGate = { original: 'Approve', effective: 'Approve', conditions: [], breaches: [] };
const result: DecisionResult = { id: 'app-deliberated', status: 'Underwriter Approved', decision: { outcome: 'approved' } };

function renderPanel(policyGate: PolicyGate | null = gate) {
  const signOff = vi.fn<DecisionService['signOff']>().mockResolvedValue(result);
  function Harness() {
    const [recorded, setRecorded] = useState<DecisionResult | null>(null);
    return (
      <DecisionServiceContext.Provider value={{ signOff }}>
        {recorded ? <p role="status">Decision recorded: {recorded.decision.outcome}</p> : (
          <SignOffPanel applicationId="app-deliberated" borrowerName="Alice Byrne" onRecorded={setRecorded} policyGate={policyGate} />
        )}
      </DecisionServiceContext.Provider>
    );
  }
  render(<Harness />);
  return { signOff, user: userEvent.setup() };
}

function reasonBox() {
  return screen.getByRole('textbox', { name: /Justification/ });
}

afterEach(cleanup);

describe('sign-off panel', () => {
  it('disables both decisions until the required justification contains non-whitespace text', async () => {
    const { user } = renderPanel();
    const approve = screen.getByRole('button', { name: 'Approve' });
    const decline = screen.getByRole('button', { name: 'Decline' });
    expect(reasonBox()).toBeRequired();
    expect(reasonBox()).toHaveAttribute('maxlength', '1000');
    expect(approve).toBeDisabled();
    expect(decline).toBeDisabled();
    await user.type(reasonBox(), '   ');
    expect(approve).toBeDisabled();
    expect(decline).toBeDisabled();
    await user.type(reasonBox(), 'Reviewed the evidence.');
    expect(approve).toBeEnabled();
    expect(decline).toBeEnabled();
    await user.clear(reasonBox());
    expect(approve).toBeDisabled();
    expect(decline).toBeDisabled();
  });

  it('shows the effective recommendation, conditions and advice notice', () => {
    renderPanel({ ...gate, effective: 'Conditionally Approve', conditions: ['Requires lender exception review (LTV)'] });
    expect(screen.getByText('Conditionally Approve')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('Requires lender exception review (LTV)');
    expect(screen.getByText(/This is advice only.*decision is yours/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /conditional/i })).not.toBeInTheDocument();
  });

  it('allows a human decision without a recorded recommendation', async () => {
    const { user } = renderPanel(null);
    expect(screen.getByText('No AI recommendation recorded')).toBeInTheDocument();
    await user.type(reasonBox(), 'Reviewed independently.');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it.each([
    ['Approve', 'Decline', true],
    ['Conditionally Approve', 'Decline', true],
    ['Decline', 'Approve', true],
    ['Approve', 'Approve', false],
    ['Conditionally Approve', 'Approve', false],
    ['Decline', 'Decline', false],
    [null, 'Decline', false],
  ] as const)('checks override for %s advice and %s decision', async (effective, outcome, override) => {
    const { user } = renderPanel({ ...gate, effective });
    await user.type(reasonBox(), 'Reviewed the evidence.');
    await user.click(screen.getByRole('button', { name: outcome }));
    expect(Boolean(screen.queryByText('You are going against the AI recommendation.'))).toBe(override);
  });

  it.each(['Cancel', 'Escape'])('shows the summary, moves focus, and keeps the draft after %s', async (close) => {
    const { user, signOff } = renderPanel();
    await user.type(reasonBox(), '  Income verified.  ');
    const approve = screen.getByRole('button', { name: 'Approve' });
    await user.click(approve);
    const dialog = screen.getByRole('dialog', { name: 'Confirm decision' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    for (const text of ['app-deliberated', 'Alice Byrne', 'Approve', 'Income verified.']) {
      expect(within(dialog).getByText(text)).toBeInTheDocument();
    }
    if (close === 'Cancel') {
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    } else {
      await user.keyboard('{Escape}');
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reasonBox()).toHaveValue('  Income verified.  ');
    expect(approve).toHaveFocus();
    expect(signOff).not.toHaveBeenCalled();
  });

  it('keeps Tab and Shift+Tab inside the confirmation', async () => {
    const { user } = renderPanel();
    await user.type(reasonBox(), 'Reviewed.');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Confirm approval' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('sends one trimmed decision on a double click, shows Saving and records success only on resolution', async () => {
    const { user, signOff } = renderPanel();
    let resolve!: (value: DecisionResult) => void;
    signOff.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await user.type(reasonBox(), '  Income verified.  ');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const confirm = screen.getByRole('button', { name: 'Confirm approval' });
    // Both events in one React batch exercise the synchronous lock as well as disabled state.
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    expect(signOff).toHaveBeenCalledExactlyOnceWith('app-deliberated', 'approved', 'Income verified.');
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.queryByText(/Decision recorded/)).not.toBeInTheDocument();
    await act(async () => resolve(result));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Decision recorded: approved');
  });

  it('sends the declined outcome from its own confirmation', async () => {
    const { user, signOff } = renderPanel();
    signOff.mockResolvedValue({ ...result, status: 'Declined', decision: { outcome: 'declined' } });
    await user.type(reasonBox(), 'Insufficient evidence.');
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    await user.click(screen.getByRole('button', { name: 'Confirm decline' }));
    expect(signOff).toHaveBeenCalledExactlyOnceWith('app-deliberated', 'declined', 'Insufficient evidence.');
    expect(screen.getByRole('status')).toHaveTextContent('Decision recorded: declined');
  });

  it.each([
    [new ApiError('http', 'Already decided.', 409), 'Already decided. Reload to see the current status.'],
    [new ApiError('http', 'Forbidden', 403), 'You are not allowed to sign off this application.'],
    [new ApiError('http', 'Unauthorised', 401), 'You are not allowed to sign off this application.'],
    [new ApiError('network', 'Offline'), 'Could not reach the server. Check your connection and try again.'],
    [new ApiError('http', 'No application with that id', 404), 'No application with that id'],
    [new Error('Unexpected'), 'Could not record the decision. Please try again.'],
  ])('preserves the dialog and draft after %s', async (error, message) => {
    const { user, signOff } = renderPanel();
    signOff.mockRejectedValue(error);
    await user.type(reasonBox(), '  Income verified.  ');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(reasonBox()).toHaveValue('  Income verified.  ');
    expect(screen.getByRole('button', { name: 'Confirm approval' })).toBeEnabled();
    expect(signOff).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(reasonBox()).toHaveValue('  Income verified.  ');
  });

  it('keeps the submission locked if Escape closes the dialog while pending', async () => {
    const { user, signOff } = renderPanel();
    let resolve!: (value: DecisionResult) => void;
    signOff.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await user.type(reasonBox(), 'Reviewed.');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled();
    await act(async () => resolve(result));
    expect(signOff).toHaveBeenCalledOnce();
  });
});
