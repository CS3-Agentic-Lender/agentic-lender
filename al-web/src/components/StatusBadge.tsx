import type { ReactNode } from 'react';
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

// A badge in one of the agreed tones. Its text always says what the tone only supports.
export function ToneBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap ${toneClasses[tone]}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <ToneBadge tone={statusTone(status)}>{status}</ToneBadge>;
}
