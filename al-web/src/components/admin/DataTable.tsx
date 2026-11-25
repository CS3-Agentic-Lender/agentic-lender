import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

export type SortDirection = 'asc' | 'desc';
export type SortValue = string | number | null;

export interface Column<T> {
  id: string;
  header: string;
  cell(row: T): ReactNode;
  // A column with a sort value can be sorted by its header.
  sortValue?(row: T): SortValue;
  // The row's heading: a row header cell, shown first and unlabelled when rows become cards.
  primary?: boolean;
  className?: string;
}

interface DataTableProps<T> {
  caption: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey(row: T): string;
  defaultSort?: { column: string; direction: SortDirection };
  // Where a click anywhere on the row goes, if anywhere. The primary cell should hold a link to the
  // same place for keyboard and screen-reader users.
  rowHref?(row: T): string | undefined;
  // Shown in place of the rows when there are none.
  empty: ReactNode;
}

// Nulls sort last in either direction: a missing value is never the "smallest".
export function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection) {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1;
  }

  const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
  return direction === 'asc' ? order : -order;
}

const headerCellClass = 'px-4 py-3 text-left text-xs font-semibold tracking-wide text-muted uppercase';
// Below md each row is a card: the cells stack, each labelled from its column header.
const cellClass = [
  'px-4 py-3 align-middle text-sm',
  'max-md:flex max-md:min-w-0 max-md:items-baseline max-md:justify-between max-md:gap-4 max-md:p-0 max-md:text-right',
  'max-md:before:shrink-0 max-md:before:text-left max-md:before:text-xs max-md:before:font-medium max-md:before:text-muted max-md:before:content-[attr(data-label)]',
].join(' ');
const primaryCellClass = 'px-4 py-3 text-left align-middle font-normal max-md:p-0';

function SortIcon({ direction }: { direction: SortDirection | null }) {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 16 16">
      <path
        d="M5 6.5 8 3.5l3 3"
        opacity={direction === 'desc' ? 0.3 : 1}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M5 9.5 8 12.5l3-3"
        opacity={direction === 'asc' ? 0.3 : 1}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

// A sortable table that turns into a list of cards on small screens, so no page scrolls sideways.
// The explicit roles keep the table semantics that the card layout's CSS would otherwise drop.
export function DataTable<T>({ caption, columns, rows, rowKey, defaultSort, rowHref, empty }: DataTableProps<T>) {
  const navigate = useNavigate();
  const [sort, setSort] = useState(defaultSort ?? null);
  const sortColumn = sort ? columns.find((column) => column.id === sort.column) : undefined;

  const sorted = useMemo(() => {
    if (!sort || !sortColumn?.sortValue) {
      return rows;
    }

    const value = sortColumn.sortValue;
    return [...rows].sort((a, b) => compareSortValues(value(a), value(b), sort.direction));
  }, [rows, sort, sortColumn]);

  function toggleSort(column: string) {
    setSort((current) =>
      current?.column === column
        ? { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'asc' },
    );
  }

  function openRow(event: MouseEvent<HTMLTableRowElement>, href: string) {
    const target = event.target as HTMLElement;

    if (target.closest('a, button, input, select') || window.getSelection()?.toString()) {
      return;
    }

    navigate(href);
  }

  if (rows.length === 0) {
    return <>{empty}</>;
  }

  return (
    <div className="md:overflow-x-auto md:rounded-2xl md:border md:border-line md:bg-surface md:shadow-card">
      <table className="w-full border-collapse" role="table">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-oat max-md:sr-only" role="rowgroup">
          <tr role="row">
            {columns.map((column) => {
              const direction = sort?.column === column.id ? sort.direction : null;

              return (
                <th
                  aria-sort={
                    column.sortValue ? (direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none') : undefined
                  }
                  className={`${headerCellClass} ${column.className ?? ''}`}
                  key={column.id}
                  role="columnheader"
                  scope="col"
                >
                  {column.sortValue ? (
                    <button
                      className="-mx-1 inline-flex min-h-8 cursor-pointer items-center gap-1 rounded px-1 uppercase transition-colors hover:text-pine"
                      onClick={() => toggleSort(column.id)}
                      type="button"
                    >
                      {column.header}
                      <SortIcon direction={direction} />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="max-md:grid max-md:gap-3" role="rowgroup">
          {sorted.map((row) => {
            const href = rowHref?.(row);

            return (
              <tr
                className={[
                  'border-t border-line transition-colors',
                  'max-md:grid max-md:gap-2.5 max-md:rounded-2xl max-md:border max-md:bg-surface max-md:p-4 max-md:shadow-card',
                  href ? 'cursor-pointer hover:bg-oat' : '',
                ].join(' ')}
                key={rowKey(row)}
                onClick={href ? (event) => openRow(event, href) : undefined}
                role="row"
              >
                {columns.map((column) =>
                  column.primary ? (
                    <th className={`${primaryCellClass} ${column.className ?? ''}`} key={column.id} role="rowheader" scope="row">
                      {column.cell(row)}
                    </th>
                  ) : (
                    <td className={`${cellClass} ${column.className ?? ''}`} data-label={column.header} key={column.id} role="cell">
                      {column.cell(row)}
                    </td>
                  ),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
