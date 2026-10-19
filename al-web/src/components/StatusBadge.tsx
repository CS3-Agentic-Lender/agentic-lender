interface StatusBadgeProps {
  status: string;
}

// Every status uses the neutral tone here; the status-to-tone mapping is set with the pipeline queue.
export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className="inline-flex rounded-full bg-neutral px-3 py-1 text-xs font-medium whitespace-nowrap text-neutral-text">
      {status}
    </span>
  );
}
