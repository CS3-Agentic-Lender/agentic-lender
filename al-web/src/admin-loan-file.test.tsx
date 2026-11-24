import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { toLoanFileReview } from './services/loanFileService';
import {
  ADMIN_UID,
  FakeCommitteeService,
  FakeLoanFileService,
  at,
  businessApplication,
  committeeRun,
  renderAdmin,
} from './test/adminHarness';

afterEach(cleanup);

const MINT_TX = `0x${'a'.repeat(64)}`;

// A funded file with a minted note and a failed committee run: every control an underwriter or
// broker could act on would have a reason to show.
function fundedFile(status = 'AI Deliberated') {
  return new FakeLoanFileService({
    'LN-1': {
      status: 'ready',
      application: businessApplication('LN-1', {
        status,
        borrowerName: 'Alice Byrne',
        decision: { outcome: 'approved', underwriterId: 'underwriter1', decidedAt: at('2026-11-12T10:00:00Z') },
        loanNote: {
          tokenId: '7',
          contractAddress: `0x${'b'.repeat(40)}`,
          txHash: MINT_TX,
          auditHash: `0x${'c'.repeat(64)}`,
          network: 'amoy',
          mintedAt: at('2026-11-12T10:05:00Z'),
        },
      }),
      review: toLoanFileReview({}),
    },
  });
}

const failedRun = new FakeCommitteeService({
  status: 'ready',
  run: committeeRun('run-1', { status: 'failed', failedStep: 'valuation_agent', failureReason: 'Provider quota exceeded.' }),
});

describe('admin loan file', () => {
  it.each(['AI Deliberated', 'Underwriter Approved', 'Funded'])(
    'shows an admin a %s file with no decision, mint, message, re-run or audit pack controls',
    async (status) => {
      renderAdmin('/admin/applications/LN-1', { loanFiles: fundedFile(status), committee: failedRun });
      expect(await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Loan note' })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /approve|decline|sign off|mint|message|re-run|download/i }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Audit pack' })).not.toBeInTheDocument();
    },
  );

  it('shows an admin the committee run, read as an admin', async () => {
    renderAdmin('/admin/applications/LN-1', { loanFiles: fundedFile(), committee: failedRun });
    const committee = await screen.findByRole('region', { name: 'Committee' });
    expect(await within(committee).findByText('Failed step: valuation_agent')).toBeInTheDocument();
    expect(within(committee).queryByText('Re-running is not available yet.')).not.toBeInTheDocument();
    expect(failedRun.viewers).toContainEqual({ uid: ADMIN_UID, role: 'admin' });
  });

  it('links an admin back to the applications list', async () => {
    renderAdmin('/admin/applications/LN-1', { loanFiles: fundedFile() });
    expect(await screen.findByRole('link', { name: 'Back to the applications' })).toHaveAttribute(
      'href',
      '/admin/business/applications',
    );
  });

  it('keeps a broker and an underwriter off the admin loan file', async () => {
    renderAdmin('/admin/applications/LN-1', { role: 'underwriter', uid: 'underwriter1', loanFiles: fundedFile() });
    expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument();
  });
});
