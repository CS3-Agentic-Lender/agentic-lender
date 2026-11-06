import { collection, doc, onSnapshot, orderBy, query, type DocumentData } from 'firebase/firestore';
import { createApiClient, type ApiClient } from './apiClient';
import { readDate, readString } from './clientsService';
import { db } from './firebase';

// One thread per application: applications/{id}/messages (al-core SCHEMA.md). The apps read it
// straight from Firestore; every write goes through al-core, which sets the sender and the time.
export const SENDER_ROLES = ['borrower', 'broker', 'underwriter'] as const;
export type SenderRole = (typeof SENDER_ROLES)[number];

export interface ThreadMessage {
  id: string;
  senderId: string | null;
  senderRole: SenderRole | null;
  text: string;
  sentAt: Date | null;
}

export interface ThreadSnapshot {
  // Oldest first.
  messages: ThreadMessage[];
  // The caller's own readState: null until they first open the thread.
  lastReadAt: Date | null;
}

export type ThreadError = 'permission-denied' | 'unavailable';

export interface MessagesService {
  subscribeToThread(
    applicationId: string,
    uid: string,
    listener: (snapshot: ThreadSnapshot) => void,
    onError: (error: ThreadError) => void,
  ): () => void;
  send(applicationId: string, text: string): Promise<void>;
  markRead(applicationId: string): Promise<void>;
}

// The sender's role as the other side sees it. The role comes from the stored message, which the
// API sets from the sender's token, never from anything typed in the portal.
export const senderLabels: Record<SenderRole, string> = {
  borrower: 'Borrower',
  broker: 'Broker',
  underwriter: 'Bank lending officer',
};

export function toThreadMessage(id: string, data: DocumentData): ThreadMessage | null {
  const text = readString(data.text);
  if (text === null) {
    return null;
  }
  const role = readString(data.senderRole);

  return {
    id,
    senderId: readString(data.senderId),
    senderRole: (SENDER_ROLES as readonly string[]).includes(role ?? '') ? (role as SenderRole) : null,
    text,
    sentAt: readDate(data.sentAt),
  };
}

// Messages someone else sent after this person last opened the thread (SCHEMA.md readState).
export function unreadCount({ messages, lastReadAt }: ThreadSnapshot, uid: string) {
  return messages.filter(
    (message) =>
      message.senderId !== uid &&
      (lastReadAt === null || (message.sentAt !== null && message.sentAt.getTime() > lastReadAt.getTime())),
  ).length;
}

export function lastMessage({ messages }: ThreadSnapshot): ThreadMessage | null {
  return messages.at(-1) ?? null;
}

function threadError(code: string): ThreadError {
  return code === 'permission-denied' ? 'permission-denied' : 'unavailable';
}

export function createMessagesService(client: ApiClient = createApiClient()): MessagesService {
  return {
    subscribeToThread(applicationId, uid, listener, onError) {
      let messages: ThreadMessage[] | null = null;
      let lastReadAt: Date | null | undefined;
      const emit = () => {
        if (messages !== null && lastReadAt !== undefined) {
          listener({ messages, lastReadAt });
        }
      };

      const stopMessages = onSnapshot(
        query(collection(db, 'applications', applicationId, 'messages'), orderBy('sentAt')),
        (snapshot) => {
          messages = snapshot.docs
            .map((document) => toThreadMessage(document.id, document.data()))
            .filter((message): message is ThreadMessage => message !== null);
          emit();
        },
        (error) => onError(threadError(error.code)),
      );
      const stopReadState = onSnapshot(
        doc(db, 'applications', applicationId, 'readState', uid),
        (snapshot) => {
          lastReadAt = snapshot.exists() ? readDate(snapshot.data().lastReadAt) : null;
          emit();
        },
        (error) => onError(threadError(error.code)),
      );

      return () => {
        stopMessages();
        stopReadState();
      };
    },
    async send(applicationId, text) {
      await client.request(`/core/applications/${encodeURIComponent(applicationId)}/messages`, {
        method: 'POST',
        body: { text },
      });
    },
    async markRead(applicationId) {
      await client.request(`/core/applications/${encodeURIComponent(applicationId)}/messages/read`, {
        method: 'POST',
      });
    },
  };
}

export const firestoreMessagesService = createMessagesService();
