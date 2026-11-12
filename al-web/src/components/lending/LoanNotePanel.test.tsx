import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoanNote } from '../../services/loanFileService';
import { formatDate } from '../../utils/formatters';
import { LoanNotePanel } from './LoanNotePanel';

const note: LoanNote = {
  tokenId: '23', contractAddress: `0x${'AB'.repeat(20)}`, txHash: `0x${'CD'.repeat(32)}`,
  auditHash: 'EF'.repeat(32), network: 'amoy', mintedAt: new Date('2026-10-01T12:00:00Z'),
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
    render(<LoanNotePanel note={note} auditTxHash={auditTxHash} />);
    expect(screen.getByRole('heading', { name: 'Loan note' })).toBeInTheDocument();
    const expected = {
      'Token ID': note.tokenId, Network: 'Polygon Amoy testnet', 'Mint transaction': note.txHash,
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
    render(<LoanNotePanel note={{ ...note, network }} auditTxHash={null} />);
    expect(row('Network')).toHaveTextContent(label!);
    expect(row('Audit registry transaction')).toHaveTextContent('Not recorded');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('does not link a missing audit transaction on Amoy', () => {
    render(<LoanNotePanel note={note} auditTxHash={null} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(row('Audit registry transaction')).toHaveTextContent('Not recorded');
  });

  it('copies the complete mint transaction', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<LoanNotePanel note={note} auditTxHash={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Mint transaction copied.');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(note.txHash);
  });

  it('handles clipboard rejection with manual copy guidance', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('Denied')) });
    render(<LoanNotePanel note={note} auditTxHash={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Could not copy. Select and copy the mint transaction manually.');
  });

  it('keeps the full hash readable without a clipboard API', () => {
    setClipboard(undefined);
    render(<LoanNotePanel note={note} auditTxHash={null} />);
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
    expect(row('Mint transaction')).toHaveTextContent(note.txHash);
  });
});
