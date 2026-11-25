import { Skeleton } from '../Skeleton';

export const UNAVAILABLE = 'Unavailable';

// A figure whose source is still being read: drawn as a placeholder and announced as Loading.
export const PENDING = Symbol('pending');

// Null means the figure is missing or unusable. It is never shown as 0 or a dash.
export type FigureValue = string | null | typeof PENDING;

interface FigureProps {
  value: FigureValue;
  mono?: boolean;
}

export function Figure({ value, mono = true }: FigureProps) {
  if (value === PENDING) {
    return (
      <>
        <Skeleton className="inline-block h-[0.9em] w-[5ch] align-middle" />
        <span className="sr-only">Loading</span>
      </>
    );
  }

  if (value === null) {
    return <span className="text-muted">{UNAVAILABLE}</span>;
  }

  return <span className={mono ? 'font-mono' : undefined}>{value}</span>;
}
