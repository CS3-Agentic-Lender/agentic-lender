import { useState } from 'react';
import type { LoanNote } from '../../services/loanFileService';
import { formatDate, loanTypeLabel } from '../../utils/formatters';
import { ChainStage } from './ChainStage';

function shortHash(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

interface LoanNotePanelProps {
  note: LoanNote;
  auditTxHash: string | null;
  // The application's own loanType: the mint puts it on the note, and the stored loanNote map has no copy.
  loanType: string | null;
}

export const networkLabels: Record<string, string> = {
  localhost: 'Local Hardhat chain',
  amoy: 'Polygon Amoy testnet',
};

export function LoanNotePanel({ note, auditTxHash, loanType }: LoanNotePanelProps) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const canCopy = typeof navigator.clipboard?.writeText === 'function';
  const rows = [
    { label: 'Token ID', value: note.tokenId, mono: true },
    { label: 'Loan type', value: loanTypeLabel(loanType) ?? 'Not recorded' },
    { label: 'Network', value: note.network === null ? 'Not recorded' : networkLabels[note.network] ?? note.network },
    { label: 'Mint transaction', value: note.txHash, mono: true, transaction: true, copy: true },
    { label: 'Loan note contract', value: note.contractAddress, mono: true },
    { label: 'Audit hash', value: note.auditHash, mono: true },
    { label: 'Audit registry transaction', value: auditTxHash ?? 'Not recorded', mono: true, transaction: auditTxHash !== null },
    { label: 'Minted', value: formatDate(note.mintedAt) },
  ];

  const network = note.network === null ? 'Network not recorded' : networkLabels[note.network] ?? note.network;
  // What the note means, in the words of the two contracts (al-core/chain/contracts/LoanNote.sol and
  // AuditRegistry.sol). The portal does not re-check the hash itself; the audit pack does.
  const points = [
    {
      title: 'The loan is recorded as one token',
      detail: 'Its principal, APR, term and type are on-chain. The bank holds the note and it can’t be transferred.',
    },
    {
      title: 'The decision’s fingerprint can’t be changed',
      detail: `Its SHA-256 hash (${shortHash(note.auditHash)}) is written once to the audit registry. The audit pack checks the stored record against it.`,
    },
    {
      title: 'No personal data on-chain',
      detail: 'The borrower and the application appear only as hashes.',
    },
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
    <section aria-label="Loan note" className="card mt-5">
      <ChainStage auditHashShort={shortHash(note.auditHash)} networkLabel={network} tokenId={note.tokenId} />
      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <p className="eyebrow">On the blockchain</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Loan note</h2>
          <p className="mt-1 text-muted">
            Token #{note.tokenId} · {network} · minted {formatDate(note.mintedAt)}
          </p>
        </div>
        <div className="lg:col-span-8">
          <ul className="grid gap-4 sm:grid-cols-3">
            {points.map(({ title, detail }) => (
              <li className="flex gap-3 sm:flex-col sm:gap-2" key={title}>
                <span aria-hidden="true" className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-tint text-pine">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 14 14">
                    <path d="M3 7.4 5.8 10 11 4.4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  </svg>
                </span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm leading-6 text-muted">{detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <h3 className="mt-6 border-t border-line/70 pt-5 font-semibold">On-chain details</h3>
      <dl className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {rows.map(({ label, value, mono, transaction, copy }) => (
          <div className="min-w-0" key={label}>
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="mt-1">
              <span className={mono ? 'break-all font-mono' : 'break-all'}>{value}</span>
              {copy && canCopy ? (
                <button
                  className="btn btn-secondary mt-2"
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
