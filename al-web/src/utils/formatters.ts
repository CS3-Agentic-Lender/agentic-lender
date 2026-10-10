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

export function formatEuro(amountEur: number | null) {
  return amountEur === null ? UNAVAILABLE : euro.format(amountEur);
}

// Percentages arrive as whole numbers: 83 means 83%.
export function formatPercent(valuePct: number | null) {
  return valuePct === null ? UNAVAILABLE : `${percent.format(valuePct)}%`;
}

export function formatDate(date: Date | null) {
  return date === null ? UNAVAILABLE : shortDate.format(date);
}
