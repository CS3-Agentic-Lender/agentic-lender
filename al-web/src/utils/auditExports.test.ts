import { describe, expect, it } from 'vitest';
import type { AuditPack } from '../services/auditPackService';
import { auditPackFileName, auditPackRows, toCsv, toPdf, type AuditRow } from './auditExports';

const samplePack: AuditPack = {
  application_id: 'app-funded',
  audit_hash: '958ef19ff62cd11c37ca79651d8d57084404f24a9a208198bd8b8de9b144aa2b',
  record: {
    aiCalls: [{ id: 'call-1', sha256: 'aa11' }, { id: 'call-2', sha256: 'bb22' }],
    applicationId: 'app-funded',
    creditMemo: 'Strong income, "low" risk, approve.\nNo exceptions.',
    decision: 'approved',
    loanType: 'mortgage',
    principalCents: 29000000,
    riskTier: 'A',
    signedOffAt: '2026-09-18T11:00:00.000Z',
    termMonths: 360,
    underwriterId: 'underwriter1',
  },
  application: {
    id: 'app-funded',
    status: 'Funded',
    loan_amount_eur: 290000,
    decision: { outcome: 'approved', underwriter_id: 'underwriter1', decided_at: '2026-09-18T11:00:00Z', reason: 'Within limits, comfortable DTI.' },
    loan_note: { token_id: '1', tx_hash: '0xmint', network: 'localhost' },
  },
  valuation: { estimatedValueEur: 366000, supportWarnings: ['Few sample homes', 'Unseen area'] },
  affordability: { dtiPct: 21.6, dtiBand: 'Comfortable' },
  policy_gate: null,
  agent_calls: [
    { id: 'call-1', agent: 'strategist', provider: 'gemini', model: 'gemini-3.1-flash-lite', output: 'Approve, €290,000', created_at: '2026-09-18T10:00:00Z', sha256: 'aa11', matches: true },
  ],
  audit_tx_hash: '0xaudit',
  verification: {
    computed_hash: 'h', stored_hash: 'h', loan_note_hash: 'h', on_chain_hash: 'h',
    on_chain_checked: true, calls_match: true, verified: true,
  },
};

function find(rows: AuditRow[], section: string, field: string) {
  return rows.find((row) => row.section === section && row.field === field)?.value;
}

describe('audit pack rows', () => {
  it('lists every field of the pack, one per row, with values exactly as received', () => {
    const rows = auditPackRows(samplePack);
    const fields = rows.map(({ section, field }) => `${section}/${field}`);

    expect(fields).toEqual([
      'pack/application_id', 'pack/audit_hash', 'pack/audit_tx_hash',
      'verification/computed_hash', 'verification/stored_hash', 'verification/loan_note_hash',
      'verification/on_chain_hash', 'verification/on_chain_checked', 'verification/calls_match', 'verification/verified',
      'application/id', 'application/status', 'application/loan_amount_eur',
      'application/decision.outcome', 'application/decision.underwriter_id', 'application/decision.decided_at',
      'application/decision.reason',
      'application/loan_note.token_id', 'application/loan_note.tx_hash', 'application/loan_note.network',
      'valuation/estimatedValueEur', 'valuation/supportWarnings',
      'affordability/dtiPct', 'affordability/dtiBand',
      'policy_gate/stored',
      'record/aiCalls.1.id', 'record/aiCalls.1.sha256', 'record/aiCalls.2.id', 'record/aiCalls.2.sha256',
      'record/applicationId', 'record/creditMemo', 'record/decision', 'record/loanType', 'record/principalCents',
      'record/riskTier', 'record/signedOffAt', 'record/termMonths', 'record/underwriterId',
      'agent_call/1.id', 'agent_call/1.agent', 'agent_call/1.provider', 'agent_call/1.model', 'agent_call/1.output',
      'agent_call/1.created_at', 'agent_call/1.sha256', 'agent_call/1.matches',
    ]);
    expect(new Set(fields).size).toBe(fields.length);
    expect(find(rows, 'record', 'principalCents')).toBe('29000000');
    expect(find(rows, 'affordability', 'dtiPct')).toBe('21.6');
    expect(find(rows, 'valuation', 'supportWarnings')).toBe('Few sample homes; Unseen area');
    expect(find(rows, 'policy_gate', 'stored')).toBe('Not stored');
    expect(find(rows, 'verification', 'verified')).toBe('true');
  });

  it('says a missing audit transaction is not recorded instead of leaving a blank', () => {
    expect(find(auditPackRows({ ...samplePack, audit_tx_hash: null }), 'pack', 'audit_tx_hash')).toBe('Not recorded');
  });
});

describe('audit pack CSV', () => {
  const csv = toCsv(auditPackRows(samplePack));

  it('has a byte order mark, a header and one CRLF-terminated line per field', () => {
    expect(csv.startsWith('﻿section,field,value\r\n')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    // The credit memo holds a quoted line break, so count records rather than raw lines.
    const records = csv.slice(1).match(/(?:"(?:[^"]|"")*"|[^,\r\n]*)(?:,(?:"(?:[^"]|"")*"|[^,\r\n]*))*\r\n/g)!;
    expect(records).toHaveLength(auditPackRows(samplePack).length + 1);
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(csv).toContain('record,creditMemo,"Strong income, ""low"" risk, approve.\nNo exceptions."\r\n');
    expect(csv).toContain('agent_call,1.output,"Approve, €290,000"\r\n');
    expect(csv).toContain('record,decision,approved\r\n');
  });
});

describe('audit pack PDF', () => {
  function text(bytes: Uint8Array) {
    return new TextDecoder().decode(bytes);
  }

  it('is a well-formed PDF whose xref offsets point at each object', () => {
    const pdf = text(toPdf(auditPackRows(samplePack), 'Audit pack app-funded'));

    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    offsets.forEach((offset, index) => expect(pdf.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true));
    expect(/[^\x00-\x7f]/.test(pdf)).toBe(false);
  });

  it('holds the title and the same values as the CSV, with brackets escaped and the euro sign in WinAnsi', () => {
    const rows = auditPackRows({ ...samplePack, application: { ...samplePack.application, note: 'Rate (fixed) 4%' } });
    const pdf = text(toPdf(rows, 'Audit pack app-funded'));

    expect(pdf).toContain('(Audit pack app-funded)');
    expect(pdf).toContain('958ef19ff62cd11c37ca79651d8d57084404f24a9a208198bd8b8de9b144aa2b');
    expect(pdf).toContain('Rate \\(fixed\\) 4%');
    expect(pdf).toContain('Approve, \\200290,000');
  });

  it('wraps long values and adds pages for a long pack', () => {
    const many = Array.from({ length: 200 }, (_, index) => ({ section: 'record', field: `f${index}`, value: 'x'.repeat(300) }));
    const pdf = text(toPdf(many, 'Long'));

    expect(Number(/\/Count (\d+)/.exec(pdf)![1])).toBeGreaterThan(5);
    expect(pdf).toContain('Page 1 of');
    expect(pdf).not.toMatch(/\(record \/ f0: x{120}/);
  });
});

describe('audit pack file names', () => {
  it('names both formats after the application', () => {
    expect(auditPackFileName('app-funded', 'csv')).toBe('audit-pack-app-funded.csv');
    expect(auditPackFileName('app/funded', 'pdf')).toBe('audit-pack-app_funded.pdf');
  });
});
