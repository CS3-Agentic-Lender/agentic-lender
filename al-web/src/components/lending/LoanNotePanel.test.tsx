import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoanNote } from '../../services/loanFileService';
import { formatDate } from '../../utils/formatters';
import { LoanNotePanel } from './LoanNotePanel';

const note: LoanNote = {
  tokenId: '23', contractAddress: `0x${'AB'.repeat(20)}`, txHash: `0x${'CD'.repeat(32)}`,
  auditHash: 'EF'.repeat(32), network: 'amoy', mintedAt: new Date('2026-10-01T12:00:00Z'),
  closedAt: null, closeTxHash: null,
};
const auditTxHash = `0x${'12'.repeat(32)}`;

// jsdom has no navigator.clipboard, so each test defines it and the original is put back after.
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(clipboard: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  } else {
    delete (navigator as { clipboard?: Clipboard }).clipboard;
  }
});

function row(label: string) {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;
}

describe('loan note panel', () => {
  it('shows every stored field with full hashes and separately labelled Amoy links', () => {
    render(<LoanNotePanel note={note} auditTxHash={auditTxHash} loanType="mortgage" />);
    expect(screen.getByRole('heading', { name: 'Loan note' })).toBeInTheDocument();
    const expected = {
      'Token ID': note.tokenId, 'Loan type': 'Mortgage', Network: 'Polygon Amoy testnet', 'Mint transaction': note.txHash,
      'Loan note contract': note.contractAddress, 'Audit hash': note.auditHash,
      'Audit registry transaction': auditTxHash, Minted: formatDate(note.mintedAt),
    };
    for (const [label, value] of Object.entries(expected)) expect(row(label)).toHaveTextContent(value);
    expect(screen.getByText(note.txHash)).toHaveClass('font-mono', 'break-all');
    for (const [label, hash] of [['Mint transaction', note.txHash], ['Audit registry transaction', auditTxHash]]) {
      const link = within(row(label)).getByRole('link', { name: 'View on Polygonscan' });
      expect(link).toHaveAttribute('href', `https://amoy.polygonscan.com/tx/${hash}`);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
    }
  });

  it.each([
    ['localhost', 'Local Hardhat chain'], ['unknown-chain', 'unknown-chain'], [null, 'Not recorded'],
  ])('has no explorer link on network %s', (network, label) => {
    render(<LoanNotePanel note={{ ...note, network }} auditTxHash={null} loanType="mortgage" />);
    expect(row('Network')).toHaveTextContent(label!);
    expect(row('Audit registry transaction')).toHaveTextContent('Not recorded');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it.each([
    ['heloc', 'HELOC'], ['mortgage', 'Mortgage'], ['bridging', 'bridging'], [null, 'Not recorded'],
  ])('shows the application\'s loan type %s on the note', (loanType, label) => {
    render(<LoanNotePanel note={note} auditTxHash={null} loanType={loanType} />);
    expect(row('Loan type')).toHaveTextContent(label);
  });

  it('does not link a missing audit transaction on Amoy', () => {
    render(<LoanNotePanel note={note} auditTxHash={null} loanType="mortgage" />);
    // Mint transaction, token and contract are still linked; only the audit transaction has nothing to link.
    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(within(row('Audit registry transaction')).queryByRole('link')).not.toBeInTheDocument();
    expect(row('Audit registry transaction')).toHaveTextContent('Not recorded');
  });

  it('links the token and the contract on Polygonscan and shows the chain id on Amoy', () => {
    render(<LoanNotePanel note={note} auditTxHash={auditTxHash} loanType="mortgage" />);
    expect(within(row('Token ID')).getByRole('link', { name: 'View the token on Polygonscan' }))
      .toHaveAttribute('href', `https://amoy.polygonscan.com/token/${note.contractAddress}?a=23`);
    expect(within(row('Loan note contract')).getByRole('link', { name: 'View the contract on Polygonscan' }))
      .toHaveAttribute('href', `https://amoy.polygonscan.com/address/${note.contractAddress}`);
    expect(row('Chain ID')).toHaveTextContent('80002');
    expect(screen.getByText(/chain 80002/)).toBeInTheDocument();
  });

  it('shows no chain id for the local Hardhat chain', () => {
    render(<LoanNotePanel note={{ ...note, network: 'localhost' }} auditTxHash={auditTxHash} loanType="mortgage" />);
    expect(screen.queryByText('Chain ID', { selector: 'dt' })).not.toBeInTheDocument();
    expect(screen.queryByText(/chain 80002/)).not.toBeInTheDocument();
  });

  it('shows no Closed row while the note is open', () => {
    render(<LoanNotePanel note={note} auditTxHash={auditTxHash} loanType="mortgage" />);
    expect(screen.queryByText('Closed', { selector: 'dt' })).not.toBeInTheDocument();
    expect(screen.queryByText('Close transaction', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('shows a closed note with its close transaction linked on Amoy', () => {
    const closeTxHash = `0x${'34'.repeat(32)}`;
    const closedAt = new Date('2026-11-05T09:00:00Z');
    render(<LoanNotePanel note={{ ...note, closedAt, closeTxHash }} auditTxHash={auditTxHash} loanType="mortgage" />);
    expect(row('Closed')).toHaveTextContent(formatDate(closedAt));
    expect(row('Close transaction')).toHaveTextContent(closeTxHash);
    expect(within(row('Close transaction')).getByRole('link', { name: 'View on Polygonscan' }))
      .toHaveAttribute('href', `https://amoy.polygonscan.com/tx/${closeTxHash}`);
    expect(screen.getByText(new RegExp(`closed ${formatDate(closedAt)}`))).toBeInTheDocument();
  });

  it('does not link the close transaction off Amoy or when it is not stored', () => {
    const closedAt = new Date('2026-11-05T09:00:00Z');
    const { unmount } = render(<LoanNotePanel note={{ ...note, network: 'localhost', closedAt, closeTxHash: '0xclose' }} auditTxHash={null} loanType="mortgage" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    unmount();
    render(<LoanNotePanel note={{ ...note, closedAt }} auditTxHash={null} loanType="mortgage" />);
    expect(row('Close transaction')).toHaveTextContent('Not recorded');
    expect(within(row('Close transaction')).queryByRole('link')).not.toBeInTheDocument();
  });
  it('copies the complete mint transaction', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<LoanNotePanel note={note} auditTxHash={null} loanType="mortgage" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Mint transaction copied.');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(note.txHash);
  });

  it('handles clipboard rejection with manual copy guidance', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('Denied')) });
    render(<LoanNotePanel note={note} auditTxHash={null} loanType="mortgage" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Could not copy. Select and copy the mint transaction manually.');
  });

  it('keeps the full hash readable without a clipboard API', () => {
    setClipboard(undefined);
    render(<LoanNotePanel note={note} auditTxHash={null} loanType="mortgage" />);
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
    expect(row('Mint transaction')).toHaveTextContent(note.txHash);
  });
});
