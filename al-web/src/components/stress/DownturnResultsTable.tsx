import { Link } from 'react-router';
import type { DownturnApplication, LtvFigures } from '../../services/stressService';
import { formatEuro } from '../../utils/formatters';
import { loanFilePath } from '../../pages/underwriter/PipelinePage';

export const downturnRowId = (id: string) => `downturn-row-${id}`;
const pct = (value: number) => `${value.toFixed(2)}%`;
const flag = (value: boolean) => value ? 'Yes' : 'No';
const flags = (value: LtvFigures) => `Above 80%: ${flag(value.above_80)}; Above 90%: ${flag(value.above_90)}`;
const heading = 'bg-oat px-3 py-3 text-left align-top font-mono text-base font-medium text-muted';
const cell = 'px-3 py-3 align-top break-words';

export function DownturnResultsTable({ applications, crossing = false }: { applications: DownturnApplication[]; crossing?: boolean }) {
  const columns = crossing ? ['Application', 'Before LTV', 'After LTV'] : ['Application', 'Before LTV', 'After LTV', 'Starting value', 'Value after fall', 'Value used', 'Flags before / after'];
  return <table className="shock-table mt-4 w-full table-fixed border-collapse text-base">
    <caption className="sr-only">{crossing ? 'Loans crossing 90% LTV' : 'House price fall results per application'}</caption>
    <thead><tr>{columns.map((name) => <th key={name} scope="col" className={heading}>{name}</th>)}</tr></thead>
    <tbody>{applications.map((entry) => <tr key={entry.application_id}
      id={crossing ? undefined : downturnRowId(entry.application_id)}
      className={`scroll-mt-24 border-t border-line transition-[background-color,box-shadow] duration-500 data-[picked=true]:bg-brass/22 data-[picked=true]:shadow-[inset_4px_0_0_var(--color-brass)] ${entry.after.above_90 ? 'bg-danger-soft/55' : ''}`}>
      <th scope="row" className={`${cell} text-left font-normal`}><Link className="inline-flex min-h-11 max-w-full items-center font-mono font-semibold text-pine underline underline-offset-4" to={loanFilePath(entry.application_id)}>{entry.application_id}</Link><span className="block text-muted">{entry.loan_type === 'heloc' ? 'HELOC (combined LTV)' : 'Mortgage'}</span></th>
      <td data-label="Before LTV" className={`${cell} font-mono`}>{pct(entry.before.ltv_pct)}</td>
      <td data-label="After LTV" className={`${cell} font-mono ${entry.after.above_90 ? 'text-error' : ''}`}>{pct(entry.after.ltv_pct)}</td>
      {!crossing ? <>
        <td data-label="Starting value" className={cell}>{formatEuro(entry.starting_value_eur)}</td>
        <td data-label="Value after fall" className={cell}>{formatEuro(entry.after.property_value_eur)}</td>
        <td data-label="Value used" className={cell}>{entry.value_basis === 'asking_price' ? 'Asking price' : 'Model estimate'}</td>
        <td data-label="Flags before / after" className={cell}><span><span className="block">Before: {flags(entry.before)}</span><span className="mt-2 block">After: {flags(entry.after)}</span></span></td>
      </> : null}
    </tr>)}</tbody>
  </table>;
}
