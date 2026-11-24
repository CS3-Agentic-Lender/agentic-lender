import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from './services/apiClient';
import type { Review, SupportNote, SupportRequest } from './services/inboxService';
import { FakeInboxService, FakeLive, FakeUserDirectoryService, expectLoading, renderAdmin } from './test/adminHarness';
import { formatDate, formatDateTime } from './utils/formatters';

afterEach(cleanup);

function request(reference: string, overrides: Partial<SupportRequest> = {}): SupportRequest {
  return {
    reference,
    userId: 'borrower1',
    category: 'payment',
    subject: `Subject of ${reference}`,
    message: `Message of ${reference}`,
    applicationId: null,
    status: 'open',
    createdAt: new Date('2026-11-20T10:00:00Z'),
    closedAt: null,
    closedBy: null,
    resolution: null,
    ...overrides,
  };
}

function note(id: string, overrides: Partial<SupportNote> = {}): SupportNote {
  return { id, authorUid: 'admin1', text: `Text of ${id}`, createdAt: new Date('2026-11-22T10:00:00Z'), ...overrides };
}

function review(uid: string, rating: number | null, overrides: Partial<Review> = {}): Review {
  return {
    uid,
    rating,
    comment: null,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-20T10:00:00Z'),
    ...overrides,
  };
}

function inbox(requests: SupportRequest[] | null, reviews: Review[] | null = []) {
  return new FakeInboxService(new FakeLive(requests), new FakeLive(reviews));
}

// One request's card, found by its reference.
function card(reference: string) {
  return screen.getByRole('heading', { name: new RegExp(reference) }).closest('li')!;
}

async function requestList() {
  return screen.findByRole('list', { name: 'Support requests' });
}

function references(list: HTMLElement) {
  return within(list)
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent?.match(/SR-\S+/)?.[0]);
}

const CLOSED_EARLIER = request('SR-CLOSED', {
  status: 'closed',
  closedAt: new Date('2026-11-21T15:00:00Z'),
  closedBy: 'admin1',
  resolution: 'Refunded the second fee.',
});

// One request's notes thread.
function thread(reference: string) {
  return within(card(reference)).getByRole('region', { name: `Notes on ${reference}` });
}

describe('inbox tabs', () => {
  it('opens on support requests, reachable from the header', async () => {
    const { user } = renderAdmin('/admin');
    await user.click(await screen.findByRole('link', { name: 'Inbox' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Support requests/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: /Support requests/ })).toBeInTheDocument();
  });

  it('opens the reviews tab from ?tab=reviews and switches back', async () => {
    const { user } = renderAdmin('/admin/inbox?tab=reviews', { inbox: inbox([request('SR-1')], [review('borrower1', 4)]) });
    expect(await screen.findByRole('tab', { name: /Reviews/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: /Reviews/ })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Support requests/ }));
    expect(await requestList()).toBeInTheDocument();
    expect(screen.queryByRole('tabpanel', { name: /Reviews/ })).not.toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys', async () => {
    const { user } = renderAdmin('/admin/inbox');
    await user.click(await screen.findByRole('tab', { name: /Support requests/ }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Reviews/ })).toHaveFocus();
    expect(screen.getByRole('tab', { name: /Reviews/ })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('support requests', () => {
  it('lists open requests newest first with everything an admin needs to answer them', async () => {
    renderAdmin('/admin/inbox', {
      inbox: inbox([
        request('SR-NEW', {
          category: 'application',
          subject: 'Where is my valuation?',
          message: 'I sent the form a week ago.',
          applicationId: 'LN-1001',
          createdAt: new Date('2026-11-23T09:00:00Z'),
        }),
        request('SR-OLD', { userId: 'borrower2', createdAt: new Date('2026-11-02T09:00:00Z') }),
      ]),
    });
    expect(references(await requestList())).toEqual(['SR-NEW', 'SR-OLD']);
    const first = card('SR-NEW');
    expect(within(first).getByText('Application')).toBeInTheDocument();
    expect(within(first).getByText('Open')).toBeInTheDocument();
    expect(within(first).getByText('Where is my valuation?')).toBeInTheDocument();
    expect(within(first).getByText('I sent the form a week ago.')).toBeInTheDocument();
    expect(within(first).getByText('Alice Byrne')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'LN-1001' })).toHaveAttribute('href', '/admin/applications/LN-1001');
    expect(within(first).getByText(formatDate(new Date('2026-11-23T09:00:00Z')))).toBeInTheDocument();
    expect(within(card('SR-OLD')).getByText('Ben Walsh')).toBeInTheDocument();
    expect(within(card('SR-OLD')).getByText('No application linked')).toBeInTheDocument();
  });

  it('filters open and resolved requests, open by default, with a count beside each', async () => {
    const { user } = renderAdmin('/admin/inbox', { inbox: inbox([request('SR-A'), request('SR-B'), CLOSED_EARLIER]) });
    expect(references(await requestList())).toEqual(['SR-A', 'SR-B']);
    expect(screen.getByRole('radio', { name: 'Open 2' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Resolved 1' }));
    expect(references(await requestList())).toEqual(['SR-CLOSED']);
    const resolved = card('SR-CLOSED');
    expect(within(resolved).getByText('Resolved')).toBeInTheDocument();
    expect(within(resolved).getByText(`Resolved by Ada Admin, ${formatDateTime(CLOSED_EARLIER.closedAt)}`)).toBeInTheDocument();
    expect(within(resolved).getByText('Refunded the second fee.')).toBeInTheDocument();
    expect(within(resolved).queryByRole('button', { name: /Resolve/ })).not.toBeInTheDocument();
    expect(within(resolved).getByRole('button', { name: 'Reopen SR-CLOSED' })).toBeInTheDocument();
  });

  it('resolves a request with a note after confirming, without waiting for the live list', async () => {
    const fake = inbox([request('SR-A'), request('SR-B')]);
    const { user } = renderAdmin('/admin/inbox', { inbox: fake });
    await requestList();
    await user.click(within(card('SR-A')).getByRole('button', { name: 'Resolve SR-A' }));
    const dialog = screen.getByRole('dialog', { name: 'Resolve SR-A?' });
    expect(fake.closed).toEqual([]);
    await user.type(within(dialog).getByLabelText(/Resolution note/), 'Refunded the second fee.');
    await user.click(within(dialog).getByRole('button', { name: 'Resolve' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fake.closed).toEqual([{ reference: 'SR-A', resolution: 'Refunded the second fee.' }]);
    expect(await screen.findByText('SR-A is resolved.')).toBeInTheDocument();
    expect(references(await requestList())).toEqual(['SR-B']);
    await user.click(screen.getByRole('radio', { name: 'Resolved 1' }));
    expect(within(card('SR-A')).getByText(`Resolved by Ada Admin, ${formatDateTime(fake.closedAt)}`)).toBeInTheDocument();
    expect(within(card('SR-A')).getByText('Refunded the second fee.')).toBeInTheDocument();
    expect(within(card('SR-A')).getByText('Alice Byrne')).toBeInTheDocument();
  });

  it('resolves a request without a note', async () => {
    const fake = inbox([request('SR-A')]);
    const { user } = renderAdmin('/admin/inbox', { inbox: fake });
    await requestList();
    await user.click(screen.getByRole('button', { name: 'Resolve SR-A' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The Resolve button left the Open list with the request, so focus goes to the page heading.
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    await user.click(screen.getByRole('radio', { name: 'Resolved 1' }));
    expect(within(card('SR-A')).queryByText('Resolution')).not.toBeInTheDocument();
  });

  it('leaves a request open when the admin cancels', async () => {
    const fake = inbox([request('SR-A')]);
    const { user } = renderAdmin('/admin/inbox', { inbox: fake });
    await requestList();
    await user.click(screen.getByRole('button', { name: 'Resolve SR-A' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fake.closed).toEqual([]);
    expect(references(await requestList())).toEqual(['SR-A']);
  });

  it('moves a request to Resolved when the live list says another admin resolved it', async () => {
    const fake = inbox([request('SR-A'), request('SR-B')]);
    renderAdmin('/admin/inbox', { inbox: fake });
    await requestList();
    fake.requests.emit([{ ...request('SR-A'), status: 'closed', closedAt: new Date(), closedBy: 'admin1' }, request('SR-B')]);
    await waitFor(async () => expect(references(await requestList())).toEqual(['SR-B']));
    expect(screen.getByRole('radio', { name: 'Resolved 1' })).toBeInTheDocument();
  });

  it('shows a refused resolve in the API’s own words and keeps the request open', async () => {
    const fake = inbox([request('SR-A')]);
    fake.closeError = new ApiError('http', 'No support request with reference SR-A', 404);
    const { user } = renderAdmin('/admin/inbox', { inbox: fake });
    await requestList();
    await user.click(screen.getByRole('button', { name: 'Resolve SR-A' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Resolution note/), 'Kept');
    await user.click(within(dialog).getByRole('button', { name: 'Resolve' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No support request with reference SR-A');
    expect(within(dialog).getByRole('button', { name: 'Resolve' })).toBeEnabled();
    expect(within(dialog).getByLabelText(/Resolution note/)).toHaveValue('Kept');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(within(card('SR-A')).getByText('Open')).toBeInTheDocument();
  });

  it('reopens a resolved request, which moves back to Open without its resolution', async () => {
    const fake = inbox([request('SR-A'), CLOSED_EARLIER]);
    const { user } = renderAdmin('/admin/inbox', { inbox: fake });
    await requestList();
    await user.click(screen.getByRole('radio', { name: 'Resolved 1' }));
    await user.click(within(card('SR-CLOSED')).getByRole('button', { name: 'Reopen SR-CLOSED' }));
    expect(await screen.findByText('SR-CLOSED is open again.')).toBeInTheDocument();
    expect(fake.reopened).toEqual(['SR-CLOSED']);
    // The Reopen button left with the request, so focus goes to the page heading rather than the body.
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus());
    expect(screen.getByRole('radio', { name: 'Resolved 0' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Open 2' }));
    expect(references(await requestList())).toEqual(['SR-A', 'SR-CLOSED']);
    expect(within(card('SR-CLOSED')).queryByText('Refunded the second fee.')).not.toBeInTheDocument();
    expect(within(card('SR-CLOSED')).getByRole('button', { name: 'Resolve SR-CLOSED' })).toBeInTheDocument();
  });

  it('shows a refused reopen in the API’s own words and keeps the request resolved', async () => {
    const fake = inbox([CLOSED_EARLIER]);
    fake.reopenError = new ApiError('http', 'The support request changed while this request was running', 409);
    const { user } = renderAdmin('/admin/inbox', { inbox: fake });
    await user.click(await screen.findByRole('radio', { name: 'Resolved 1' }));
    await user.click(screen.getByRole('button', { name: 'Reopen SR-CLOSED' }));
    expect(await screen.findByText('The support request changed while this request was running')).toBeInTheDocument();
    expect(within(card('SR-CLOSED')).getByText('Resolved')).toBeInTheDocument();
  });

  it('says plainly when a sender cannot be named', async () => {
    renderAdmin('/admin/inbox', {
      inbox: inbox([request('SR-A', { userId: 'gone-1' }), request('SR-B', { userId: null })]),
    });
    await requestList();
    expect(within(card('SR-A')).getByText('Name not found (gone-1)')).toBeInTheDocument();
    expect(within(card('SR-B')).getByText('Sender not recorded')).toBeInTheDocument();
  });

  it('says when the users directory cannot be read instead of showing a blank name', async () => {
    const users = new FakeUserDirectoryService(new FakeLive(null));
    renderAdmin('/admin/inbox', { inbox: inbox([request('SR-A')]), users });
    await requestList();
    expect(within(card('SR-A')).getByText('Loading name…')).toBeInTheDocument();
    users.live.fail('permission-denied');
    expect(await within(card('SR-A')).findByText('Name unavailable')).toBeInTheDocument();
  });

  it('says when there are no requests, and when none are open', async () => {
    renderAdmin('/admin/inbox', { inbox: inbox([]) });
    expect(await screen.findByText('No support requests yet')).toBeInTheDocument();
    cleanup();
    renderAdmin('/admin/inbox', { inbox: inbox([CLOSED_EARLIER]) });
    expect(await screen.findByText('No open requests')).toBeInTheDocument();
  });

  it('shows loading, then the error when the list cannot be read', async () => {
    const fake = inbox(null);
    renderAdmin('/admin/inbox', { inbox: fake });
    await expectLoading('Loading the support requests');
    fake.requests.fail('unavailable');
    expect(await screen.findByRole('alert')).toHaveTextContent('The support requests could not be loaded');
  });
});

describe('support request notes', () => {
  it('shows each note oldest first, with its author and time', async () => {
    const fake = inbox([request('SR-A')]);
    fake.notesOf('SR-A').items = [
      note('n1', { text: 'Asked finance', createdAt: new Date('2026-11-22T09:00:00Z') }),
      note('n2', { authorUid: 'underwriter1', text: 'Second look', createdAt: new Date('2026-11-23T09:00:00Z') }),
    ];
    renderAdmin('/admin/inbox', { inbox: fake });
    await requestList();
    const items = await within(thread('SR-A')).findAllByRole('listitem');
    expect(items.map((item) => within(item).getByText(/Asked finance|Second look/).textContent)).toEqual([
      'Asked finance',
      'Second look',
    ]);
    expect(within(items[0]).getByText('Ada Admin')).toBeInTheDocument();
    expect(within(items[0]).getByText(formatDateTime(new Date('2026-11-22T09:00:00Z')))).toBeInTheDocument();
    expect(within(items[1]).getByText('Uma Nolan')).toBeInTheDocument();
  });

  it('says when a request has no notes yet', async () => {
    renderAdmin('/admin/inbox', { inbox: inbox([request('SR-A')]) });
    await requestList();
    expect(await within(thread('SR-A')).findByText('No notes yet.')).toBeInTheDocument();
  });

  it('adds a note, shows it at once and clears the box', async () => {
    const fake = inbox([request('SR-A')]);
    const { user } = renderAdmin('/admin/inbox', { inbox: fake });
    await requestList();
    const box = within(thread('SR-A')).getByLabelText('Add a note');
    const add = within(thread('SR-A')).getByRole('button', { name: 'Add note' });
    expect(add).toBeDisabled();
    await user.type(box, 'Called the borrower');
    await user.click(add);
    expect(fake.added).toEqual([{ reference: 'SR-A', text: 'Called the borrower' }]);
    expect(await within(thread('SR-A')).findByText('Called the borrower')).toBeInTheDocument();
    expect(box).toHaveValue('');
  });

  it('shows a note once when the live list also reports it', async () => {
    const fake = inbox([request('SR-A')]);
    const { user } = renderAdmin('/admin/inbox', { inbox: fake });
    await requestList();
    await user.type(within(thread('SR-A')).getByLabelText('Add a note'), 'Only once');
    await user.click(within(thread('SR-A')).getByRole('button', { name: 'Add note' }));
    await within(thread('SR-A')).findByText('Only once');
    fake.notesOf('SR-A').emit([note('note-1', { text: 'Only once', createdAt: fake.closedAt })]);
    await waitFor(() => expect(within(thread('SR-A')).getAllByRole('listitem')).toHaveLength(1));
  });

  it('shows a note another admin adds', async () => {
    const fake = inbox([request('SR-A')]);
    renderAdmin('/admin/inbox', { inbox: fake });
    await requestList();
    fake.notesOf('SR-A').emit([note('n9', { authorUid: 'underwriter1', text: 'From elsewhere' })]);
    expect(await within(thread('SR-A')).findByText('From elsewhere')).toBeInTheDocument();
  });

  it('keeps the draft and says why when a note is refused', async () => {
    const fake = inbox([request('SR-A')]);
    fake.noteError = new ApiError('http', 'No support request with reference SR-A', 404);
    const { user } = renderAdmin('/admin/inbox', { inbox: fake });
    await requestList();
    const box = within(thread('SR-A')).getByLabelText('Add a note');
    await user.type(box, 'Lost?');
    await user.click(within(thread('SR-A')).getByRole('button', { name: 'Add note' }));
    expect(await within(thread('SR-A')).findByRole('alert')).toHaveTextContent('No support request with reference SR-A');
    expect(box).toHaveValue('Lost?');
  });

  it('shows a resolved request’s notes but no box to add one, until it is reopened', async () => {
    const fake = inbox([CLOSED_EARLIER]);
    fake.notesOf('SR-CLOSED').items = [note('n1', { text: 'Asked finance' })];
    const { user } = renderAdmin('/admin/inbox', { inbox: fake });
    await user.click(await screen.findByRole('radio', { name: 'Resolved 1' }));
    expect(await within(thread('SR-CLOSED')).findByText('Asked finance')).toBeInTheDocument();
    expect(within(thread('SR-CLOSED')).getByText('Resolved. Reopen to add a note.')).toBeInTheDocument();
    expect(within(thread('SR-CLOSED')).queryByLabelText('Add a note')).not.toBeInTheDocument();
    expect(within(thread('SR-CLOSED')).queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();

    await user.click(within(card('SR-CLOSED')).getByRole('button', { name: 'Reopen SR-CLOSED' }));
    await user.click(await screen.findByRole('radio', { name: 'Open 1' }));
    expect(await within(thread('SR-CLOSED')).findByLabelText('Add a note')).toBeInTheDocument();
    expect(within(thread('SR-CLOSED')).queryByText('Resolved. Reopen to add a note.')).not.toBeInTheDocument();
  });

  it('shows the API’s refusal when the request was resolved while the note was being written', async () => {
    const fake = inbox([request('SR-A')]);
    fake.noteError = new ApiError('http', 'This request is resolved. Reopen it to add a note.', 409);
    const { user } = renderAdmin('/admin/inbox', { inbox: fake });
    await requestList();
    await user.type(within(thread('SR-A')).getByLabelText('Add a note'), 'Too late');
    await user.click(within(thread('SR-A')).getByRole('button', { name: 'Add note' }));
    expect(await within(thread('SR-A')).findByRole('alert')).toHaveTextContent(
      'This request is resolved. Reopen it to add a note.',
    );
  });

  it('says when the notes cannot be read', async () => {
    const fake = inbox([request('SR-A')]);
    renderAdmin('/admin/inbox', { inbox: fake });
    await requestList();
    fake.notesOf('SR-A').fail('permission-denied');
    expect(await within(thread('SR-A')).findByText('The notes could not be loaded.')).toBeInTheDocument();
  });
});

describe('reviews', () => {
  it('lists reviews newest first with stars, comment, name and date', async () => {
    renderAdmin('/admin/inbox?tab=reviews', {
      inbox: inbox(
        [],
        [
          review('borrower2', 4, { comment: 'Quick and clear.', updatedAt: new Date('2026-11-22T10:00:00Z') }),
          review('borrower1', 2, { updatedAt: new Date('2026-11-10T10:00:00Z') }),
        ],
      ),
    });
    const list = await screen.findByRole('list', { name: 'Reviews' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument();
    expect(within(items[0]).getByText('Quick and clear.')).toBeInTheDocument();
    expect(within(items[0]).getByText('Ben Walsh')).toBeInTheDocument();
    expect(within(items[0]).getByText(formatDate(new Date('2026-11-22T10:00:00Z')))).toBeInTheDocument();
    expect(within(items[1]).getByRole('img', { name: '2 out of 5 stars' })).toBeInTheDocument();
    expect(within(items[1]).getByText('No comment')).toBeInTheDocument();
    expect(within(items[1]).getByText('Alice Byrne')).toBeInTheDocument();
  });

  it('shows the average, the count and how many reviews gave each star', async () => {
    renderAdmin('/admin/inbox?tab=reviews', {
      inbox: inbox([], [review('borrower1', 5), review('borrower2', 4), review('ghost-1', 5), review('ghost-2', null)]),
    });
    const summary = await screen.findByRole('region', { name: 'Rating summary' });
    expect(within(summary).getByText('4.7')).toBeInTheDocument();
    expect(within(summary).getByText('Out of 5, from 4 reviews.')).toBeInTheDocument();
    const rows = within(within(summary).getByRole('list', { name: 'Reviews by star rating' })).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(['5 stars2', '4 stars1', '3 stars0', '2 stars0', '1 star0']);
    expect(screen.getByText('Name not found (ghost-1)')).toBeInTheDocument();
    expect(screen.getByText('Rating unreadable')).toBeInTheDocument();
  });

  it('says when there are no reviews yet', async () => {
    renderAdmin('/admin/inbox?tab=reviews', { inbox: inbox([], []) });
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument();
  });

  it('shows loading, then the error when reviews cannot be read', async () => {
    const fake = inbox([], null);
    renderAdmin('/admin/inbox?tab=reviews', { inbox: fake });
    await expectLoading('Loading the reviews');
    fake.reviews.fail('permission-denied');
    expect(await screen.findByRole('alert')).toHaveTextContent('This account is not allowed to read the reviews.');
  });
});
