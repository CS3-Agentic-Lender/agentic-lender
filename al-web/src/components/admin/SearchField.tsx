import { useEffect, useId, useRef, useState } from 'react';

interface SearchFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange(value: string): void;
}

export const fieldClass =
  'min-h-11 w-full rounded-lg border border-line bg-surface px-4 text-ink transition-colors hover:border-pine/50';

export function SearchField({ label, value, placeholder, onChange }: SearchFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  // The box shows what is typed at once. A list that keeps its search in the URL gets the new value a
  // render later (the router updates in a transition), and a controlled value would snap back and drop
  // fast keystrokes. A change from outside, such as Clear filters, still shows once the box loses focus.
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (document.activeElement !== input.current) {
      setDraft(value);
    }
  }, [value]);

  return (
    <div className="min-w-0 flex-1 sm:max-w-sm">
      <label className="mb-2 block text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted"
          fill="none"
          viewBox="0 0 16 16"
        >
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="m10.5 10.5 3 3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
        </svg>
        <input
          className={`${fieldClass} pl-10`}
          id={id}
          onChange={(event) => {
            setDraft(event.target.value);
            onChange(event.target.value);
          }}
          placeholder={placeholder}
          ref={input}
          type="search"
          value={draft}
        />
      </div>
    </div>
  );
}

// Case- and accent-insensitive, so "siobhan" finds "Siobhán".
export function normaliseSearch(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

export function matchesSearch(query: string, ...fields: Array<string | null | undefined>) {
  const needle = normaliseSearch(query);
  return needle === '' || fields.some((field) => field != null && normaliseSearch(field).includes(needle));
}
