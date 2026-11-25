import { Skeleton, SkeletonCard } from '../../components/Skeleton';

// The loan file's own layout in placeholders: header, timeline, key figures, collateral and valuation, the DTI
// table and the three fact cards.
export function LoanFileSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-4 h-10 w-80 max-w-full" />
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-7 w-32 rounded-full" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="mt-8 h-20 rounded-2xl" />
      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        {[0, 1, 2, 3].map((figure) => (
          <div className="card" key={figure}>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-3 h-8 w-28" />
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <SkeletonCard className="lg:col-span-5" rows={5} />
        <SkeletonCard className="lg:col-span-7" rows={6} />
      </div>
      <SkeletonCard className="mt-5" rows={7} />
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <SkeletonCard rows={6} />
        <SkeletonCard rows={6} />
        <SkeletonCard rows={6} />
      </div>
    </div>
  );
}
