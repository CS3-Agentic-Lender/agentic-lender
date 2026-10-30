import { doc, onSnapshot } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firestoreLoanFileService } from './loanFileService';

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  onSnapshot: vi.fn(),
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ kind: 'doc', path: segments.join('/') })),
}));

interface FakeDocumentSnapshot {
  id: string;
  exists: () => boolean;
  data: () => Record<string, unknown> | undefined;
  metadata: { fromCache: boolean };
}

function documentOf(id: string, data: Record<string, unknown> | undefined, fromCache = false): FakeDocumentSnapshot {
  return { id, exists: () => data !== undefined, data: () => data, metadata: { fromCache } };
}

function subscribe(applicationId = 'LN-1001') {
  const listener = vi.fn();
  const onError = vi.fn();
  const unsubscribeApplication = vi.fn();
  const unsubscribeReview = vi.fn();
  vi.mocked(onSnapshot).mockReturnValueOnce(unsubscribeApplication).mockReturnValueOnce(unsubscribeReview);
  const stop = firestoreLoanFileService.subscribeToLoanFile(applicationId, listener, onError);
  const calls = vi.mocked(onSnapshot).mock.calls as unknown as unknown[][];
  const [applicationCall, reviewCall] = calls.map((call) => {
    const callbacks = call.filter((argument) => typeof argument === 'function');

    return {
      ref: call[0],
      options: call[1],
      next: callbacks[0] as (snapshot: FakeDocumentSnapshot) => void,
      error: callbacks[1] as (error: { code: string }) => void,
    };
  });

  return { listener, onError, stop, unsubscribeApplication, unsubscribeReview, applicationCall, reviewCall };
}

beforeEach(() => {
  vi.mocked(onSnapshot).mockReset();
  vi.mocked(doc).mockClear();
});

describe('loan file listeners', () => {
  it('listens to the application and its underwriting review, with metadata changes', () => {
    const { applicationCall, reviewCall } = subscribe();

    expect(applicationCall.ref).toEqual({ kind: 'doc', path: 'applications/LN-1001' });
    expect(reviewCall.ref).toEqual({ kind: 'doc', path: 'applications/LN-1001/review/underwriting' });
    expect(applicationCall.options).toEqual({ includeMetadataChanges: true });
    expect(reviewCall.options).toEqual({ includeMetadataChanges: true });
  });

  it('publishes the application before the review answers, with the review pending', () => {
    const { listener, applicationCall } = subscribe();
    applicationCall.next(documentOf('LN-1001', { status: 'Applied', dtiPct: 33.4 }));

    expect(listener).toHaveBeenLastCalledWith({
      status: 'ready',
      application: expect.objectContaining({ id: 'LN-1001', dtiPct: 33.4 }),
      review: { state: 'pending' },
    });
  });

  it('adds the review when it answers', () => {
    const { listener, applicationCall, reviewCall } = subscribe();
    reviewCall.next(documentOf('underwriting', { dtiBreakdown: { incomeMonthlyEur: 6250 } }));
    expect(listener).not.toHaveBeenCalled();
    applicationCall.next(documentOf('LN-1001', { status: 'Applied' }));

    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        review: expect.objectContaining({
          state: 'available',
          dtiBreakdown: expect.objectContaining({ incomeMonthlyEur: 6250 }),
        }),
      }),
    );
  });

  it('does not say "not found" from an empty cache, only once the server answers', () => {
    const { listener, applicationCall } = subscribe();
    applicationCall.next(documentOf('LN-1001', undefined, true));
    expect(listener).not.toHaveBeenCalled();
    applicationCall.next(documentOf('LN-1001', undefined, false));
    expect(listener).toHaveBeenLastCalledWith({ status: 'not-found' });
  });

  it('does not say the review is absent from an empty cache', () => {
    const { listener, applicationCall, reviewCall } = subscribe();
    applicationCall.next(documentOf('LN-1001', { status: 'Applied' }));
    reviewCall.next(documentOf('underwriting', undefined, true));
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ review: { state: 'pending' } }));
    reviewCall.next(documentOf('underwriting', undefined, false));
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ review: { state: 'absent' } }));
  });

  it('reports a refused application as forbidden and stops both listeners', () => {
    const { onError, applicationCall, unsubscribeApplication, unsubscribeReview } = subscribe();
    applicationCall.error({ code: 'permission-denied' });

    expect(onError).toHaveBeenCalledWith('forbidden');
    expect(unsubscribeApplication).toHaveBeenCalledOnce();
    expect(unsubscribeReview).toHaveBeenCalledOnce();
  });

  it('reports any other failure as unavailable', () => {
    const { onError, applicationCall } = subscribe();
    applicationCall.error({ code: 'unavailable' });
    expect(onError).toHaveBeenCalledWith('unavailable');
  });

  it('keeps the application when only the review is refused', () => {
    const { listener, onError, applicationCall, reviewCall } = subscribe();
    applicationCall.next(documentOf('LN-1001', { status: 'Applied' }));
    reviewCall.error({ code: 'permission-denied' });

    expect(onError).not.toHaveBeenCalled();
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready', review: { state: 'unavailable' } }));
  });

  it('stops both listeners and publishes nothing more once stopped', () => {
    const { listener, stop, applicationCall, unsubscribeApplication, unsubscribeReview } = subscribe();
    stop();
    stop();
    applicationCall.next(documentOf('LN-1001', { status: 'Applied' }));

    expect(unsubscribeApplication).toHaveBeenCalledOnce();
    expect(unsubscribeReview).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });

  it('answers "not found" for an ID that cannot be a document, without reading anything', () => {
    const listener = vi.fn();
    firestoreLoanFileService.subscribeToLoanFile('LN-1/review/underwriting', listener, vi.fn());

    expect(listener).toHaveBeenCalledWith({ status: 'not-found' });
    expect(onSnapshot).not.toHaveBeenCalled();
  });
});
