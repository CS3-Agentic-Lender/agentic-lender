import { useCallback, type ReactNode } from 'react';
import { Link, NavLink, useSearchParams } from 'react-router';
import { AdminPage } from '../../../components/admin/AdminPage';
import { ChartTip, useChartTips, type Tip } from '../../../components/admin/ChartTip';

const sections = [
  { to: '/admin/business', label: 'Overview', end: true },
  { to: '/admin/business/applications', label: 'Applications' },
  { to: '/admin/business/users', label: 'Users' },
  { to: '/admin/business/ai-runs', label: 'AI runs' },
  { to: '/admin/business/audit', label: 'Audit' },
];

const sectionLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'inline-flex min-h-11 items-center rounded-lg px-4 font-medium transition-colors',
    isActive ? 'bg-tint text-pine' : 'text-muted hover:bg-tint hover:text-pine',
  ].join(' ');

// The five read-only business views share one frame and one sub-navigation, in the header's style.
export function BusinessPage({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <AdminPage
      description={description}
      subnav={
        <nav aria-label="Business" className="flex flex-wrap gap-1 border-b border-line pb-3">
          {sections.map((section) => (
            <NavLink className={sectionLinkClass} end={section.end} key={section.to} to={section.to}>
              {section.label}
            </NavLink>
          ))}
        </nav>
      }
      title={title}
    >
      {children}
    </AdminPage>
  );
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

// A list's filters, held in the URL so a link can open the list filtered and back returns to it.
// Changing one replaces the entry instead of adding one, so back leaves the list rather than undoing each keystroke.
export function useUrlFilters() {
  const [params, setParams] = useSearchParams();

  const setFilter = useCallback(
    (name: string, value: string | null) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value) next.set(name, value);
          else next.delete(name);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const clearFilters = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  return { params, setFilter, clearFilters };
}

export interface Bar {
  key: string;
  label: string;
  count: number;
  // Shown after the count, such as a share of the whole.
  note?: string;
  // The filtered list behind the bar, and the link's accessible name.
  to?: string;
  name: string;
  tip: Tip;
}

// A meter list: one row per part, its figure as text and a thin bar against the largest part.
// One hue throughout, since every bar measures the same thing; the label carries the identity.
export function BarList({ label, bars, className = '' }: { label: string; bars: readonly Bar[]; className?: string }) {
  const largest = Math.max(1, ...bars.map((bar) => bar.count));
  const tips = useChartTips();

  return (
    <ul aria-label={label} className={`mt-3 ${className}`}>
      {bars.map((bar, index) => {
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words">{bar.label}</span>
              <span className="shrink-0 font-semibold tabular-nums">
                {bar.count}
                {bar.note ? <span className="ml-1.5 text-sm font-normal text-muted">{bar.note}</span> : null}
              </span>
            </span>
            <span aria-hidden="true" className="mt-2 block h-2 overflow-hidden rounded-full bg-tint">
              <span
                className="block h-full origin-left animate-grow rounded-full bg-pine"
                style={{ width: `${(bar.count / largest) * 100}%`, animationDelay: `${index * 50}ms` }}
              />
            </span>
          </>
        );

        const { tip, trigger } = tips(index, Boolean(bar.to));
        const explained = (
          <>
            {body}
            <ChartTip {...tip} tip={bar.tip} />
          </>
        );

        return (
          <li key={bar.key}>
            {bar.to ? (
              <Link
                aria-label={bar.name}
                className="relative -mx-2 block rounded-lg px-2 py-2.5 transition-colors hover:bg-oat"
                to={bar.to}
                {...trigger}
              >
                {explained}
              </Link>
            ) : (
              // No list to open, but it still explains itself to the keyboard.
              <div aria-label={bar.name} className="relative -mx-2 rounded-lg px-2 py-2.5" role="group" tabIndex={0} {...trigger}>
                {explained}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// A cell's link to a page in the portal, for the row header of a list whose rows open somewhere.
export function RowLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="font-semibold text-ink underline-offset-4 hover:text-pine hover:underline" to={to}>
      {children}
    </Link>
  );
}

export const NONE = <span className="text-muted">—</span>;
