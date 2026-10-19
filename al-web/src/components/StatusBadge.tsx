import { statusTone, type BadgeTone } from '../utils/statusTone';

interface StatusBadgeProps {
  status: string;
}

// Background and text pairs from the badge table in docs/infrastructure.md.
const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-neutral text-neutral-text',
  tint: 'bg-tint text-pine',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-error',
};

// The status is always written out; the tone only supports it.
export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap ${toneClasses[statusTone(status)]}`}
    >
      {status}
    </span>
  );
}
