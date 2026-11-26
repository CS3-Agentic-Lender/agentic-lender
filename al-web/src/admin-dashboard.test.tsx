import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdminAction } from './services/adminActivityService';
import type { Review, SupportRequest } from './services/inboxService';
import {
  FakeActivityService,
  FakeInboxService,
  FakeLive,
  FakeStaffService,
  expectLoading,
  renderAdmin,
  seededStaff,
  staffMember,
} from './test/adminHarness';

afterEach(cleanup);

function request(reference: string, status: SupportRequest['status']): SupportRequest {
  return {
    reference,
    userId: 'borrower1',
    category: 'payment',
    subject: 'Fee question',
    message: 'Was I charged twice?',
    applicationId: null,
    status,
    createdAt: new Date('2026-11-20T10:00:00Z'),
    closedAt: status === 'closed' ? new Date('2026-11-21T10:00:00Z') : null,
    closedBy: status === 'closed' ? 'admin1' : null,
    resolution: null,
  };
}

function review(uid: string, rating: number): Review {
  return { uid, rating, comment: null, createdAt: null, updatedAt: new Date('2026-11-20T10:00:00Z') };
}

function action(id: string, overrides: Partial<AdminAction>): AdminAction {
  return {
    id,
    actorUid: 'admin1',
    kind: 'create_staff',
    action: 'create_staff',
    targetUid: null,
    targetRef: null,
    details: {},
    createdAt: new Date(Date.now() - 5 * 60 * 1000),
    ...overrides,
  };
}

function inbox(requests: SupportRequest[] | null, reviews: Review[] | null) {
  return new FakeInboxService(new FakeLive(requests), new FakeLive(reviews));
}

describe('admin dashboard', () => {
  it('counts staff by role and links each count to its list', async () => {
    const staff = new FakeStaffService([
      ...seededStaff(),
      staffMember({ uid: 'broker3', fullName: 'Dara Quinn', role: 'broker', firm: 'Quinn', enabled: false }),
    ]);
    renderAdmin('/admin', { staff });
    const summary = await screen.findByRole('region', { name: 'Staff' });
    expect(await within(summary).findByRole('link', { name: '3 brokers. Show them.' })).toHaveAttribute(
      'href',
      '/admin/staff?role=broker',
    );
    expect(within(summary).getByRole('link', { name: '1 underwriter. Show them.' })).toBeInTheDocument();
    expect(within(summary).getByRole('link', { name: '1 admin. Show them.' })).toBeInTheDocument();
    expect(within(summary).getByText('1 account disabled.')).toBeInTheDocument();
  });

  it('shows open support requests and the average review', async () => {
    renderAdmin('/admin', {
      inbox: inbox(
        [request('SR-1', 'open'), request('SR-2', 'open'), request('SR-3', 'closed')],
        [review('borrower1', 5), review('borrower2', 4)],
      ),
    });
    expect(await screen.findByText('1 closed request so far.')).toBeInTheDocument();
    expect(screen.getByText('Open support requests').parentElement).toHaveTextContent('2');
    expect(screen.getByText('Average review').parentElement).toHaveTextContent('4.5');
    expect(screen.getByText('Out of 5, from 2 reviews.')).toBeInTheDocument();
  });

  it('links the inbox figures to their tab of the inbox', async () => {
    const { user } = renderAdmin('/admin', { inbox: inbox([request('SR-1', 'open')], [review('borrower1', 5)]) });
    expect(await screen.findByRole('link', { name: /Open support requests/ })).toHaveAttribute('href', '/admin/inbox');
    await user.click(screen.getByRole('link', { name: /Average review/ }));
    expect(await screen.findByRole('tab', { name: /Reviews/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('says when there are no reviews yet', async () => {
    renderAdmin('/admin', { inbox: inbox([], []) });
    expect(await screen.findByText('No reviews yet.')).toBeInTheDocument();
    expect(screen.getByText('0 closed requests so far.')).toBeInTheDocument();
  });

  it('shows placeholders for the inbox figures and the activity while they load', async () => {
    const staff = new FakeStaffService();
    staff.list = () => new Promise(() => {});
    renderAdmin('/admin', {
      staff,
      inbox: inbox(null, null),
      activity: new FakeActivityService(new FakeLive<AdminAction>(null)),
    });
    await screen.findByRole('heading', { name: 'Dashboard' });
    const tile = screen.getByRole('link', { name: /^Open support requests/ });
    expect(tile).toHaveAttribute('aria-busy', 'true');
    expect(tile).toHaveAccessibleName('Open support requests Loading the support requests. Open the list.');
    expect(tile).not.toHaveTextContent('—');
    expect(screen.getByRole('link', { name: /^Average review/ })).toHaveAttribute('aria-busy', 'true');
    await expectLoading('Loading the recent activity');
    await expectLoading('Loading the staff');
  });

  it('lists recent admin actions with who did what to whom', async () => {
    const activity = new FakeActivityService(
      new FakeLive([
        action('a1', { kind: 'create_staff', action: 'create_staff', targetUid: 'broker1', details: { role: 'broker', email: 'bob@test.com' } }),
        action('a2', { kind: 'change_role', action: 'change_role', targetUid: 'underwriter1', details: { from: 'broker', to: 'underwriter' } }),
        action('a3', { kind: 'delete_staff', action: 'delete_staff', targetUid: 'gone-1', details: { role: 'underwriter', fullName: 'Eve Long', email: 'eve@test.com' } }),
        action('a4', { kind: 'close_support_request', action: 'close_support_request', targetRef: 'SR-7KQ2M9XD' }),
      ]),
    );
    renderAdmin('/admin', { activity });
    const list = await screen.findByRole('list', { name: 'Recent admin actions' });
    const lines = within(list).getAllByRole('listitem').map((item) => item.querySelector('p')!.textContent);
    expect(lines).toEqual([
      'Ada Admin added Bob Murphy as a broker',
      'Ada Admin moved Uma Nolan from broker to underwriter',
      'Ada Admin deleted Eve Long, an underwriter',
      'Ada Admin resolved support request SR-7KQ2M9XD',
    ]);
    expect(within(list).getAllByText('5 minutes ago')).toHaveLength(4);
  });

  it('updates the activity as new actions arrive', async () => {
    const live = new FakeLive<AdminAction>([]);
    renderAdmin('/admin', { activity: new FakeActivityService(live) });
    expect(await screen.findByText(/No admin actions yet/)).toBeInTheDocument();
    live.emit([action('a1', { kind: 'disable_staff', action: 'disable_staff', targetUid: 'broker2' })]);
    expect(await screen.findByText('disabled Ciara Kelly', { exact: false })).toBeInTheDocument();
  });

  it('says when the activity log cannot be read', async () => {
    const live = new FakeLive<AdminAction>(null);
    renderAdmin('/admin', { activity: new FakeActivityService(live) });
    await screen.findByRole('heading', { name: 'Dashboard' });
    await waitFor(() => expect(live.active).toBe(1));
    live.fail('permission-denied');
    expect(await screen.findByRole('alert')).toHaveTextContent('This account is not allowed to read the recent activity.');
  });

  it('stops listening when the admin leaves the dashboard', async () => {
    const live = new FakeLive<AdminAction>([]);
    const { user } = renderAdmin('/admin', { activity: new FakeActivityService(live) });
    await screen.findByText(/No admin actions yet/);
    expect(live.active).toBe(1);
    await user.click(screen.getByRole('link', { name: 'Staff' }));
    await screen.findByRole('table', { name: 'Staff accounts' });
    expect(live.active).toBe(0);
  });
});
