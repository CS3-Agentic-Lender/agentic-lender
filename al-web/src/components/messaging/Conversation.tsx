import { useEffect, useId, useRef, useState } from 'react';
import { useMessagesService } from '../../context/MessagesContext';
import { ApiError } from '../../services/apiClient';
import {
  senderLabels,
  unreadCount,
  type ThreadError,
  type ThreadMessage,
  type ThreadSnapshot,
} from '../../services/messagesService';

interface ConversationProps {
  applicationId: string;
  uid: string;
  // A heading for the thread, such as the client's name.
  title: string;
}

const timeFormat = new Intl.DateTimeFormat('en-IE', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function sendFailure(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'This thread opens once the application is submitted.';
    }
    if (error.status === 401 || error.status === 403 || error.status === 404) {
      return 'You are not allowed to message on this application.';
    }
    if (error.kind === 'network') {
      return 'Could not reach the server. Check your connection and try again.';
    }
    return error.message;
  }
  return 'Could not send the message. Please try again.';
}

const threadErrors: Record<ThreadError, string> = {
  'permission-denied': 'You are not allowed to read this thread.',
  unavailable: 'The messages could not be loaded. Reload the page to try again.',
};

function sender(message: ThreadMessage, uid: string) {
  if (message.senderId === uid) {
    return 'You';
  }
  return message.senderRole ? senderLabels[message.senderRole] : 'Unknown sender';
}

// One application's thread: the messages live from Firestore, a reply box that sends through
// al-core, and this person's own read position moved once the thread has loaded.
export function Conversation({ applicationId, uid, title }: ConversationProps) {
  const service = useMessagesService();
  const textId = useId();
  const [thread, setThread] = useState<ThreadSnapshot | null>(null);
  const [threadError, setThreadError] = useState<ThreadError | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const sendingNow = useRef(false);
  const markingRead = useRef(false);

  useEffect(() => {
    setThread(null);
    setThreadError(null);
    return service.subscribeToThread(applicationId, uid, setThread, setThreadError);
  }, [service, applicationId, uid]);

  const unread = thread ? unreadCount(thread, uid) : 0;

  // Only this person's read position moves; nobody else's unread messages are cleared.
  useEffect(() => {
    if (unread === 0 || markingRead.current) {
      return;
    }
    markingRead.current = true;
    service
      .markRead(applicationId)
      .catch(() => {
        // The count stays as it is and the next change tries again.
      })
      .finally(() => {
        markingRead.current = false;
      });
  }, [service, applicationId, unread]);

  async function send() {
    const text = draft.trim();
    if (!text || sendingNow.current) {
      return;
    }
    sendingNow.current = true;
    setSending(true);
    setSendError(null);
    try {
      await service.send(applicationId, text);
      // The message shows when the listener delivers it, never before it is saved.
      setDraft('');
    } catch (error) {
      setSendError(sendFailure(error));
    } finally {
      sendingNow.current = false;
      setSending(false);
    }
  }

  return (
    <section aria-label={`Messages: ${title}`} className="flex min-h-0 flex-col rounded-2xl border border-line bg-surface p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 font-mono text-xs text-muted">{applicationId}</p>

      {threadError ? (
        <p className="mt-4 rounded-lg bg-danger-soft p-3 text-sm text-error" role="alert">
          {threadErrors[threadError]}
        </p>
      ) : thread === null ? (
        <p aria-live="polite" className="mt-4 text-sm text-muted" role="status">
          Loading the messages…
        </p>
      ) : thread.messages.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No messages yet.</p>
      ) : (
        <ol aria-label="Messages" className="mt-4 space-y-3">
          {thread.messages.map((message) => {
            const mine = message.senderId === uid;
            return (
              <li
                className={`rounded-xl p-3 text-sm ${mine ? 'ml-8 bg-tint' : 'mr-8 border border-line bg-surface'}`}
                key={message.id}
              >
                <p className="flex flex-wrap justify-between gap-2 text-xs text-muted">
                  <span className="font-semibold text-ink">{sender(message, uid)}</span>
                  {message.sentAt ? <time dateTime={message.sentAt.toISOString()}>{timeFormat.format(message.sentAt)}</time> : null}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words">{message.text}</p>
              </li>
            );
          })}
        </ol>
      )}

      <form
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="mb-2 block font-semibold" htmlFor={textId}>
          Reply
        </label>
        <textarea
          className="min-h-24 w-full rounded-lg border border-line bg-surface px-4 py-3"
          id={textId}
          maxLength={2000}
          onChange={(event) => setDraft(event.target.value)}
          value={draft}
        />
        {sendError ? (
          <p className="mt-2 rounded-lg bg-danger-soft p-3 text-sm text-error" role="alert">
            {sendError}
          </p>
        ) : null}
        <button
          className="mt-3 min-h-12 cursor-pointer rounded-lg bg-pine px-5 py-3 font-semibold text-surface transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!draft.trim() || sending}
          type="submit"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
