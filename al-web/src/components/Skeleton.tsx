// Placeholders in the shape of content that is still loading, so a panel never sits blank and nothing jumps when
// the data arrives. They are hidden from assistive technology: the region holding them says what is loading.
// The shimmer stops under prefers-reduced-motion.

// Line widths cycled through so a block of placeholder text reads as text rather than a grid of bars.
const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/12', 'w-7/12'];

// One placeholder. Size and shape come from className (h-*, w-*, rounded-*); it is a block unless told otherwise.
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton block ${className}`} data-skeleton="" />;
}

// The frame of a data table: a header row, then `rows` rows of `columns` cells.
export function SkeletonTable({ columns, rows = 5 }: { columns: number; rows?: number }) {
  const cells = Array.from({ length: columns }, (_, column) => column);
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex gap-6 bg-oat px-4 py-3.5">
        {cells.map((column) => <Skeleton className="h-3 flex-1" key={column} />)}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div className="flex items-center gap-6 border-t border-line px-4 py-4" key={row}>
          {cells.map((column) => (
            <div className="flex-1" key={column}>
              <Skeleton className={`h-4 ${widths[(row + column) % widths.length]}`} />
              {column === 0 ? <Skeleton className="mt-2 h-3 w-1/3" /> : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// A card with a title and `rows` label and value lines: the shape of most portal panels.
export function SkeletonCard({ rows = 4, className = '' }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={`card ${className}`}>
      <Skeleton className="h-5 w-40" />
      <div className="mt-5 space-y-4">
        {Array.from({ length: rows }, (_, row) => (
          <div className="flex items-center justify-between gap-6" key={row}>
            <Skeleton className={`h-3.5 ${widths[row % widths.length]} max-w-48`} />
            <Skeleton className="h-3.5 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
