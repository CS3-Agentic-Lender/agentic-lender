import { useCallback, useContext, useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { SegmentedFilter } from '../../components/admin/SegmentedFilter';
import { LiveStatus, LoadingPanel, StatusPanel } from '../../components/admin/StatusPanel';
import { Skeleton } from '../../components/Skeleton';
import { useToast } from '../../components/admin/Toasts';
import { InboxServiceContext } from '../../context/AdminDataContext';
import { useLive, type LiveState } from '../../hooks/useLive';
import { ApiError } from '../../services/apiClient';
import {
  oldestNoteFirst,
  type SupportNote,
  type SupportRequest,
  type SupportStatus,
} from '../../services/inboxService';
import type { LiveErrorListener, LiveListener } from '../../services/liveCollection';
import { formatDate, formatDateTime } from '../../utils/formatters';

export type NameOf = (uid: string) => string;

const categoryLabels: Record<string, string> = {
  application: 'Application',
  payment: 'Payment',
  account: 'Account',
  other: 'Other',
};

// Stored as `closed` (al-core/SCHEMA.md); admins see it as Resolved.
const statusLabels: Record<SupportStatus, string> = { open: 'Open', closed: 'Resolved' };

const badgeClass = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap';

function StatusBadge({ status }: { status: SupportStatus }) {
  return (
    <span className={`${badgeClass} ${status === 'open' ? 'bg-tint text-pine' : 'bg-neutral text-neutral-text'}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${status === 'open' ? 'bg-pine' : 'bg-muted'}`} />
      {statusLabels[status]}
    </span>
  );
}

function resolvedLine(request: SupportRequest, nameOf: NameOf) {
  const when = formatDateTime(request.closedAt);
  return request.closedBy ? `Resolved by ${nameOf(request.closedBy)}, ${when}` : `Resolved ${when}`;
}

const fieldClass =
  'w-full rounded-lg border border-line bg-surface px-4 py-3 transition-colors duration-200 hover:border-pine/50 disabled:opacity-60';

function refusalOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

// The live notes, plus any this admin just added that the live list has not reported yet.
function visibleNotes(live: LiveState<SupportNote>, added: readonly SupportNote[]) {
  const listed = live.status === 'ready' ? live.items : [];
  const ids = new Set(listed.map((note) => note.id));
  return [...listed, ...added.filter((note) => !ids.has(note.id))].sort(oldestNoteFirst);
}

// A resolved request keeps its notes on show but takes no new ones until it is reopened (al-core answers 409).
function NotesThread({ reference, resolved, nameOf }: { reference: string; resolved: boolean; nameOf: NameOf }) {
  const service = useContext(InboxServiceContext);
  const live = useLive(
    useCallback(
      (listener: LiveListener<SupportNote>, onError: LiveErrorListener) =>
        service.subscribeToSupportNotes(reference, listener, onError),
      [service, reference],
    ),
  );
  const [added, setAdded] = useState<SupportNote[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const boxId = useId();
  const notes = visibleNotes(live, added);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || sending) {
      return;
    }

    setSending(true);
    setRefusal(null);
    try {
      const note = await service.addSupportNote(reference, draft);
      setAdded((current) => [...current, note]);
      setDraft('');
    } catch (error) {
      setRefusal(refusalOf(error, 'The note could not be added. Try again.'));
    } finally {
      setSending(false);
    }
  }

  return (
    <section aria-label={`Notes on ${reference}`} className="mt-5 border-t border-line pt-5">
      <h4 className="font-semibold">
        Notes <span className="text-sm font-normal text-muted">(staff only, the sender never sees them)</span>
      </h4>
      {live.status === 'denied' || live.status === 'error' ? (
        <p className="mt-3 text-sm text-error">The notes could not be loaded.</p>
      ) : live.status === 'loading' && notes.length === 0 ? (
        <LoadingPanel className="mt-3" label="Loading the notes">
          <Skeleton className="h-16 rounded-xl" />
        </LoadingPanel>
      ) : notes.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No notes yet.</p>
      ) : null}
      {notes.length > 0 ? (
        <ol className="mt-3 grid gap-3">
          {notes.map((note) => (
            <li className="rounded-xl bg-oat p-4 text-sm" key={note.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-medium">{note.authorUid ? nameOf(note.authorUid) : 'Author not recorded'}</span>
                <time className="text-muted" dateTime={note.createdAt?.toISOString()}>
                  {formatDateTime(note.createdAt)}
                </time>
              </div>
              <p className="mt-1 leading-6 break-words whitespace-pre-line">{note.text ?? 'No text'}</p>
            </li>
          ))}
        </ol>
      ) : null}
      {resolved ? (
        <p className="mt-4 text-sm text-muted">Resolved. Reopen to add a note.</p>
      ) : (
        <form className="mt-4" onSubmit={(event) => void send(event)}>
          <label className="mb-2 block text-sm font-medium" htmlFor={boxId}>
            Add a note
          </label>
          <textarea
            className={`min-h-20 ${fieldClass}`}
            disabled={sending}
            id={boxId}
            maxLength={2000}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            value={draft}
          />
          {refusal ? (
            <p className="mt-2 rounded-lg bg-danger-soft p-3 text-sm text-error" role="alert">
              {refusal}
            </p>
          ) : null}
          <div className="mt-3 flex justify-end">
            <button className="btn btn-secondary" disabled={!draft.trim() || sending} type="submit">
              {sending ? 'Adding…' : 'Add note'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

interface RequestCardProps {
  request: SupportRequest;
  nameOf: NameOf;
  reopening: boolean;
  onResolve(): void;
  onReopen(): void;
}

// The status filter and a few request cards in placeholders, while the requests load.
function RequestsSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-12" />
      <div className="mt-3 flex gap-1">
        <Skeleton className="h-11 w-24 rounded-lg" />
        <Skeleton className="h-11 w-24 rounded-lg" />
      </div>
      <div className="mt-6 grid gap-4">
        {['w-2/3', 'w-1/2'].map((width) => (
          <div className="card" key={width}>
            <div className="flex justify-between gap-6">
              <Skeleton className="h-7 w-40 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className={`mt-4 h-6 ${width}`} />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-3/4" />
            <Skeleton className="mt-5 h-20 rounded-xl" />
          </div>
        ))}
      </div>
    </>
  );
}

function RequestCard({ request, nameOf, reopening, onResolve, onReopen }: RequestCardProps) {
  const category = request.category ? categoryLabels[request.category] ?? request.category : 'No category';

  return (
    <li className="card animate-rise">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${badgeClass} border border-line text-ink`}>{category}</span>
          <StatusBadge status={request.status} />
        </div>
        <time
          className="text-sm whitespace-nowrap text-muted"
          dateTime={request.createdAt?.toISOString()}
          title={formatDateTime(request.createdAt)}
        >
          {formatDate(request.createdAt)}
        </time>
      </div>
      <h3 className="mt-4 text-lg leading-7 font-semibold break-words">
        <span className="mr-2 font-mono text-sm font-medium text-muted">{request.reference}</span>
        {' '}
        <span>{request.subject ?? 'No subject'}</span>
      </h3>
      <p className="mt-2 leading-7 break-words whitespace-pre-line">
        {request.message ?? <span className="text-muted">No message</span>}
      </p>
      <dl className="mt-5 grid gap-3 rounded-xl bg-oat p-4 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-muted">From</dt>
          <dd className="mt-0.5 font-medium break-words">
            {request.userId ? nameOf(request.userId) : 'Sender not recorded'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted">Linked application</dt>
          <dd className="mt-0.5 break-words">
            {request.applicationId ? (
              <Link
                className="font-mono font-medium text-pine underline underline-offset-4 hover:no-underline"
                to={`/admin/applications/${encodeURIComponent(request.applicationId)}`}
              >
                {request.applicationId}
              </Link>
            ) : (
              <span className="text-muted">No application linked</span>
            )}
          </dd>
        </div>
      </dl>
      {request.status === 'closed' && request.resolution ? (
        <div className="mt-5 rounded-xl border border-line p-4 text-sm">
          <p className="text-muted">Resolution</p>
          <p className="mt-1 leading-6 break-words whitespace-pre-line">{request.resolution}</p>
        </div>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        {request.status === 'closed' ? (
          <>
            <p className="mr-auto text-sm text-muted">{resolvedLine(request, nameOf)}</p>
            <button
              aria-label={`Reopen ${request.reference}`}
              className="btn btn-secondary"
              disabled={reopening}
              onClick={onReopen}
              type="button"
            >
              {reopening ? 'Reopening…' : 'Reopen'}
            </button>
          </>
        ) : (
          <button
            aria-label={`Resolve ${request.reference}`}
            className="btn btn-secondary"
            onClick={onResolve}
            type="button"
          >
            Resolve
          </button>
        )}
      </div>
      <NotesThread nameOf={nameOf} reference={request.reference} resolved={request.status === 'closed'} />
    </li>
  );
}

interface ResolveDialogProps {
  request: SupportRequest;
  nameOf: NameOf;
  onCancel(): void;
  onResolved(resolved: SupportRequest): void;
}

function ResolveRequestDialog({ request, nameOf, onCancel, onResolved }: ResolveDialogProps) {
  const service = useContext(InboxServiceContext);
  const toast = useToast();
  const noteId = useId();
  const [resolution, setResolution] = useState('');
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const sending = useRef(false);

  async function confirm() {
    if (sending.current) {
      return;
    }

    sending.current = true;
    setPending(true);
    setRefusal(null);
    try {
      const resolved = await service.closeSupportRequest(request.reference, resolution);
      toast({ tone: 'success', message: `${request.reference} is resolved.` });
      onResolved(resolved);
    } catch (error) {
      sending.current = false;
      setPending(false);
      setRefusal(refusalOf(error, 'The request could not be resolved. Try again.'));
    }
  }

  return (
    <ConfirmationDialog onClose={pending ? () => undefined : onCancel} title={`Resolve ${request.reference}?`}>
      <p className="mt-4 leading-7 text-muted">
        It moves to Resolved with your name and the time. You can reopen it later if it needs more work.
      </p>
      <dl className="mt-5 grid gap-3 rounded-xl bg-oat p-4 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-muted">Subject</dt>
          <dd className="break-words">{request.subject ?? 'No subject'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted">From</dt>
          <dd className="break-words">{request.userId ? nameOf(request.userId) : 'Sender not recorded'}</dd>
        </div>
      </dl>
      <label className="mt-5 mb-2 block font-semibold" htmlFor={noteId}>
        Resolution note <span className="font-normal text-muted">(optional)</span>
      </label>
      <textarea
        className={`min-h-24 ${fieldClass}`}
        disabled={pending}
        id={noteId}
        maxLength={2000}
        onChange={(event) => setResolution(event.target.value)}
        rows={3}
        value={resolution}
      />
      <p className="mt-1 text-sm text-muted">Shown on the resolved request to other admins. The sender doesn&rsquo;t see it in the app.</p>
      {refusal ? (
        <p className="mt-5 rounded-lg bg-danger-soft p-4 text-error" role="alert">
          {refusal}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button className="btn btn-secondary" disabled={pending} onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="btn btn-primary" disabled={pending} onClick={() => void confirm()} type="button">
          {pending ? 'Resolving…' : 'Resolve'}
        </button>
      </div>
    </ConfirmationDialog>
  );
}

const emptyCopy: Record<SupportStatus, { heading: string; detail: string }> = {
  open: { heading: 'No open requests', detail: 'Every request has been resolved. Resolved ones are under Resolved.' },
  closed: { heading: 'No resolved requests yet', detail: 'Requests you resolve move here, with who resolved them, when and the note.' },
};

interface SupportRequestsPanelProps {
  state: LiveState<SupportRequest>;
  nameOf: NameOf;
  // A resolve or reopen the API confirmed.
  onChanged(changed: SupportRequest): void;
}

export function SupportRequestsPanel({ state, nameOf, onChanged }: SupportRequestsPanelProps) {
  const service = useContext(InboxServiceContext);
  const toast = useToast();
  const [filter, setFilter] = useState<SupportStatus>('open');
  const [resolving, setResolving] = useState<SupportRequest | null>(null);
  const [reopening, setReopening] = useState<ReadonlySet<string>>(new Set());

  async function reopen(reference: string) {
    setReopening((current) => new Set(current).add(reference));
    try {
      const reopened = await service.reopenSupportRequest(reference);
      toast({ tone: 'success', message: `${reference} is open again.` });
      onChanged(reopened);
    } catch (error) {
      toast({ tone: 'error', message: refusalOf(error, `${reference} could not be reopened. Try again.`) });
    } finally {
      setReopening((current) => {
        const next = new Set(current);
        next.delete(reference);
        return next;
      });
    }
  }

  if (state.status !== 'ready') {
    return <LiveStatus skeleton={<RequestsSkeleton />} state={state} what="support requests" />;
  }

  if (state.items.length === 0) {
    return (
      <StatusPanel
        detail="Requests borrowers send from the app land here, newest first."
        heading="No support requests yet"
      />
    );
  }

  const visible = state.items.filter((request) => request.status === filter);

  return (
    <>
      <SegmentedFilter<SupportStatus>
        legend="Status"
        onChange={setFilter}
        options={(['open', 'closed'] as const).map((value) => ({
          value,
          label: statusLabels[value],
          count: state.items.filter((request) => request.status === value).length,
        }))}
        value={filter}
      />
      <div className="mt-6">
        {visible.length === 0 ? (
          <StatusPanel detail={emptyCopy[filter].detail} heading={emptyCopy[filter].heading} />
        ) : (
          <ul aria-label="Support requests" className="grid gap-4">
            {visible.map((request) => (
              <RequestCard
                key={request.reference}
                nameOf={nameOf}
                onReopen={() => void reopen(request.reference)}
                onResolve={() => setResolving(request)}
                reopening={reopening.has(request.reference)}
                request={request}
              />
            ))}
          </ul>
        )}
      </div>
      {resolving ? (
        <ResolveRequestDialog
          nameOf={nameOf}
          onCancel={() => setResolving(null)}
          onResolved={(resolved) => {
            onChanged(resolved);
            setResolving(null);
          }}
          request={resolving}
        />
      ) : null}
    </>
  );
}
