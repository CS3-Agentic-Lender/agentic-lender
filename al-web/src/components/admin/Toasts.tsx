import { AnimatePresence, m } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'success' | 'error';

export interface ToastInput {
  tone: ToastTone;
  message: string;
  // A toast with an action stays until it is used or dismissed; any other leaves after a few seconds.
  action?: { label: string; onAction(): void };
}

interface Toast extends ToastInput {
  id: number;
}

interface ToastContextValue {
  show(toast: ToastInput): void;
}

export const TOAST_TIMEOUT_MS = 5000;

const ToastContext = createContext<ToastContextValue | null>(null);

const toneClass: Record<ToastTone, string> = {
  success: 'border-success/25',
  error: 'border-error/30',
};

const toneDot: Record<ToastTone, string> = {
  success: 'bg-success',
  error: 'bg-error',
};

function ToastCard({ toast, dismiss }: { toast: Toast; dismiss(id: number): void }) {
  const onDismiss = () => dismiss(toast.id);

  useEffect(() => {
    if (toast.action) {
      return;
    }

    const timer = window.setTimeout(() => dismiss(toast.id), TOAST_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.action, dismiss]);

  return (
    <m.li
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={`pointer-events-auto flex w-full items-start gap-3 rounded-xl border bg-surface p-4 shadow-raised sm:w-96 ${toneClass[toast.tone]}`}
      exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <span aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-full ${toneDot[toast.tone]}`} />
      <div className="min-w-0 flex-1">
        <p className={`leading-6 break-words ${toast.tone === 'error' ? 'text-error' : 'text-ink'}`}>{toast.message}</p>
        {toast.action ? (
          <button
            className="mt-2 min-h-9 cursor-pointer font-semibold text-pine underline underline-offset-4 hover:no-underline"
            onClick={() => {
              toast.action?.onAction();
              onDismiss();
            }}
            type="button"
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
      <button
        aria-label="Dismiss"
        className="-m-1 grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:bg-tint hover:text-pine"
        onClick={onDismiss}
        type="button"
      >
        <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 16 16">
          <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
        </svg>
      </button>
    </m.li>
  );
}

// Brief confirmations of what an admin just did, announced politely to screen readers.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((toast: ToastInput) => {
    const id = ++nextId.current;
    // The newest three are enough; older ones have been read or are stale.
    setToasts((current) => [...current.slice(-2), { ...toast, id }]);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ol
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6"
        role="status"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <ToastCard dismiss={dismiss} key={toast.id} toast={toast} />
          ))}
        </AnimatePresence>
      </ol>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used inside ToastProvider.');
  }

  return context.show;
}
