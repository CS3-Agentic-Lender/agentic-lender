import { collection, type DocumentData } from 'firebase/firestore';
import { ApiError, createApiClient, type ApiClient } from './apiClient';
import { readDate, readString } from './clientsService';
import { db } from './firebase';
import { subscribeToCollection, type LiveErrorListener, type LiveListener } from './liveCollection';

export type SupportStatus = 'open' | 'closed';

// support_requests/{reference} (al-core/SCHEMA.md), sent by a borrower from the app.
export interface SupportRequest {
  reference: string;
  userId: string | null;
  category: string | null;
  subject: string | null;
  message: string | null;
  applicationId: string | null;
  status: SupportStatus;
  createdAt: Date | null;
  closedAt: Date | null;
  closedBy: string | null;
  // The note the admin resolved it with, if any.
  resolution: string | null;
}

// support_requests/{reference}/notes/{id}: a staff comment. Only admins read these, never the sender.
export interface SupportNote {
  id: string;
  authorUid: string | null;
  text: string | null;
  createdAt: Date | null;
}

// reviews/{uid}: one per borrower, replaced when they review again.
export interface Review {
  uid: string;
  rating: number | null;
  comment: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface InboxService {
  subscribeToSupportRequests(listener: LiveListener<SupportRequest>, onError: LiveErrorListener): () => void;
  subscribeToReviews(listener: LiveListener<Review>, onError: LiveErrorListener): () => void;
  subscribeToSupportNotes(reference: string, listener: LiveListener<SupportNote>, onError: LiveErrorListener): () => void;
  // Closing a closed request, or reopening an open one, answers it unchanged. A blank resolution is none.
  closeSupportRequest(reference: string, resolution?: string): Promise<SupportRequest>;
  reopenSupportRequest(reference: string): Promise<SupportRequest>;
  addSupportNote(reference: string, text: string): Promise<SupportNote>;
}

export function toSupportRequest(reference: string, data: DocumentData): SupportRequest {
  return {
    reference,
    userId: readString(data.userId),
    category: readString(data.category),
    subject: readString(data.subject),
    message: readString(data.message),
    applicationId: readString(data.applicationId),
    // Only al-core writes the status, and only `open` or `closed`; a closed request always carries closedAt.
    status: data.status === 'closed' ? 'closed' : 'open',
    createdAt: readDate(data.createdAt),
    closedAt: readDate(data.closedAt),
    closedBy: readString(data.closedBy),
    resolution: readString(data.resolution),
  };
}

export function toSupportNote(id: string, data: DocumentData): SupportNote {
  return {
    id,
    authorUid: readString(data.authorUid),
    text: readString(data.text),
    createdAt: readDate(data.createdAt),
  };
}

export function toReview(uid: string, data: DocumentData): Review {
  const rating = data.rating;

  return {
    uid,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    comment: readString(data.comment),
    createdAt: readDate(data.createdAt),
    updatedAt: readDate(data.updatedAt) ?? readDate(data.createdAt),
  };
}

function isoDate(value: unknown) {
  const text = readString(value);
  const date = text ? new Date(text) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

// The close and reopen endpoints' snake_case answer. It names no sender, so userId is null: keep the listed one.
export function toAnsweredSupportRequest(raw: unknown): SupportRequest | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const reference = readString(record.reference);

  if (!reference) {
    return null;
  }

  return {
    reference,
    userId: null,
    category: readString(record.category),
    subject: readString(record.subject),
    message: readString(record.message),
    applicationId: readString(record.application_id),
    status: record.status === 'closed' ? 'closed' : 'open',
    createdAt: isoDate(record.created_at),
    closedAt: isoDate(record.closed_at),
    closedBy: readString(record.closed_by),
    resolution: readString(record.resolution),
  };
}

// The notes endpoint's answer: the saved note.
export function toAnsweredSupportNote(raw: unknown): SupportNote | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const id = readString(record.id);

  return id
    ? { id, authorUid: readString(record.author_uid), text: readString(record.text), createdAt: isoDate(record.created_at) }
    : null;
}

export function oldestNoteFirst(a: SupportNote, b: SupportNote) {
  return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) || a.id.localeCompare(b.id);
}

const UNREADABLE = 'The server returned an unreadable answer. Reload the page to see the request.';

function newest(a: Date | null, b: Date | null) {
  return (b?.getTime() ?? 0) - (a?.getTime() ?? 0);
}

export function newestRequestFirst(a: SupportRequest, b: SupportRequest) {
  return newest(a.createdAt, b.createdAt) || a.reference.localeCompare(b.reference);
}

export function newestReviewFirst(a: Review, b: Review) {
  return newest(a.updatedAt, b.updatedAt) || a.uid.localeCompare(b.uid);
}

export interface InboxSummary {
  open: number;
  closed: number;
  reviews: number;
  // Of the reviews with a readable rating; null when there are none.
  averageRating: number | null;
}

export function inboxSummary(requests: readonly SupportRequest[], reviews: readonly Review[]): InboxSummary {
  const ratings = reviews.map((review) => review.rating).filter((rating) => rating !== null);
  const open = requests.filter((request) => request.status === 'open').length;

  return {
    open,
    closed: requests.length - open,
    reviews: reviews.length,
    averageRating: ratings.length === 0 ? null : ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length,
  };
}

// Both collections are small (one review per borrower, a few requests each), so each is read whole and
// sorted here: the inbox counts open and closed together, and no composite index is needed.
export function createInboxService(client: ApiClient = createApiClient()): InboxService {
  return {
    subscribeToSupportRequests(listener, onError) {
      return subscribeToCollection(
        collection(db, 'support_requests'),
        toSupportRequest,
        (requests) => listener(requests.sort(newestRequestFirst)),
        onError,
      );
    },

    subscribeToReviews(listener, onError) {
      return subscribeToCollection(
        collection(db, 'reviews'),
        toReview,
        (reviews) => listener(reviews.sort(newestReviewFirst)),
        onError,
      );
    },

    subscribeToSupportNotes(reference, listener, onError) {
      return subscribeToCollection(
        collection(db, 'support_requests', reference, 'notes'),
        toSupportNote,
        (notes) => listener(notes.sort(oldestNoteFirst)),
        onError,
      );
    },

    async closeSupportRequest(reference, resolution) {
      const note = resolution?.trim();
      const body = await client.request<unknown>(
        `/core/admin/support-requests/${encodeURIComponent(reference)}/close`,
        note ? { method: 'POST', body: { resolution: note } } : { method: 'POST' },
      );
      const closed = toAnsweredSupportRequest(body);

      if (!closed) {
        throw new ApiError('response', UNREADABLE);
      }

      return closed;
    },

    async reopenSupportRequest(reference) {
      const body = await client.request<unknown>(
        `/core/admin/support-requests/${encodeURIComponent(reference)}/reopen`,
        { method: 'POST' },
      );
      const reopened = toAnsweredSupportRequest(body);

      if (!reopened) {
        throw new ApiError('response', UNREADABLE);
      }

      return reopened;
    },

    async addSupportNote(reference, text) {
      const body = await client.request<unknown>(
        `/core/admin/support-requests/${encodeURIComponent(reference)}/notes`,
        { method: 'POST', body: { text: text.trim() } },
      );
      const note = toAnsweredSupportNote(body);

      if (!note) {
        throw new ApiError('response', 'The note was saved, but the answer was unreadable. Reload the page to see it.');
      }

      return note;
    },
  };
}
