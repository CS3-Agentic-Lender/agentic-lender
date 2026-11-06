import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDecisionService } from '../../context/DecisionContext';
import { ApiError } from '../../services/apiClient';
import type { DecisionResult } from '../../services/decisionService';
import type { DecisionOutcome, PolicyGate } from '../../services/loanFileService';

interface SignOffPanelProps {
  applicationId: string;
  borrowerName: string | null;
  policyGate: PolicyGate | null;
  onRecorded(result: DecisionResult): void;
}

const buttonClass = 'min-h-12 cursor-pointer rounded-lg px-5 py-3 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60';
const primaryClass = `${buttonClass} bg-pine text-surface hover:opacity-90`;
const secondaryClass = `${buttonClass} border border-line bg-neutral text-neutral-text hover:bg-tint`;

export const decisionLabels: Record<DecisionOutcome, string> = {
  approved: 'Approved',
  declined: 'Declined',
};

function failureMessage(error: unknown) {
  if (!(error instanceof ApiError)) {
    return 'Could not record the decision. Please try again.';
  }
  if (error.status === 409) {
    return `${error.message} Reload to see the current status.`;
  }
  if (error.status === 401 || error.status === 403) {
    return 'You are not allowed to sign off this application.';
  }
  if (error.kind === 'network') {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return error.message;
}

function ConfirmationDialog({ children, onClose }: { children: ReactNode; onClose(): void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current!;
    dialog.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'Tab') {
        const dialog = dialogRef.current!;
        const controls = dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        const first = controls[0];
        const last = controls[controls.length - 1];
        const outside = !dialog.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog || outside)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || outside)) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    // Disabling the focused confirm button can move focus to the body while saving.
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-neutral/90 p-6">
      <div
        aria-labelledby={headingId}
        aria-modal="true"
        className="max-h-full w-full max-w-xl overflow-y-auto rounded-2xl border border-line bg-surface p-6 sm:p-8"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 className="text-xl font-semibold" id={headingId}>
          Confirm decision
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function SignOffPanel({ applicationId, borrowerName, policyGate, onRecorded }: SignOffPanelProps) {
  const service = useDecisionService();
  const justificationId = useId();
  const headingId = useId();
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState<{ outcome: DecisionOutcome; reason: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A synchronous lock also covers two clicks before React has rendered disabled=true.
  const submitting = useRef(false);
  const effective = policyGate?.effective ?? null;
  const override = confirmation !== null && (
    (confirmation.outcome === 'declined' && (effective === 'Approve' || effective === 'Conditionally Approve')) ||
    (confirmation.outcome === 'approved' && effective === 'Decline')
  );

  function choose(outcome: DecisionOutcome) {
    if (!reason.trim() || submitting.current) {
      return;
    }
    setError(null);
    setConfirmation({ outcome, reason: reason.trim() });
  }

  async function confirm() {
    if (!confirmation || submitting.current) {
      return;
    }
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await service.signOff(applicationId, confirmation.outcome, confirmation.reason);
      setConfirmation(null);
      onRecorded(result);
      // Keep the lock after success until the parent removes the panel.
    } catch (failure) {
      submitting.current = false;
      setError(failureMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby={headingId} className="mt-6 rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <h2 className="text-xl font-semibold" id={headingId}>
        Sign off
      </h2>
      <div className="mt-4 rounded-xl bg-tint p-4">
        <h3 className="font-semibold">AI recommendation</h3>
        <p className="mt-2">{effective ?? 'No AI recommendation recorded'}</p>
        {policyGate && policyGate.conditions.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {policyGate.conditions.map((condition, index) => (
              <li key={index}>{condition}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-sm text-muted">
          This is advice only. The decision is yours as the underwriter.
        </p>
      </div>

      <label className="mt-6 mb-2 block font-semibold" htmlFor={justificationId}>
        Justification <span className="font-normal text-muted">(required)</span>
      </label>
      <textarea
        className="min-h-32 w-full rounded-lg border border-line bg-surface px-4 py-3 disabled:opacity-60"
        disabled={pending || confirmation !== null}
        id={justificationId}
        maxLength={1000}
        onChange={(event) => setReason(event.target.value)}
        required
        rows={4}
        value={reason}
      />
      <p className="mt-1 text-sm text-muted">{reason.length} / 1000 characters</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className={primaryClass}
          disabled={!reason.trim() || pending || confirmation !== null}
          onClick={() => choose('approved')}
          type="button"
        >
          Approve
        </button>
        <button
          className={secondaryClass}
          disabled={!reason.trim() || pending || confirmation !== null}
          onClick={() => choose('declined')}
          type="button"
        >
          Decline
        </button>
      </div>
      {pending && !confirmation ? (
        <p className="mt-4 text-muted" role="status">Saving…</p>
      ) : null}
      {error && !confirmation ? (
        <p className="mt-4 rounded-lg bg-danger-soft p-3 text-error" role="alert">{error}</p>
      ) : null}

      {confirmation ? (
        <ConfirmationDialog onClose={() => setConfirmation(null)}>
          <dl className="mt-6 space-y-4 break-words">
            <div>
              <dt className="text-sm text-muted">Application</dt>
              <dd className="font-mono">{applicationId}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Borrower</dt>
              <dd>{borrowerName ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Outcome</dt>
              <dd>{confirmation.outcome === 'approved' ? 'Approve' : 'Decline'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Justification</dt>
              <dd className="whitespace-pre-wrap">{confirmation.reason}</dd>
            </div>
          </dl>
          {override ? (
            <p className="mt-6 rounded-lg bg-neutral p-3 text-neutral-text">
              You are going against the AI recommendation.
            </p>
          ) : null}
          {error ? (
            <p className="mt-4 rounded-lg bg-danger-soft p-3 text-error" role="alert">{error}</p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <button className={secondaryClass} onClick={() => setConfirmation(null)} type="button">
              Cancel
            </button>
            <button className={primaryClass} disabled={pending} onClick={() => void confirm()} type="button">
              {pending ? 'Saving…' : confirmation.outcome === 'approved' ? 'Confirm approval' : 'Confirm decline'}
            </button>
          </div>
        </ConfirmationDialog>
      ) : null}
    </section>
  );
}
