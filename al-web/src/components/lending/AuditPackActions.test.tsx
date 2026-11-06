import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditPackServiceContext } from '../../context/AuditPackContext';
import { ApiError } from '../../services/apiClient';
import type { AuditPack, AuditPackService } from '../../services/auditPackService';
import { AuditPackActions, verificationSummary } from './AuditPackActions';

const verification = {
  computed_hash: 'h', stored_hash: 'h', loan_note_hash: 'h', on_chain_hash: 'h',
  on_chain_checked: true, calls_match: true, verified: true,
};

const pack: AuditPack = {
  application_id: 'app-funded',
  audit_hash: 'h',
  record: { applicationId: 'app-funded', riskTier: 'A' },
  application: { id: 'app-funded', status: 'Funded' },
  valuation: null,
  affordability: null,
  policy_gate: null,
  agent_calls: [],
  audit_tx_hash: '0xaudit',
  verification,
};

let created: Blob[] = [];
let names: string[] = [];

beforeEach(() => {
  created = [];
  names = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    created.push(blob);
    return `blob:${created.length}`;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderActions(getAuditPack: AuditPackService['getAuditPack']) {
  return render(
    <AuditPackServiceContext.Provider value={{ getAuditPack }}>
      <AuditPackActions applicationId="app-funded" />
    </AuditPackServiceContext.Provider>,
  );
}

describe('audit pack actions', () => {
  it('fetches the pack once for both downloads and names the files after the application', async () => {
    const getAuditPack = vi.fn<AuditPackService['getAuditPack']>().mockResolvedValue(pack);
    renderActions(getAuditPack);

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download CSV' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download PDF' })));

    expect(getAuditPack).toHaveBeenCalledExactlyOnceWith('app-funded');
    expect(names).toEqual(['audit-pack-app-funded.csv', 'audit-pack-app-funded.pdf']);
    expect(created.map((blob) => blob.type)).toEqual(['text/csv;charset=utf-8', 'application/pdf']);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(await created[0].text()).toContain('record,riskTier,A');
    expect(await created[1].text()).toMatch(/^%PDF-1\.4/);
  });

  it('disables both buttons and says it is preparing while the pack loads', async () => {
    let resolve!: (value: AuditPack) => void;
    const getAuditPack = vi.fn<AuditPackService['getAuditPack']>(() => new Promise((done) => { resolve = done; }));
    renderActions(getAuditPack);

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(screen.getByRole('status')).toHaveTextContent('Preparing the audit pack…');
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await act(async () => resolve(pack));

    expect(getAuditPack).toHaveBeenCalledOnce();
    expect(names).toEqual(['audit-pack-app-funded.pdf']);
  });

  it('shows the backend verification once fetched', async () => {
    renderActions(vi.fn<AuditPackService['getAuditPack']>().mockResolvedValue(pack));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download CSV' })));

    expect(screen.getByText('Verified: the record, the loan note and the registry agree.')).toBeInTheDocument();
  });

  it.each([
    [new ApiError('http', 'not yet', 409), 'The audit pack is available once the loan note is minted.'],
    [new ApiError('http', 'Forbidden', 403), 'You are not allowed to download this audit pack.'],
    [new ApiError('network', 'offline'), 'Could not reach the server. Check your connection and try again.'],
  ])('shows an error and downloads nothing for %s', async (error, message) => {
    renderActions(vi.fn<AuditPackService['getAuditPack']>().mockRejectedValue(error));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download PDF' })));

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(names).toEqual([]);
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  });
});

describe('verification summary', () => {
  it('says the registry was not checked without calling that a failure', () => {
    expect(verificationSummary({ ...verification, on_chain_hash: null, on_chain_checked: false })).toEqual({
      verified: true,
      headline: 'Verified: the record and the loan note agree.',
      problems: [],
      registryNote: 'The registry was not checked.',
    });
  });

  it('lists every check that failed', () => {
    expect(verificationSummary({
      computed_hash: 'x', stored_hash: 'h', loan_note_hash: 'y', on_chain_hash: null,
      on_chain_checked: true, calls_match: false, verified: false,
    })).toEqual({
      verified: false,
      headline: 'Not verified.',
      problems: [
        'the record does not match its stored hash',
        'the loan note holds a different hash',
        'the registry holds no hash',
        'an AI call does not match the record',
      ],
      registryNote: null,
    });
  });
});
