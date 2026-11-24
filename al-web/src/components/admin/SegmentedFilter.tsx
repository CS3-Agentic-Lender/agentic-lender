import { useId } from 'react';

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  count?: number;
}

interface SegmentedFilterProps<V extends string> {
  legend: string;
  options: readonly SegmentOption<V>[];
  value: V;
  onChange(value: V): void;
}

// The same radio group as the pipeline's "Group by", with a count beside each choice.
const optionClass = [
  'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-4 font-medium text-muted transition-colors',
  'hover:bg-tint hover:text-pine has-[:checked]:bg-tint has-[:checked]:text-pine',
  'has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-pine',
].join(' ');

export function SegmentedFilter<V extends string>({ legend, options, value, onChange }: SegmentedFilterProps<V>) {
  const name = useId();

  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <label className={optionClass} key={option.value}>
            <input
              checked={value === option.value}
              className="sr-only"
              name={name}
              onChange={() => onChange(option.value)}
              type="radio"
              value={option.value}
            />
            {option.label}
            {option.count === undefined ? null : (
              <>
                {/* The space keeps the accessible name "Open 2" rather than "Open2"; flex layout ignores it. */}{' '}
                <span className="rounded-full bg-surface px-2 font-mono text-xs tabular-nums">{option.count}</span>
              </>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
