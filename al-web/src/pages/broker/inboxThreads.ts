import { clientName, type BrokerClient } from '../../services/clientsService';
import { lastMessage, unreadCount, type ThreadMessage, type ThreadSnapshot } from '../../services/messagesService';

export interface InboxThread {
  applicationId: string;
  clientName: string | null;
  unread: number;
  last: ThreadMessage | null;
  loaded: boolean;
}

// One thread per application the broker can read (the client list already leaves out Drafts).
export function inboxThreads(
  clients: BrokerClient[],
  threads: ReadonlyMap<string, ThreadSnapshot>,
  uid: string,
): InboxThread[] {
  return clients.flatMap((client) =>
    client.applications.map((application) => {
      const thread = threads.get(application.id);
      return {
        applicationId: application.id,
        clientName: clientName(client),
        unread: thread ? unreadCount(thread, uid) : 0,
        last: thread ? lastMessage(thread) : null,
        loaded: thread !== undefined,
      };
    }),
  );
}

// Unread threads first, then the most recent message, then the client's name.
export function sortThreads(threads: InboxThread[]): InboxThread[] {
  return [...threads].sort(
    (a, b) =>
      Number(b.unread > 0) - Number(a.unread > 0) ||
      (b.last?.sentAt?.getTime() ?? 0) - (a.last?.sentAt?.getTime() ?? 0) ||
      (a.clientName ?? '').localeCompare(b.clientName ?? '') ||
      a.applicationId.localeCompare(b.applicationId),
  );
}
