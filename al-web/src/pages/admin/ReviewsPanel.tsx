import { LiveStatus, StatusPanel } from '../../components/admin/StatusPanel';
import { Skeleton } from '../../components/Skeleton';
import type { LiveState } from '../../hooks/useLive';
import { inboxSummary, type Review } from '../../services/inboxService';
import { formatDate, formatDateTime, formatRating, plural } from '../../utils/formatters';
import type { NameOf } from './SupportRequestsPanel';

const STAR = 'M10 1.9l2.45 4.97 5.48.8-3.97 3.86.94 5.46L10 14.41l-4.9 2.58.94-5.46-3.97-3.86 5.48-.8z';
const STAR_VALUES = [5, 4, 3, 2, 1] as const;

// Filled and outlined stars differ in shape as well as colour; the label carries the number.
function Stars({ rating }: { rating: number | null }) {
  if (rating === null) {
    return <span className="text-sm text-muted">Rating unreadable</span>;
  }

  return (
    <span aria-label={`${rating} out of 5 stars`} className="flex gap-0.5 text-pine" role="img">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg aria-hidden="true" className="h-5 w-5" key={star} viewBox="0 0 20 20">
          <path
            d={STAR}
            fill={star <= rating ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.4"
          />
        </svg>
      ))}
    </span>
  );
}

function RatingSummary({ reviews }: { reviews: Review[] }) {
  const { averageRating } = inboxSummary([], reviews);
  const counts = STAR_VALUES.map((stars) => ({
    stars,
    count: reviews.filter((review) => review.rating === stars).length,
  }));
  const most = Math.max(1, ...counts.map(({ count }) => count));

  return (
    <section aria-label="Rating summary" className="card lg:sticky lg:top-6">
      <p className="eyebrow">Average review</p>
      <p className="mt-3 text-4xl font-semibold tracking-tight tabular-nums">
        {averageRating === null ? '—' : formatRating(averageRating)}
      </p>
      <p className="mt-1 text-sm text-muted">Out of 5, from {plural(reviews.length, 'review')}.</p>
      <ul aria-label="Reviews by star rating" className="mt-6 grid gap-2.5">
        {counts.map(({ stars, count }) => (
          <li className="grid grid-cols-[4rem_1fr_2rem] items-center gap-3 text-sm" key={stars}>
            <span className="text-muted">{plural(stars, 'star')}</span>
            <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-tint">
              <span
                className="block h-full origin-left animate-grow rounded-full bg-pine"
                style={{ width: `${(count / most) * 100}%` }}
              />
            </span>
            <span className="text-right font-mono tabular-nums">{count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The rating summary and a few review cards in placeholders, while the reviews load.
function ReviewsSkeleton() {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="card">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="mt-3 h-10 w-16" />
        <Skeleton className="mt-1 h-4 w-40" />
        <div className="mt-6 grid gap-2.5">
          {STAR_VALUES.map((stars) => (
            <Skeleton className="h-5" key={stars} />
          ))}
        </div>
      </div>
      <div className="grid gap-4">
        {['w-3/4', 'w-1/2', 'w-2/3'].map((width) => (
          <div className="card" key={width}>
            <div className="flex justify-between gap-6">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className={`mt-4 h-4 ${width}`} />
            <Skeleton className="mt-5 h-4 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReviewsPanel({ state, nameOf }: { state: LiveState<Review>; nameOf: NameOf }) {
  if (state.status !== 'ready') {
    return <LiveStatus skeleton={<ReviewsSkeleton />} state={state} what="reviews" />;
  }

  if (state.items.length === 0) {
    return (
      <StatusPanel
        detail="Borrowers rate the app from 1 to 5 stars in the app. Their reviews show up here, newest first."
        heading="No reviews yet"
      />
    );
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <RatingSummary reviews={state.items} />
      <ul aria-label="Reviews" className="grid gap-4">
        {state.items.map((review) => (
          <li className="card animate-rise" key={review.uid}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Stars rating={review.rating} />
              <time
                className="text-sm whitespace-nowrap text-muted"
                dateTime={review.updatedAt?.toISOString()}
                title={formatDateTime(review.updatedAt)}
              >
                {formatDate(review.updatedAt)}
              </time>
            </div>
            <p className="mt-3 leading-7 break-words whitespace-pre-line">
              {review.comment ?? <span className="text-muted">No comment</span>}
            </p>
            <p className="mt-4 text-sm font-semibold break-words">{nameOf(review.uid)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
