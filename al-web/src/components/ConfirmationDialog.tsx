import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = [
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'a[href]',
].join(',');

interface ConfirmationDialogProps {
  title: string;
  children: ReactNode;
  onClose(): void;
}

// A modal that keeps focus inside it until it closes, then hands focus back to whatever opened it.
// Escape closes it. The caller renders it only while it is open.
export function ConfirmationDialog({ title, children, onClose }: ConfirmationDialogProps) {
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
        const controls = dialog.querySelectorAll<HTMLElement>(FOCUSABLE);
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
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/40 p-4 backdrop-blur-sm sm:p-6">
      <div
        aria-labelledby={headingId}
        aria-modal="true"
        className="max-h-full w-full max-w-xl animate-rise overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-raised sm:p-8"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 className="card-title" id={headingId}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
