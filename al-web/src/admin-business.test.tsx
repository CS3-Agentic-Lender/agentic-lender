import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { Timestamp } from 'firebase/firestore';
import { afterEach, describe, expect, it } from 'vitest';
import { isoDay } from './pages/admin/business/figures';
import { formatDate } from './utils/formatters';
import type { CommitteeRun } from './services/committeeService';
import type { Review, SupportRequest } from './services/inboxService';
import type { LoanFileApplication } from './services/loanFileService';
import type { DirectoryUser } from './services/userDirectoryService';
import {
  FakeBusinessService,
  FakeInboxService,
  FakeLive,
  FakeUserDirectoryService,
  at,
  businessApplication,
  committeeRun,
  expectLoading,
  renderAdmin,
} from './test/adminHarness';

afterEach(cleanup);

const thisMonth = Timestamp.fromDate(new Date());

function applications() {
  return [
    businessApplication('LN-1', { borrowerName: 'Alice Byrne', status: 'Applied', createdAt: thisMonth }),
    businessApplication('LN-2', {
      borrowerName: 'Ben Walsh',
      borrowerId: 'borrower2',
      brokerId: 'broker2',
      status: 'Declined',
      loanType: 'heloc',
      decision: { outcome: 'declined', underwriterId: 'underwriter1' },
      createdAt: thisMonth,
    }),
    businessApplication('LN-3', {
      borrowerName: 'Alice Byrne',
      status: 'Funded',
      decision: { outcome: 'approved', underwriterId: 'underwriter1' },
    }),
    businessApplication('LN-4', {
      borrowerName: 'Alice Byrne',
      status: 'Underwriter Approved',
      decision: { outcome: 'approved', underwriterId: 'underwriter1' },
    }),
  ];
}

function business(apps: LoanFileApplication[] | null = applications(), runs = [
  committeeRun('run-1', { applicationId: 'LN-3', status: 'complete' }),
  committeeRun('run-2', { applicationId: 'LN-4', status: 'complete' }),
  committeeRun('run-3', { applicationId: 'LN-1', status: 'failed' }),
]) {
  return new FakeBusinessService(new FakeLive(apps), new FakeLive(runs));
}

function inbox() {
  const request = (reference: string, status: SupportRequest['status']): SupportRequest => ({
    reference, userId: 'borrower1', category: null, subject: null, message: null, applicationId: null,
    status, createdAt: null, closedAt: null, closedBy: null, resolution: null,
  });
  const review = (uid: string, rating: number): Review => ({ uid, rating, comment: null, createdAt: null, updatedAt: null });
  return new FakeInboxService(
    new FakeLive([request('SR-1', 'open'), request('SR-2', 'closed')]),
    new FakeLive([review('borrower1', 5), review('borrower2', 4)]),
  );
}

describe('business overview', () => {
  it('is reached from the admin header and its sub-navigation', async () => {
    const { user } = renderAdmin('/admin', { business: business() });
    const header = await screen.findByRole('navigation', { name: 'Admin portal' });
    await user.click(within(header).getByRole('link', { name: 'Business' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Business' })).toBeInTheDocument();
    const sections = screen.getByRole('navigation', { name: 'Business' });
    expect(within(sections).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Overview',
      'Applications',
      'Users',
      'AI runs',
      'Audit',
    ]);
    expect(within(sections).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });

  it('links each count by status and loan type to the list it counts', async () => {
    renderAdmin('/admin/business', { business: business() });
    expect(await screen.findByRole('link', { name: 'Declined: 1 application. Show them.' })).toHaveAttribute(
      'href',
      '/admin/business/applications?status=Declined',
    );
    expect(screen.getByRole('link', { name: 'Underwriter Approved: 1 application. Show them.' })).toHaveAttribute(
      'href',
      '/admin/business/applications?status=Underwriter+Approved',
    );
    expect(screen.getByRole('link', { name: 'Draft: 0 applications. Show them.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'HELOC: 1 application. Show them.' })).toHaveAttribute(
      'href',
      '/admin/business/applications?loanType=heloc',
    );
    expect(screen.getByRole('link', { name: 'Mortgage: 3 applications. Show them.' })).toBeInTheDocument();
  });

  it('counts the applications opened in each of the last six months and links to each month', async () => {
    renderAdmin('/admin/business', { business: business() });
    const months = await screen.findByRole('list', { name: 'Applications opened per month' });
    const links = within(months).getAllByRole('link');
    expect(links).toHaveLength(6);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    expect(links[5]).toHaveAccessibleName(expect.stringMatching(/: 4 applications opened\. Show them\.$/));
    expect(links[5]).toHaveAttribute('href', `/admin/business/applications?from=${isoDay(start)}&to=${isoDay(end)}`);
  });

  it('rates approvals and declines out of the decided applications, each linking to its list', async () => {
    renderAdmin('/admin/business', { business: business() });
    const rate = await screen.findByRole('link', { name: /Approval rate.*67%/ });
    expect(rate).toHaveTextContent('2 approved of 3 decided.');
    expect(rate).toHaveAttribute('href', '/admin/business/applications?decision=approved');
    expect(screen.getByRole('link', { name: 'Declined: 1 application, 33% of decided. Show them.' })).toHaveAttribute(
      'href',
      '/admin/business/applications?decision=declined',
    );
  });

  it('says when nothing has been decided yet', async () => {
    renderAdmin('/admin/business', { business: business([businessApplication('LN-1')]) });
    const rate = await screen.findByRole('link', { name: /Approval rate.*Nothing decided yet\./ });
    expect(rate).toHaveTextContent('—');
  });

  it('counts committee runs by status and links each to the runs list', async () => {
    renderAdmin('/admin/business', { business: business() });
    expect(await screen.findByRole('link', { name: 'Complete: 2 runs. Show them.' })).toHaveAttribute(
      'href',
      '/admin/business/ai-runs?status=complete',
    );
    expect(screen.getByRole('link', { name: 'Failed: 1 run. Show them.' })).toHaveAttribute(
      'href',
      '/admin/business/ai-runs?status=failed',
    );
    expect(screen.getByRole('link', { name: 'Running: 0 runs. Show them.' })).toBeInTheDocument();
  });

  it('links the average review and the open support requests to the inbox', async () => {
    renderAdmin('/admin/business', { business: business(), inbox: inbox() });
    const reviews = await screen.findByRole('link', { name: /Average review.*4\.5/ });
    expect(reviews).toHaveAttribute('href', '/admin/inbox?tab=reviews');
    const support = screen.getByRole('link', { name: /Open support requests/ });
    expect(support).toHaveTextContent('1');
    expect(support).toHaveAttribute('href', '/admin/inbox');
  });

  it('says when there are no applications yet', async () => {
    renderAdmin('/admin/business', { business: business([], []) });
    expect(await screen.findByText('No applications yet')).toBeInTheDocument();
    expect(screen.getByText('No committee runs yet.')).toBeInTheDocument();
  });

  it('shows the loading state, then the error, of each list', async () => {
    const live = new FakeLive<LoanFileApplication>(null);
    const runs = new FakeLive<CommitteeRun>(null);
    renderAdmin('/admin/business', { business: new FakeBusinessService(live, runs) });
    await expectLoading('Loading the applications');
    await expectLoading('Loading the committee runs');
    expect(screen.getByRole('link', { name: /^Loan notes minted/ })).toHaveAttribute('aria-busy', 'true');
    live.fail('unavailable');
    runs.fail('permission-denied');
    expect(await screen.findByText('The applications could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('The committee runs could not be loaded.')).toBeInTheDocument();
  });
});

function rowNames() {
  return screen.getAllByRole('rowheader').map((cell) => cell.querySelector('a')?.textContent);
}

describe('business overview chart tooltips', () => {
  it('explains a bar on keyboard focus with its exact value, share and what it counts, and Escape hides it', async () => {
    const { user } = renderAdmin('/admin/business', { business: business() });
    const declined = await screen.findByRole('link', { name: 'Declined: 1 application. Show them.' });
    expect(declined).toHaveAccessibleDescription(/1 application.*25% of 4 applications.*status is now Declined/);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => declined.focus());
    expect(screen.getByRole('tooltip')).toHaveTextContent(/1 application.*25% of 4 applications/);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('explains a month column on pointer hover and hides it when the pointer leaves', async () => {
    const { user } = renderAdmin('/admin/business', { business: business() });
    const months = await screen.findByRole('list', { name: 'Applications opened per month' });
    const current = within(months).getAllByRole('link')[5];
    await user.hover(current);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent(/4 applications.*100% of the 4 opened in the last six months.*opened in /);
    expect(current).toHaveAttribute('aria-describedby', tip.id);
    await user.unhover(current);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows the tooltip on the first tap and opens the list on the second', async () => {
    const { user } = renderAdmin('/admin/business', { business: business() });
    const complete = await screen.findByRole('link', { name: 'Complete: 2 runs. Show them.' });
    await user.pointer({ keys: '[TouchA]', target: complete });
    expect(screen.getByRole('tooltip')).toHaveTextContent(/2 runs.*67% of 3 runs.*Tap again to open the list\./);
    expect(screen.getByRole('heading', { level: 1, name: 'Business' })).toBeInTheDocument();
    await user.pointer({ keys: '[TouchA]', target: complete });
    expect(await screen.findByRole('heading', { level: 1, name: 'AI runs' })).toBeInTheDocument();
  });

  it('closes a tapped tooltip when the admin taps somewhere else', async () => {
    renderAdmin('/admin/business', { business: business() });
    const complete = await screen.findByRole('link', { name: 'Complete: 2 runs. Show them.' });
    // Raw events, because a tap in iOS Safari does not focus the link, so no blur ever closes its tooltip.
    fireEvent.pointerDown(complete, { pointerType: 'touch' });
    fireEvent.click(complete);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(complete).not.toHaveFocus();

    fireEvent.pointerDown(screen.getByRole('heading', { level: 1, name: 'Business' }), { pointerType: 'touch' });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Business' })).toBeInTheDocument();
  });

  it('explains a bar with no list behind it on focus too', async () => {
    renderAdmin('/admin/business', {
      business: business([...applications(), businessApplication('LN-5', { loanType: null })]),
    });
    const missing = await screen.findByRole('group', { name: 'Type not recorded: 1 application.' });
    act(() => missing.focus());
    expect(screen.getByRole('tooltip')).toHaveTextContent(/1 application.*20% of 5 applications.*no loan type/);
  });
});

describe('business overview blockchain', () => {
  const MINT_TX = `0x${'a'.repeat(64)}`;
  const AUDIT_HASH = `0x${'c'.repeat(64)}`;
  const REGISTRY_TX = `0x${'d'.repeat(64)}`;
  const note = (tokenId: string, mintedAt: string, extra: Record<string, unknown> = {}) => ({
    tokenId,
    contractAddress: `0x${'b'.repeat(40)}`,
    txHash: MINT_TX,
    auditHash: AUDIT_HASH,
    network: 'amoy',
    mintedAt: at(mintedAt),
    ...extra,
  });
  const minted = () => [
    businessApplication('LN-1', { borrowerName: 'Alice Byrne' }),
    businessApplication('LN-3', {
      borrowerName: 'Cara Doyle',
      status: 'Funded',
      loanNote: note('7', '2026-11-12T10:05:00Z'),
      auditTxHash: REGISTRY_TX,
    }),
    businessApplication('LN-4', {
      borrowerName: 'Dan Roche',
      status: 'Closed',
      loanNote: note('8', '2026-11-14T10:05:00Z', { network: 'localhost', closedAt: at('2026-11-20T10:00:00Z') }),
    }),
  ];

  it('counts the loan notes minted and closed and the audit hashes recorded, each linking to the audit list', async () => {
    renderAdmin('/admin/business', { business: business(minted()) });
    const chain = await screen.findByRole('region', { name: 'Blockchain' });
    const mintedTile = await within(chain).findByRole('link', { name: /Loan notes minted.*Latest on/ });
    expect(mintedTile).toHaveTextContent('2');
    expect(mintedTile).toHaveAttribute('href', '/admin/business/audit?note=minted');
    const closed = within(chain).getByRole('link', { name: /Loan notes closed/ });
    expect(closed).toHaveTextContent('1');
    expect(closed).toHaveTextContent('1 still open.');
    expect(closed).toHaveAttribute('href', '/admin/business/audit?note=closed');
    const recorded = within(chain).getByRole('link', { name: /Audit hashes recorded/ });
    expect(recorded).toHaveTextContent('1 of 2 minted loans');
    expect(recorded).toHaveAttribute('href', '/admin/business/audit?note=recorded');
  });

  it('lists the recent mints newest first, linking to Polygonscan only for well-formed hashes on Amoy', async () => {
    renderAdmin('/admin/business', { business: business(minted()) });
    const mints = await screen.findByRole('list', { name: 'Recent mints' });
    const rows = within(mints).getAllByRole('listitem');
    expect(rows.map((row) => within(row).getAllByRole('link')[0].textContent)).toEqual(['Dan Roche', 'Cara Doyle']);
    const cara = rows[1];
    expect(within(cara).getByRole('link', { name: 'Cara Doyle' })).toHaveAttribute('href', '/admin/applications/LN-3');
    expect(cara).toHaveTextContent('Token #7');
    expect(cara).toHaveTextContent(formatDate(new Date('2026-11-12T10:05:00Z')));
    expect(within(cara).getByRole('link', { name: /Mint transaction .* on Polygonscan/ })).toHaveAttribute(
      'href',
      `https://amoy.polygonscan.com/tx/${MINT_TX}`,
    );
    expect(within(cara).getByRole('link', { name: /Audit hash .* on Polygonscan/ })).toHaveAttribute(
      'href',
      `https://amoy.polygonscan.com/tx/${REGISTRY_TX}`,
    );
    // Minted on the local chain: the hashes are shown in full on hover, with nowhere to link.
    const dan = rows[0];
    expect(within(dan).getByTitle(MINT_TX)).toBeInTheDocument();
    expect(within(dan).getByTitle(AUDIT_HASH)).toBeInTheDocument();
    expect(within(dan).queryByRole('link', { name: /Polygonscan/ })).not.toBeInTheDocument();
  });

  it('says when no loan note has been minted yet', async () => {
    renderAdmin('/admin/business', { business: business([businessApplication('LN-1')]) });
    const chain = await screen.findByRole('region', { name: 'Blockchain' });
    expect(await within(chain).findByText('No loan notes minted yet.')).toBeInTheDocument();
    expect(within(chain).getByRole('link', { name: /Loan notes minted.*None minted yet\./ })).toHaveTextContent('0');
  });
});

describe('business applications list', () => {
  const dated = () => [
    businessApplication('LN-1', { borrowerName: 'Alice Byrne', status: 'Applied', createdAt: Timestamp.fromDate(new Date(2026, 9, 5)) }),
    businessApplication('LN-2', {
      borrowerName: 'Ben Walsh',
      borrowerId: 'borrower2',
      brokerId: 'broker2',
      status: 'Declined',
      loanType: 'heloc',
      loanAmountEur: 40000,
      decision: { outcome: 'declined' },
      createdAt: Timestamp.fromDate(new Date(2026, 10, 2)),
    }),
    businessApplication('LN-3', { borrowerName: 'Cara Doyle', status: 'Funded', createdAt: Timestamp.fromDate(new Date(2026, 8, 20)) }),
  ];

  async function table() {
    return screen.findByRole('table', { name: 'Applications' });
  }

  it('lists every application, newest first, with its status, type, amount and broker', async () => {
    renderAdmin('/admin/business/applications', { business: business(dated()) });
    await table();
    expect(rowNames()).toEqual(['Ben Walsh', 'Alice Byrne', 'Cara Doyle']);
    const ben = screen.getByRole('rowheader', { name: /Ben Walsh/ }).closest('tr')!;
    for (const text of ['LN-2', 'Declined', 'HELOC', '€40,000', 'Ciara Kelly', '2 Nov 2026']) {
      expect(within(ben).getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText('Showing all 3 applications.')).toBeInTheDocument();
  });

  it('opens an application on the read-only loan file', async () => {
    renderAdmin('/admin/business/applications', { business: business(dated()) });
    await table();
    expect(screen.getByRole('link', { name: 'Ben Walsh' })).toHaveAttribute('href', '/admin/applications/LN-2');
  });

  it('takes its filters from the URL', async () => {
    renderAdmin('/admin/business/applications?status=Declined&broker=broker2', { business: business(dated()) });
    await table();
    expect(rowNames()).toEqual(['Ben Walsh']);
    expect(screen.getByLabelText('Status')).toHaveValue('Declined');
    expect(screen.getByLabelText('Broker')).toHaveValue('broker2');
    expect(screen.getByText('Showing 1 of 3 applications.')).toBeInTheDocument();
  });

  it('filters by the day each application was opened', async () => {
    renderAdmin('/admin/business/applications?from=2026-10-01&to=2026-10-31', { business: business(dated()) });
    await table();
    expect(rowNames()).toEqual(['Alice Byrne']);
    expect(screen.getByLabelText('Opened from')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Opened to')).toHaveValue('2026-10-31');
  });

  it('filters by loan type and decision, searches by name or ID, and clears it all', async () => {
    const { user } = renderAdmin('/admin/business/applications', { business: business(dated()) });
    await table();
    await user.selectOptions(screen.getByLabelText('Loan type'), 'heloc');
    expect(rowNames()).toEqual(['Ben Walsh']);
    await user.selectOptions(screen.getByLabelText('Loan type'), '');
    await user.selectOptions(screen.getByLabelText('Decision'), 'undecided');
    expect(rowNames()).toEqual(['Alice Byrne', 'Cara Doyle']);
    await user.type(screen.getByLabelText('Search applications'), 'ln-3');
    expect(await screen.findByText('Showing 1 of 3 applications.')).toBeInTheDocument();
    expect(rowNames()).toEqual(['Cara Doyle']);
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Showing all 3 applications.')).toBeInTheDocument();
    expect(screen.getByLabelText('Search applications')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('opens filtered from an overview figure', async () => {
    const { user } = renderAdmin('/admin/business', { business: business(dated()) });
    await user.click(await screen.findByRole('link', { name: 'HELOC: 1 application. Show them.' }));
    await table();
    expect(rowNames()).toEqual(['Ben Walsh']);
    expect(screen.getByLabelText('Loan type')).toHaveValue('heloc');
  });

  it('says when nothing matches, and when there are no applications', async () => {
    renderAdmin('/admin/business/applications?status=Closed', { business: business(dated()) });
    expect(await screen.findByText('No matches')).toBeInTheDocument();
    cleanup();
    renderAdmin('/admin/business/applications', { business: business([]) });
    expect(await screen.findByText('No applications yet')).toBeInTheDocument();
  });

  it('says when the applications cannot be read', async () => {
    const live = new FakeLive<LoanFileApplication>(null);
    renderAdmin('/admin/business/applications', { business: new FakeBusinessService(live) });
    await expectLoading('Loading the applications');
    live.fail('permission-denied');
    expect(await screen.findByRole('alert')).toHaveTextContent('This account is not allowed to read the applications.');
  });
});

describe('business users list', () => {
  function rowOf(name: string) {
    return screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr')!;
  }

  it('opens from the sub-navigation and keeps the header on Business', async () => {
    const { user } = renderAdmin('/admin/business', { business: business() });
    await user.click(within(await screen.findByRole('navigation', { name: 'Business' })).getByRole('link', { name: 'Users' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Admin portal' })).getByRole('link', { name: 'Business' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('lists everyone with their role and firm, and each borrower with their broker', async () => {
    renderAdmin('/admin/business/users', { business: business() });
    await screen.findByRole('table', { name: 'Users' });
    expect(screen.getAllByRole('rowheader')).toHaveLength(6);
    const bob = rowOf('Bob Murphy');
    expect(within(bob).getByText('Broker')).toBeInTheDocument();
    expect(within(bob).getByText('Murphy Mortgages')).toBeInTheDocument();
    const ben = rowOf('Ben Walsh');
    expect(within(ben).getByText('Borrower')).toBeInTheDocument();
    expect(within(ben).getByText('Ciara Kelly')).toBeInTheDocument();
  });

  it("counts each broker's clients and applications, and links to the applications", async () => {
    renderAdmin('/admin/business/users', { business: business() });
    await screen.findByRole('table', { name: 'Users' });
    const bob = rowOf('Bob Murphy');
    expect(bob.querySelector('td[data-label="Clients"]')).toHaveTextContent(/^1$/);
    expect(rowOf('Ciara Kelly').querySelector('td[data-label="Clients"]')).toHaveTextContent(/^1$/);
    expect(within(bob).getByRole('link', { name: '3 applications through Bob Murphy. Show them.' })).toHaveAttribute(
      'href',
      '/admin/business/applications?broker=broker1',
    );
    expect(within(rowOf('Ciara Kelly')).getByRole('link', { name: '1 application through Ciara Kelly. Show them.' })).toBeInTheDocument();
    expect(within(rowOf('Alice Byrne')).getByRole('link', { name: '3 applications from Alice Byrne. Show them.' })).toHaveAttribute(
      'href',
      '/admin/business/applications?q=borrower1',
    );
    expect(within(rowOf('Uma Nolan')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('filters by role from the URL with a count for each, and searches', async () => {
    const { user } = renderAdmin('/admin/business/users?role=broker', { business: business() });
    await screen.findByRole('table', { name: 'Users' });
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      expect.stringContaining('Bob Murphy'),
      expect.stringContaining('Ciara Kelly'),
    ]);
    expect(screen.getByRole('radio', { name: /^Borrowers ?2$/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /^Brokers ?2$/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^All ?6$/ })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /^All ?6$/ }));
    await user.type(screen.getByLabelText('Search users'), 'murphy');
    expect(await screen.findByText('Showing 2 of 6 users.')).toBeInTheDocument();
    expect(rowOf('Alice Byrne')).toBeInTheDocument();
  });

  it('says when the users cannot be read', async () => {
    const users = new FakeUserDirectoryService(new FakeLive<DirectoryUser>(null));
    renderAdmin('/admin/business/users', { business: business(), users });
    await expectLoading('Loading the users');
    users.live.fail('unavailable');
    expect(await screen.findByRole('alert')).toHaveTextContent('The connection to the users failed.');
  });
});

describe('business AI runs list', () => {
  const runs = () => [
    committeeRun('run-1', {
      applicationId: 'LN-3',
      status: 'complete',
      trigger: 'submit',
      startedAt: at('2026-11-20T10:00:00Z'),
      finishedAt: at('2026-11-20T10:00:42Z'),
    }),
    committeeRun('run-2', {
      applicationId: 'LN-1',
      status: 'failed',
      trigger: 'rerun',
      startedAt: at('2026-11-21T10:00:00Z'),
      finishedAt: at('2026-11-21T10:02:05Z'),
      failedStep: 'valuation_agent',
      failureReason: 'Provider quota exceeded.',
    }),
    committeeRun('run-3', { applicationId: 'LN-4', status: 'running', startedAt: at('2026-11-22T10:00:00Z') }),
  ];

  it('lists the newest runs first with status, trigger, duration and any failure, linking to the application', async () => {
    renderAdmin('/admin/business/ai-runs', { business: business(applications(), runs()) });
    await screen.findByRole('table', { name: 'Committee runs' });
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      expect.stringContaining('LN-4'),
      expect.stringContaining('LN-1'),
      expect.stringContaining('LN-3'),
    ]);
    const failed = screen.getByRole('rowheader', { name: /LN-1/ }).closest('tr')!;
    for (const text of ['Failed', 'Re-run', '2 min 5 s', 'valuation_agent', 'Provider quota exceeded.']) {
      expect(within(failed).getByText(text)).toBeInTheDocument();
    }
    expect(within(failed).getByRole('link', { name: 'Alice Byrne' })).toHaveAttribute('href', '/admin/applications/LN-1');
    const complete = screen.getByRole('rowheader', { name: /LN-3/ }).closest('tr')!;
    expect(within(complete).getByText('42.0 s')).toBeInTheDocument();
    expect(within(complete).getByText('Submitted')).toBeInTheDocument();
  });

  it('filters by status from the URL and searches', async () => {
    const { user } = renderAdmin('/admin/business/ai-runs?status=failed', { business: business(applications(), runs()) });
    await screen.findByRole('table', { name: 'Committee runs' });
    expect(screen.getAllByRole('rowheader')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /^Failed ?1$/ })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /^All ?3$/ }));
    await user.type(screen.getByLabelText('Search runs'), 'ln-4');
    expect(await screen.findByText('Showing 1 of 3 runs.')).toBeInTheDocument();
  });

  it('says when there are no runs, and when they cannot be read', async () => {
    renderAdmin('/admin/business/ai-runs', { business: business(applications(), []) });
    expect(await screen.findByText('No committee runs yet')).toBeInTheDocument();
    cleanup();
    const live = new FakeLive<CommitteeRun>(null);
    renderAdmin('/admin/business/ai-runs', { business: new FakeBusinessService(new FakeLive(applications()), live) });
    await expectLoading('Loading the committee runs');
    live.fail('permission-denied');
    expect(await screen.findByRole('alert')).toHaveTextContent('This account is not allowed to read the committee runs.');
  });
});

describe('business audit list', () => {
  const MINT_TX = `0x${'a'.repeat(64)}`;
  const AUDIT_HASH = `0x${'c'.repeat(64)}`;
  const note = (network: string, txHash = MINT_TX) => ({
    tokenId: '7',
    contractAddress: `0x${'b'.repeat(40)}`,
    txHash,
    auditHash: AUDIT_HASH,
    network,
    mintedAt: at('2026-11-12T10:05:00Z'),
  });
  const decided = () => [
    businessApplication('LN-1', { borrowerName: 'Alice Byrne' }),
    businessApplication('LN-2', {
      borrowerName: 'Ben Walsh',
      status: 'Declined',
      decision: { outcome: 'declined', underwriterId: 'underwriter1', decidedAt: at('2026-11-10T09:00:00Z') },
    }),
    businessApplication('LN-3', {
      borrowerName: 'Cara Doyle',
      status: 'Funded',
      decision: { outcome: 'approved', underwriterId: 'underwriter1', decidedAt: at('2026-11-12T10:00:00Z') },
      loanNote: note('amoy'),
    }),
    businessApplication('LN-4', {
      borrowerName: 'Dan Roche',
      status: 'Funded',
      decision: { outcome: 'approved', underwriterId: 'gone-uw', decidedAt: at('2026-11-11T10:00:00Z') },
      loanNote: note('localhost'),
    }),
  ];

  function rowOf(id: string) {
    return screen.getByRole('rowheader', { name: new RegExp(id) }).closest('tr')!;
  }

  it('lists the decided applications, newest decision first, with who decided and when', async () => {
    renderAdmin('/admin/business/audit', { business: business(decided()) });
    await screen.findByRole('table', { name: 'Decisions and loan notes' });
    expect(screen.getAllByRole('rowheader').map((cell) => cell.querySelector('a')?.textContent)).toEqual([
      'Cara Doyle',
      'Dan Roche',
      'Ben Walsh',
    ]);
    const ben = rowOf('LN-2');
    expect(within(ben).getByText('Declined')).toBeInTheDocument();
    expect(within(ben).getByText('Uma Nolan')).toBeInTheDocument();
    expect(within(ben).getByText('Not minted')).toBeInTheDocument();
    // An underwriter missing from the directory is shown by ID rather than left blank.
    expect(within(rowOf('LN-4')).getByText('gone-uw')).toBeInTheDocument();
  });

  it('links the mint transaction to Polygonscan only for a well-formed hash on Amoy', async () => {
    renderAdmin('/admin/business/audit', { business: business(decided()) });
    await screen.findByRole('table', { name: 'Decisions and loan notes' });
    const cara = rowOf('LN-3');
    expect(within(cara).getByTitle(AUDIT_HASH)).toBeInTheDocument();
    expect(within(cara).getByRole('link', { name: /Mint transaction .* on Polygonscan/ })).toHaveAttribute(
      'href',
      `https://amoy.polygonscan.com/tx/${MINT_TX}`,
    );
    const local = rowOf('LN-4');
    expect(within(local).getByTitle(MINT_TX)).toBeInTheDocument();
    expect(within(local).queryByRole('link', { name: /Polygonscan/ })).not.toBeInTheDocument();
  });

  it('searches by borrower, application or underwriter', async () => {
    const { user } = renderAdmin('/admin/business/audit', { business: business(decided()) });
    await screen.findByRole('table', { name: 'Decisions and loan notes' });
    await user.type(screen.getByLabelText('Search decisions'), 'walsh');
    expect(await screen.findByText('Showing 1 of 3 decisions.')).toBeInTheDocument();
  });

  it('filters by the loan note from the URL, as the overview links to it', async () => {
    const apps = decided();
    apps.push(
      businessApplication('LN-5', {
        borrowerName: 'Eve Kelly',
        status: 'Closed',
        decision: { outcome: 'approved', underwriterId: 'underwriter1', decidedAt: at('2026-11-09T10:00:00Z') },
        loanNote: { ...note('amoy'), closedAt: at('2026-11-20T10:00:00Z') },
      }),
    );
    const { user } = renderAdmin('/admin/business/audit?note=closed', { business: business(apps) });
    await screen.findByRole('table', { name: 'Decisions and loan notes' });
    expect(rowNames()).toEqual(['Eve Kelly']);
    const filter = screen.getByRole('group', { name: 'Loan note' });
    expect(within(filter).getByRole('radio', { name: /Closed/ })).toBeChecked();
    await user.click(within(filter).getByRole('radio', { name: /Minted/ }));
    expect(rowNames()).toEqual(['Cara Doyle', 'Dan Roche', 'Eve Kelly']);
  });

  it('says when nothing has been decided yet', async () => {
    renderAdmin('/admin/business/audit', { business: business([businessApplication('LN-1')]) });
    expect(await screen.findByText('No decisions yet')).toBeInTheDocument();
  });
});
