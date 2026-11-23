import { useState } from 'react';
import type { LoanNote } from '../../services/loanFileService';
import { formatDate, loanTypeLabel } from '../../utils/formatters';
import { ChainStage } from './ChainStage';

function shortHash(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

// Transaction hashes on the 3D labels: enough to recognise (0x2e3b + last four), the full hash is in the details.
function shortTx(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

// Polygon Amoy is the only network with a public explorer. Its chain id is in al-core/chain/deployments/amoy.json.
const AMOY_CHAIN_ID = 80002;
const AMOY_EXPLORER = 'https://amoy.polygonscan.com';

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
  const onAmoy = note.network === 'amoy';
  const tx = (hash: string) => `${AMOY_EXPLORER}/tx/${hash}`;
  const rows: {
    label: string;
    value: string;
    mono?: boolean;
    href?: string;
    linkText?: string;
    copy?: boolean;
  }[] = [
    {
      label: 'Token ID',
      value: note.tokenId,
      mono: true,
      href: onAmoy ? `${AMOY_EXPLORER}/token/${note.contractAddress}?a=${encodeURIComponent(note.tokenId)}` : undefined,
      linkText: 'View the token on Polygonscan',
    },
    { label: 'Loan type', value: loanTypeLabel(loanType) ?? 'Not recorded' },
    { label: 'Network', value: note.network === null ? 'Not recorded' : networkLabels[note.network] ?? note.network },
    ...(onAmoy ? [{ label: 'Chain ID', value: String(AMOY_CHAIN_ID), mono: true }] : []),
    { label: 'Mint transaction', value: note.txHash, mono: true, href: onAmoy ? tx(note.txHash) : undefined, linkText: 'View on Polygonscan', copy: true },
    {
      label: 'Loan note contract',
      value: note.contractAddress,
      mono: true,
      href: onAmoy ? `${AMOY_EXPLORER}/address/${note.contractAddress}` : undefined,
      linkText: 'View the contract on Polygonscan',
    },
    { label: 'Audit hash', value: note.auditHash, mono: true },
    {
      label: 'Audit registry transaction',
      value: auditTxHash ?? 'Not recorded',
      mono: true,
      href: onAmoy && auditTxHash !== null ? tx(auditTxHash) : undefined,
      linkText: 'View on Polygonscan',
    },
    { label: 'Minted', value: formatDate(note.mintedAt) },
    ...(note.closedAt !== null || note.closeTxHash !== null
      ? [
          { label: 'Closed', value: formatDate(note.closedAt) },
          {
            label: 'Close transaction',
            value: note.closeTxHash ?? 'Not recorded',
            mono: true,
            href: onAmoy && note.closeTxHash !== null ? tx(note.closeTxHash) : undefined,
            linkText: 'View on Polygonscan',
          },
        ]
      : []),
  ];

  const baseNetwork = note.network === null ? 'Network not recorded' : networkLabels[note.network] ?? note.network;
  // Only Amoy has a known chain id; the local Hardhat chain and unknown networks get no number.
  const network = onAmoy ? `${baseNetwork} · chain ${AMOY_CHAIN_ID}` : baseNetwork;
  const closed = note.closedAt !== null || note.closeTxHash !== null;
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
      <ChainStage
        auditHashShort={shortHash(note.auditHash)}
        auditTxShort={auditTxHash === null ? null : shortTx(auditTxHash)}
        closedLabel={closed ? (note.closedAt ? `Closed ${formatDate(note.closedAt)}` : 'Closed') : null}
        mintTxShort={shortTx(note.txHash)}
        networkLabel={network}
        tokenId={note.tokenId}
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <p className="eyebrow">On the blockchain</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Loan note</h2>
          <p className="mt-1 text-muted">
            Token #{note.tokenId} · {network} · minted {formatDate(note.mintedAt)}
            {closed ? ` · closed${note.closedAt ? ` ${formatDate(note.closedAt)}` : ''}` : null}
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
        {rows.map(({ label, value, mono, href, linkText, copy }) => (
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
              {href ? (
                <a
                  className="mt-2 block py-2 underline underline-offset-4 hover:opacity-80"
                  href={href}
                  rel="noreferrer"
                  target="_blank"
                >
                  {linkText}
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
