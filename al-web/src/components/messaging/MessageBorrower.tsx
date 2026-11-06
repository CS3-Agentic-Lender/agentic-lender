import { useId, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Conversation } from './Conversation';

interface MessageBorrowerProps {
  applicationId: string;
  borrowerName: string | null;
}

// The underwriter's way into the borrower's existing thread from the loan file. It is the same
// thread the app shows; al-core stores the reply with the underwriter's role, which the borrower
// and the broker see as "Bank lending officer". Opening the loan file marks nothing read: only
// opening the thread moves this underwriter's own read position.
export function MessageBorrower({ applicationId, borrowerName }: MessageBorrowerProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (!user) {
    return null;
  }

  return (
    <div className="mt-6">
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className="min-h-12 cursor-pointer rounded-lg border border-line bg-neutral px-5 py-3 font-semibold text-neutral-text transition-colors hover:bg-tint"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {open ? 'Close messages' : 'Message borrower'}
      </button>
      {open ? (
        <div className="mt-4" id={panelId}>
          <p className="mb-3 text-sm text-muted">
            You reply as the bank lending officer, in the borrower's own thread.
          </p>
          <Conversation
            applicationId={applicationId}
            title={borrowerName ?? 'Borrower name unavailable'}
            uid={user.uid}
          />
        </div>
      ) : null}
    </div>
  );
}
