import { Figure } from './Figure';

export interface KeyFigure {
  label: string;
  // Null is a missing figure and reads Unavailable, as everywhere else in the file.
  value: string | null;
  note?: string | null;
}

// The few stored figures an underwriter looks for first. Every value is passed in already
// formatted from the application or its review; nothing is worked out here.
export function KeyFigures({ figures }: { figures: KeyFigure[] }) {
  return (
    <section aria-label="Key figures">
      <dl className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        {figures.map(({ label, value, note }) => (
          <div
            className="card flex flex-col transition-[transform,box-shadow] duration-300 ease-out hover:shadow-raised hover:[transform:perspective(900px)_rotateX(6deg)_translateY(-3px)]"
            key={label}
          >
            <dt className="text-sm font-medium text-muted">{label}</dt>
            <dd className="mt-2 text-2xl font-semibold tracking-tight tabular-nums sm:text-[1.75rem] sm:leading-9">
              <Figure mono={false} value={value} />
            </dd>
            {note ? <dd className="mt-1 text-sm text-muted">{note}</dd> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
