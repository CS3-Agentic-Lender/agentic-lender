import { useRef, useState } from 'react';
import { useAuditPackService } from '../../context/AuditPackContext';
import { auditPackFailureMessage, type AuditPack, type AuditPackVerification } from '../../services/auditPackService';
import { auditPackFileName, auditPackRows, toCsv, toPdf } from '../../utils/auditExports';

interface AuditPackActionsProps {
  applicationId: string;
}

type Format = 'pdf' | 'csv';

const buttonClass =
  'min-h-12 cursor-pointer rounded-lg border border-line bg-neutral px-5 py-3 font-semibold text-neutral-text ' +
  'transition-colors hover:bg-tint disabled:cursor-not-allowed disabled:opacity-60';

// What the backend's check found, in words. The hashes are compared on the canonical record by
// al-core, never on the files built here.
export function verificationSummary(verification: AuditPackVerification) {
  const problems: string[] = [];
  if (verification.computed_hash !== verification.stored_hash) {
    problems.push('the record does not match its stored hash');
  }
  if (verification.loan_note_hash !== verification.stored_hash) {
    problems.push('the loan note holds a different hash');
  }
  if (verification.on_chain_checked && verification.on_chain_hash !== verification.stored_hash) {
    problems.push(verification.on_chain_hash === null ? 'the registry holds no hash' : 'the registry holds a different hash');
  }
  if (!verification.calls_match) {
    problems.push('an AI call does not match the record');
  }

  return {
    verified: verification.verified,
    headline: verification.verified
      ? verification.on_chain_checked
        ? 'Verified: the record, the loan note and the registry agree.'
        : 'Verified: the record and the loan note agree.'
      : 'Not verified.',
    problems,
    registryNote: verification.on_chain_checked ? null : 'The registry was not checked.',
  };
}

function download(bytes: BlobPart, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// "Download PDF" and "Download CSV" on a loan file that has a minted note. Both files come from
// one fetch of the audit pack.
export function AuditPackActions({ applicationId }: AuditPackActionsProps) {
  const service = useAuditPackService();
  const [pack, setPack] = useState<AuditPack | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  async function exportPack(format: Format) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setError(null);
    try {
      let current = pack;
      if (current === null) {
        setPending(true);
        current = await service.getAuditPack(applicationId);
        setPack(current);
      }
      const rows = auditPackRows(current);
      if (format === 'csv') {
        download(toCsv(rows), 'text/csv;charset=utf-8', auditPackFileName(applicationId, 'csv'));
      } else {
        const pdf = toPdf(rows, `Audit pack ${applicationId}`);
        download(pdf.slice().buffer, 'application/pdf', auditPackFileName(applicationId, 'pdf'));
      }
    } catch (failure) {
      setError(auditPackFailureMessage(failure));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const summary = pack ? verificationSummary(pack.verification) : null;

  return (
    <section aria-label="Audit pack" className="mt-6 rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <h2 className="text-xl font-semibold">Audit pack</h2>
      <p className="mt-2 text-sm text-muted">
        The decision, the AI evidence and the hashes behind this loan note, as PDF or CSV.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className={buttonClass}
          disabled={pending}
          onClick={() => void exportPack('pdf')}
          type="button"
        >
          Download PDF
        </button>
        <button
          className={buttonClass}
          disabled={pending}
          onClick={() => void exportPack('csv')}
          type="button"
        >
          Download CSV
        </button>
      </div>
      {pending ? (
        <p aria-live="polite" className="mt-4 text-sm text-muted" role="status">
          Preparing the audit pack…
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-lg bg-danger-soft p-3 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      {summary ? (
        <div
          className={`mt-4 rounded-lg p-3 text-sm ${summary.verified ? 'bg-success-soft text-success' : 'bg-danger-soft text-error'}`}
        >
          <p className="font-semibold">{summary.headline}</p>
          {summary.problems.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {summary.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
          {summary.registryNote ? <p className="mt-2">{summary.registryNote}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
