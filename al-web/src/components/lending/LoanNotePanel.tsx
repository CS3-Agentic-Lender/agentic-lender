import { useState } from 'react';
import type { LoanNote } from '../../services/loanFileService';
import { formatDate } from '../../utils/formatters';

interface LoanNotePanelProps {
  note: LoanNote;
  auditTxHash: string | null;
}

const networkLabels: Record<string, string> = {
  localhost: 'Local Hardhat chain',
  amoy: 'Polygon Amoy testnet',
};

export function LoanNotePanel({ note, auditTxHash }: LoanNotePanelProps) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const canCopy = typeof navigator.clipboard?.writeText === 'function';
  const rows = [
    { label: 'Token ID', value: note.tokenId, mono: true },
    { label: 'Network', value: note.network === null ? 'Not recorded' : networkLabels[note.network] ?? note.network },
    { label: 'Mint transaction', value: note.txHash, mono: true, transaction: true, copy: true },
    { label: 'Loan note contract', value: note.contractAddress, mono: true },
    { label: 'Audit hash', value: note.auditHash, mono: true },
    { label: 'Audit registry transaction', value: auditTxHash ?? 'Not recorded', mono: true, transaction: auditTxHash !== null },
    { label: 'Minted', value: formatDate(note.mintedAt) },
  ];

  async function copyMintTransaction() {
    try {
      await navigator.clipboard.writeText(note.txHash);
      setCopyMessage('Mint transaction copied.');
    } catch {
      setCopyMessage('Could not copy. Select and copy the mint transaction manually.');
    }
  }

  return (
    <section aria-label="Loan note" className="mt-6 rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <h2 className="text-xl font-semibold">Loan note</h2>
      <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {rows.map(({ label, value, mono, transaction, copy }) => (
          <div className="min-w-0" key={label}>
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="mt-1">
              <span className={mono ? 'break-all font-mono' : 'break-all'}>{value}</span>
              {copy && canCopy ? (
                <button
                  className="mt-2 block min-h-11 cursor-pointer rounded-lg border border-line bg-neutral px-4 py-2 text-neutral-text transition-colors hover:bg-tint"
                  onClick={() => void copyMintTransaction()}
                  type="button"
                >
                  Copy
                </button>
              ) : null}
              {transaction && note.network === 'amoy' ? (
                <a
                  className="mt-2 block py-2 underline underline-offset-4 hover:opacity-80"
                  href={`https://amoy.polygonscan.com/tx/${value}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  View on Polygonscan
                </a>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {copyMessage ? (
        <p aria-live="polite" className="mt-4 text-sm text-muted" role="status">{copyMessage}</p>
      ) : null}
    </section>
  );
}
