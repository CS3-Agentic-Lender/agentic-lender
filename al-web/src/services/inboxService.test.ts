import { Timestamp, collection, onSnapshot } from 'firebase/firestore';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient, type JsonRequest } from './apiClient';
import { createInboxService } from './inboxService';

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  onSnapshot: vi.fn(),
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({ kind: 'collection', path: segments.join('/') })),
}));

afterEach(() => vi.mocked(onSnapshot).mockReset());

function client(answer: unknown) {
  const calls: Array<{ path: string; request: JsonRequest }> = [];
  const api: ApiClient = {
    async request<T>(path: string, request: JsonRequest) {
      calls.push({ path, request });
      if (answer instanceof Error) throw answer;
      return answer as T;
    },
  };
  return { api, calls };
}

// Delivers one server snapshot of `docs` to the listener the service subscribes with.
function deliver(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  const call = vi.mocked(onSnapshot).mock.calls[0] as unknown as unknown[];
  const next = call.find((argument) => typeof argument === 'function') as (snapshot: unknown) => void;
  next({
    docs: docs.map((doc) => ({ id: doc.id, data: () => doc.data })),
    empty: docs.length === 0,
    metadata: { fromCache: false },
  });
}

const at = (iso: string) => Timestamp.fromDate(new Date(iso));

describe('inbox lists', () => {
  it('delivers support requests newest first', () => {
    vi.mocked(onSnapshot).mockReturnValue(vi.fn());
    const listener = vi.fn();
    createInboxService(client(null).api).subscribeToSupportRequests(listener, vi.fn());
    deliver([
      { id: 'SR-OLD', data: { status: 'open', createdAt: at('2026-11-01T09:00:00Z') } },
      { id: 'SR-NEW', data: { status: 'closed', createdAt: at('2026-11-22T09:00:00Z') } },
      { id: 'SR-MID', data: { status: 'open', createdAt: at('2026-11-10T09:00:00Z') } },
    ]);
    expect(listener.mock.calls[0][0].map((request: { reference: string }) => request.reference)).toEqual([
      'SR-NEW',
      'SR-MID',
      'SR-OLD',
    ]);
  });

  it('delivers reviews newest first by when they were last saved', () => {
    vi.mocked(onSnapshot).mockReturnValue(vi.fn());
    const listener = vi.fn();
    createInboxService(client(null).api).subscribeToReviews(listener, vi.fn());
    deliver([
      { id: 'early', data: { rating: 3, createdAt: at('2026-11-01T09:00:00Z'), updatedAt: at('2026-11-02T09:00:00Z') } },
      // Reviewed first, but edited last, so it leads.
      { id: 'edited', data: { rating: 5, createdAt: at('2026-10-01T09:00:00Z'), updatedAt: at('2026-11-23T09:00:00Z') } },
      { id: 'middle', data: { rating: 4, createdAt: at('2026-11-12T09:00:00Z') } },
    ]);
    expect(listener.mock.calls[0][0].map((review: { uid: string }) => review.uid)).toEqual(['edited', 'middle', 'early']);
  });
});

describe('closing a support request', () => {
  const CLOSED = {
    reference: 'SR-7KQ2M9XD',
    category: 'payment',
    subject: 'Fee question',
    message: 'Was I charged twice?',
    application_id: 'LN-1001',
    status: 'closed',
    created_at: '2026-11-20T10:00:00+00:00',
    closed_at: '2026-11-24T12:30:00+00:00',
    closed_by: 'admin1',
    resolution: null,
  };

  it('posts to the close endpoint with no body and reads the closed request back', async () => {
    const { api, calls } = client(CLOSED);
    const closed = await createInboxService(api).closeSupportRequest('SR-7KQ2M9XD');
    expect(calls).toEqual([{ path: '/core/admin/support-requests/SR-7KQ2M9XD/close', request: { method: 'POST' } }]);
    expect(closed).toEqual({
      reference: 'SR-7KQ2M9XD',
      userId: null,
      category: 'payment',
      subject: 'Fee question',
      message: 'Was I charged twice?',
      applicationId: 'LN-1001',
      status: 'closed',
      createdAt: new Date('2026-11-20T10:00:00Z'),
      closedAt: new Date('2026-11-24T12:30:00Z'),
      closedBy: 'admin1',
      resolution: null,
    });
  });

  it('sends a resolution note when there is one, and reads it back', async () => {
    const { api, calls } = client({ ...CLOSED, resolution: 'Refunded the second fee.' });
    const closed = await createInboxService(api).closeSupportRequest('SR-7KQ2M9XD', '  Refunded the second fee.  ');
    expect(calls).toEqual([
      {
        path: '/core/admin/support-requests/SR-7KQ2M9XD/close',
        request: { method: 'POST', body: { resolution: 'Refunded the second fee.' } },
      },
    ]);
    expect(closed.resolution).toBe('Refunded the second fee.');
  });

  it('sends no body for a blank resolution note', async () => {
    const { api, calls } = client(CLOSED);
    await createInboxService(api).closeSupportRequest('SR-7KQ2M9XD', '   ');
    expect(calls[0].request).toEqual({ method: 'POST' });
  });

  it('passes a refusal through with the API message', async () => {
    const refusal = new ApiError('http', 'No support request with reference SR-NOPE', 404);
    await expect(createInboxService(client(refusal).api).closeSupportRequest('SR-NOPE')).rejects.toBe(refusal);
  });

  it('refuses an answer it cannot read', async () => {
    await expect(createInboxService(client({ status: 'closed' }).api).closeSupportRequest('SR-1')).rejects.toMatchObject({
      kind: 'response',
    });
  });
});

describe('reopening a support request', () => {
  it('posts to the reopen endpoint and reads the open request back', async () => {
    const { api, calls } = client({
      reference: 'SR-1',
      category: 'other',
      subject: 'Hi',
      message: 'Hello',
      application_id: null,
      status: 'open',
      created_at: '2026-11-20T10:00:00+00:00',
      closed_at: null,
      closed_by: null,
      resolution: null,
    });
    const reopened = await createInboxService(api).reopenSupportRequest('SR-1');
    expect(calls).toEqual([{ path: '/core/admin/support-requests/SR-1/reopen', request: { method: 'POST' } }]);
    expect(reopened).toMatchObject({ reference: 'SR-1', status: 'open', closedAt: null, closedBy: null, resolution: null });
  });

  it('refuses an answer it cannot read', async () => {
    await expect(createInboxService(client(null).api).reopenSupportRequest('SR-1')).rejects.toMatchObject({
      kind: 'response',
    });
  });
});

describe('support request notes', () => {
  it('reads the notes of one request, oldest first', () => {
    vi.mocked(onSnapshot).mockReturnValue(vi.fn());
    const listener = vi.fn();
    createInboxService(client(null).api).subscribeToSupportNotes('SR-1', listener, vi.fn());
    expect(vi.mocked(collection).mock.calls.at(-1)?.slice(1)).toEqual(['support_requests', 'SR-1', 'notes']);
    deliver([
      { id: 'n2', data: { authorUid: 'admin2', text: 'Second', createdAt: at('2026-11-24T12:00:00Z') } },
      { id: 'n1', data: { authorUid: 'admin1', text: 'First', createdAt: at('2026-11-24T09:00:00Z') } },
    ]);
    expect(listener.mock.calls[0][0]).toEqual([
      { id: 'n1', authorUid: 'admin1', text: 'First', createdAt: new Date('2026-11-24T09:00:00Z') },
      { id: 'n2', authorUid: 'admin2', text: 'Second', createdAt: new Date('2026-11-24T12:00:00Z') },
    ]);
  });

  it('posts a trimmed note and reads the saved one back', async () => {
    const { api, calls } = client({ id: 'n1', author_uid: 'admin1', text: 'Called them', created_at: '2026-11-24T12:30:00+00:00' });
    const note = await createInboxService(api).addSupportNote('SR-1', '  Called them  ');
    expect(calls).toEqual([
      { path: '/core/admin/support-requests/SR-1/notes', request: { method: 'POST', body: { text: 'Called them' } } },
    ]);
    expect(note).toEqual({ id: 'n1', authorUid: 'admin1', text: 'Called them', createdAt: new Date('2026-11-24T12:30:00Z') });
  });

  it('refuses a saved note it cannot read', async () => {
    await expect(createInboxService(client({ text: 'x' }).api).addSupportNote('SR-1', 'x')).rejects.toMatchObject({
      kind: 'response',
    });
  });
});
