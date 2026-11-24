const UNAVAILABLE = '—';

const euro = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat('en-IE', { maximumFractionDigits: 1 });

const shortDate = new Intl.DateTimeFormat('en-IE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const loanTypeLabels: Record<string, string> = { mortgage: 'Mortgage', heloc: 'HELOC' };

// The stored loanType as a label. An unknown type is shown as stored; a missing one is null, so each screen words it.
export function loanTypeLabel(loanType: string | null) {
  return loanType ? loanTypeLabels[loanType] ?? loanType : null;
}

export function formatEuro(amountEur: number | null) {
  return amountEur === null ? UNAVAILABLE : euro.format(amountEur);
}

export function signedEuro(amountEur: number) {
  const sign = amountEur < 0 ? '−' : amountEur > 0 ? '+' : '';

  return `${sign}${formatEuro(Math.abs(amountEur))}`;
}

// Percentages arrive as whole numbers: 83 means 83%.
export function formatPercent(valuePct: number | null) {
  return valuePct === null ? UNAVAILABLE : `${percent.format(valuePct)}%`;
}

export function formatDate(date: Date | null) {
  return date === null ? UNAVAILABLE : shortDate.format(date);
}

const rating = new Intl.NumberFormat('en-IE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// An average star rating, to one decimal: 4.5.
export function formatRating(value: number) {
  return rating.format(value);
}

// "1 review", "3 reviews".
export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

const dateTime = new Intl.DateTimeFormat('en-IE', { dateStyle: 'medium', timeStyle: 'short' });
const relative = new Intl.RelativeTimeFormat('en-IE', { numeric: 'auto' });

export function formatDateTime(date: Date | null) {
  return date === null ? UNAVAILABLE : dateTime.format(date);
}

// "5 minutes ago", "yesterday"; past a week the date itself reads better.
export function formatRelative(date: Date | null, now: Date = new Date()) {
  if (date === null) {
    return UNAVAILABLE;
  }

  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);

  if (Math.abs(seconds) < 60) {
    return 'just now';
  }

  if (Math.abs(minutes) < 60) {
    return relative.format(minutes, 'minute');
  }

  if (Math.abs(hours) < 24) {
    return relative.format(hours, 'hour');
  }

  return Math.abs(days) <= 7 ? relative.format(days, 'day') : formatDate(date);
}
