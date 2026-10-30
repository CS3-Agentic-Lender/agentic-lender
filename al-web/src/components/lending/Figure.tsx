export const UNAVAILABLE = 'Unavailable';

interface FigureProps {
  // Null means the figure is missing or unusable. It is never shown as 0 or a dash.
  value: string | null;
  mono?: boolean;
}

export function Figure({ value, mono = true }: FigureProps) {
  if (value === null) {
    return <span className="text-muted">{UNAVAILABLE}</span>;
  }

  return <span className={mono ? 'font-mono' : undefined}>{value}</span>;
}
