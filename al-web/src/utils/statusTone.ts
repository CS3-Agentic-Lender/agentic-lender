import { APPLICATION_STATUSES } from '../services/clientsService';

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

// Four of the five badge tones in docs/infrastructure.md; no lifecycle status uses the Pine tone.
export type BadgeTone = 'neutral' | 'tint' | 'success' | 'danger';

// The portal's own status-to-tone mapping. It is the single place a status picks a colour.
const statusTones: Record<ApplicationStatus, BadgeTone> = {
  Draft: 'neutral',
  Applied: 'neutral',
  'AI Deliberated': 'tint',
  'Underwriter Approved': 'success',
  Declined: 'danger',
  Funded: 'success',
  Closed: 'neutral',
};

export function isApplicationStatus(status: string): status is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(status);
}

// A status outside the agreed list keeps the neutral tone instead of borrowing a meaning.
export function statusTone(status: string): BadgeTone {
  return isApplicationStatus(status) ? statusTones[status] : 'neutral';
}
