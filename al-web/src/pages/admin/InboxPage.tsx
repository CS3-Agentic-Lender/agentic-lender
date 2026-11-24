import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { AdminPage } from '../../components/admin/AdminPage';
import { useReviews, useSupportRequests, useUsers } from '../../context/AdminDataContext';
import type { LiveState } from '../../hooks/useLive';
import type { SupportRequest } from '../../services/inboxService';
import { directoryNames } from '../../services/userDirectoryService';
import { ReviewsPanel } from './ReviewsPanel';
import { SupportRequestsPanel, type NameOf } from './SupportRequestsPanel';

const TABS = [
  { id: 'requests', label: 'Support requests' },
  { id: 'reviews', label: 'Reviews' },
] as const;

type InboxTab = (typeof TABS)[number]['id'];

function readTab(value: string | null): InboxTab {
  return value === 'reviews' ? 'reviews' : 'requests';
}

// Senders, reviewers and closers by name. Every case says something: a uid is never shown as a blank.
function useNameOf(): NameOf {
  const users = useUsers();

  return useMemo(() => {
    if (users.status === 'loading') {
      return () => 'Loading name…';
    }

    if (users.status !== 'ready') {
      return () => 'Name unavailable';
    }

    const lookup = directoryNames(users.items);
    return (uid: string) => lookup(uid) ?? `Name not found (${uid})`;
  }, [users]);
}

// A resolve or reopen the API confirmed, shown at once until the live list reports the same status.
function withChanges(state: LiveState<SupportRequest>, changes: ReadonlyMap<string, SupportRequest>) {
  if (state.status !== 'ready' || changes.size === 0) {
    return state;
  }

  return {
    ...state,
    items: state.items.map((request) => {
      const changed = changes.get(request.reference);
      return changed && request.status !== changed.status
        ? {
            ...request,
            status: changed.status,
            closedAt: changed.closedAt,
            closedBy: changed.closedBy,
            resolution: changed.resolution,
          }
        : request;
    }),
  };
}

// Once the live list shows a change, the live list owns it, so a later change by another admin shows.
function useConfirmedChanges(live: LiveState<SupportRequest>) {
  const [changes, setChanges] = useState<ReadonlyMap<string, SupportRequest>>(new Map());

  useEffect(() => {
    if (live.status !== 'ready') {
      return;
    }
    setChanges((current) => {
      const caughtUp = live.items.filter((request) => current.get(request.reference)?.status === request.status);
      if (caughtUp.length === 0) {
        return current;
      }
      const next = new Map(current);
      caughtUp.forEach((request) => next.delete(request.reference));
      return next;
    });
  }, [live]);

  const record = (changed: SupportRequest) => setChanges((current) => new Map(current).set(changed.reference, changed));
  return [withChanges(live, changes), record] as const;
}

const tabClass =
  '-mb-px inline-flex min-h-11 cursor-pointer items-center gap-2 border-b-2 px-4 font-medium transition-colors hover:text-pine';

export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const tab = readTab(params.get('tab'));
  const id = useId();
  const nameOf = useNameOf();
  const [requests, recordChange] = useConfirmedChanges(useSupportRequests());
  const reviews = useReviews();

  const counts: Record<InboxTab, number | null> = {
    requests: requests.status === 'ready' ? requests.items.filter((request) => request.status === 'open').length : null,
    reviews: reviews.status === 'ready' ? reviews.items.length : null,
  };

  function select(next: InboxTab) {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next === 'reviews') updated.set('tab', next);
        else updated.delete('tab');
        return updated;
      },
      { replace: true },
    );
  }

  // Arrow keys, Home and End move between tabs and open them, as in the WAI-ARIA tabs pattern.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((item) => item.id === tab);
    const target = {
      ArrowRight: (index + 1) % TABS.length,
      ArrowLeft: (index - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    }[event.key];

    if (target === undefined) {
      return;
    }

    event.preventDefault();
    select(TABS[target].id);
    document.getElementById(`${id}-tab-${TABS[target].id}`)?.focus();
  }

  return (
    <AdminPage
      description="What borrowers send and say from the app: support requests to answer and resolve, and their reviews."
      subnav={
        <div aria-label="Inbox" className="flex flex-wrap border-b border-line" onKeyDown={onKeyDown} role="tablist">
          {TABS.map((item) => (
            <button
              // Only the selected tab's panel is rendered, so only that tab points at one.
              aria-controls={tab === item.id ? `${id}-panel-${item.id}` : undefined}
              aria-selected={tab === item.id}
              className={`${tabClass} ${tab === item.id ? 'border-pine text-pine' : 'border-transparent text-muted'}`}
              id={`${id}-tab-${item.id}`}
              key={item.id}
              onClick={() => select(item.id)}
              role="tab"
              tabIndex={tab === item.id ? 0 : -1}
              type="button"
            >
              {item.label}{' '}
              {counts[item.id] === null ? null : (
                <span className="rounded-full bg-tint px-2 font-mono text-xs tabular-nums">
                  {counts[item.id]}
                  {item.id === 'requests' ? <span className="sr-only"> open</span> : null}
                </span>
              )}
            </button>
          ))}
        </div>
      }
      title="Inbox"
    >
      <div
        aria-labelledby={`${id}-tab-${tab}`}
        className="animate-rise"
        id={`${id}-panel-${tab}`}
        key={tab}
        role="tabpanel"
        tabIndex={0}
      >
        {tab === 'requests' ? (
          <SupportRequestsPanel
            nameOf={nameOf}
            onChanged={recordChange}
            state={requests}
          />
        ) : (
          <ReviewsPanel nameOf={nameOf} state={reviews} />
        )}
      </div>
    </AdminPage>
  );
}
