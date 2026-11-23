import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { PortalHeader } from '../../components/PortalHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { AuditPackActions } from '../../components/lending/AuditPackActions';
import { CommitteeConsole } from '../../components/lending/CommitteeConsole';
import { DtiBreakdown } from '../../components/lending/DtiBreakdown';
import { Figure } from '../../components/lending/Figure';
import { HelocCollateral } from '../../components/lending/HelocCollateral';
import { MortgageCollateral } from '../../components/lending/MortgageCollateral';
import { LoanNotePanel } from '../../components/lending/LoanNotePanel';
import { MessageBorrower } from '../../components/messaging/MessageBorrower';
import { SignOffPanel, decisionLabels } from '../../components/lending/SignOffPanel';
import type { DecisionResult } from '../../services/decisionService';
import { KeyFigures } from '../../components/lending/KeyFigures';
import { StatusTimeline } from '../../components/lending/StatusTimeline';
import { ValuationBreakdown } from '../../components/lending/ValuationBreakdown';
import { useLoanFile, type LoanFileState } from '../../context/LoanFileContext';
import { useSettlementService } from '../../context/SettlementContext';
import { mintFailureMessage } from '../../services/settlementService';
import {
  loanFileRiskTier,
  type LoanFileApplication,
  type LoanFileReview,
} from '../../services/loanFileService';
import { formatDate, formatEuro, formatPercent, loanTypeLabel } from '../../utils/formatters';
import { INVALID_RISK_TIER, applicationLtvBand, formatLtv, NO_LTV, NO_LTV_FIGURE } from '../underwriter/pipelineGroups';

export type LoanFileViewer = 'broker' | 'underwriter';

interface LoanFilePageProps {
  viewer: LoanFileViewer;
}

interface Fact {
  label: string;
  unit?: string;
  value: string | null;
  mono?: boolean;
}

const backLinkClass =
  'group inline-flex min-h-11 items-center gap-2 font-medium text-pine underline-offset-4 hover:underline';
const sectionClass = 'card';

// Blocks of the file settle in one after another; reduced motion switches the animation off.
function stagger(step: number) {
  return { animationDelay: `${step * 70}ms` };
}

function euro(value: number | null) {
  return value === null ? null : formatEuro(value);
}

function count(value: number | null, unit = '') {
  return value === null ? null : `${new Intl.NumberFormat('en-IE').format(value)}${unit}`;
}

function date(value: Date | null) {
  return value === null ? null : formatDate(value);
}

function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="mt-3 divide-y divide-line/70">
      {facts.map(({ label, unit, value, mono }) => (
        <div className="flex items-baseline justify-between gap-4 py-2.5" key={label}>
          <dt className="min-w-0 text-sm text-muted">
            {label}
            {unit ? <span>, {unit}</span> : null}
          </dt>
          <dd className="max-w-[62%] text-right break-words tabular-nums">
            <Figure mono={mono} value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FactSection({ title, facts }: { title: string; facts: Fact[] }) {
  return (
    <section aria-label={title} className={sectionClass}>
      <h2 className="card-title">{title}</h2>
      <FactList facts={facts} />
    </section>
  );
}

function decisionText(application: LoanFileApplication) {
  const { decision } = application;

  if (decision === null) {
    return 'Not decided yet';
  }

  if (decision.outcome === null || decision.outcome === 'invalid') {
    return null;
  }

  const outcome = decision.outcome === 'approved' ? 'Approved' : 'Declined';

  return decision.decidedAt ? `${outcome} on ${formatDate(decision.decidedAt)}` : outcome;
}

function riskTierText(application: LoanFileApplication, review: LoanFileReview) {
  const tier = loanFileRiskTier(application, review);

  return tier === 'invalid' ? INVALID_RISK_TIER : tier;
}

function ltvText(application: LoanFileApplication) {
  const figure = formatLtv(application.ltvPct);

  return figure === NO_LTV_FIGURE ? null : figure;
}

function ltvBandText(application: LoanFileApplication) {
  // Only a stored band is shown here; the queue's valuation fallback is not a stored figure.
  if (application.ltvBand == null) {
    return null;
  }

  const band = applicationLtvBand({ ...application, riskTier: application.riskTier ?? null });

  return band === NO_LTV ? null : band;
}

const notReadyMessages = {
  loading: {
    heading: 'Loading the loan file',
    detail: 'Fetching the application.',
  },
  'not-found': {
    heading: 'Application not found',
    detail: 'There is no application with this ID.',
  },
  error: {
    heading: 'The loan file could not be loaded',
    detail: 'The connection to the application failed. Reload the page to try again.',
  },
};

// A broker is refused for another broker's application and for one that does not exist, so the
// broker's message does not say which; an underwriter can read every application.
const forbiddenMessages: Record<LoanFileViewer, { heading: string; detail: string }> = {
  broker: {
    heading: 'Application not available',
    detail: 'This application is not available to your account, or it does not exist.',
  },
  underwriter: {
    heading: 'You are not allowed to read this application',
    detail: 'Your account is not allowed to read this application. Ask an administrator to check your access.',
  },
};

function NotReady({ state, viewer }: { state: Exclude<LoanFileState, { status: 'ready' }>; viewer: LoanFileViewer }) {
  const { heading, detail } =
    state.status === 'forbidden' ? forbiddenMessages[viewer] : notReadyMessages[state.status];

  return (
    <section
      aria-busy={state.status === 'loading'}
      aria-live="polite"
      className={sectionClass}
    >
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{heading}</h1>
      <p className="mt-2 leading-7 text-muted">{detail}</p>
    </section>
  );
}

interface LoanFileProps {
  application: LoanFileApplication;
  review: LoanFileReview;
}

function LoanFile({ application, review }: LoanFileProps) {
  const { property } = application;
  const heloc = application.loanType === 'heloc';

  return (
    <>
      <header className="animate-rise">
        <p className="eyebrow">Loan file</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          {application.borrowerName ?? 'Borrower name unavailable'}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="font-mono text-sm text-neutral-text">{application.id}</span>
          <StatusBadge status={application.status} />
          <span className="text-sm text-muted">
            {loanTypeLabel(application.loanType) ?? 'Loan type unavailable'}
          </span>
        </div>
      </header>

      <div className="mt-8 animate-rise" style={stagger(1)}>
        <StatusTimeline status={application.status} />
      </div>

      <div className="mt-8 animate-rise" style={stagger(2)}>
        <KeyFigures
          figures={[
            { label: heloc ? 'Credit limit requested' : 'Amount requested', value: euro(application.loanAmountEur) },
            {
              // The figure is the loan over the model estimate, not a formal valuation (the Collateral card says the same).
              label: heloc ? 'Combined LTV' : 'Indicative LTV',
              value: ltvText(application),
              note: heloc ? null : ltvBandText(application),
            },
            {
              label: 'Stressed DTI',
              value:
                review.state === 'pending'
                  ? 'Loading'
                  : review.state === 'available' && review.stressTest?.stressedDtiPct != null
                    ? formatPercent(review.stressTest.stressedDtiPct)
                    : null,
              note: review.state === 'available' ? review.stressTest?.dtiBand ?? null : null,
            },
            {
              label: 'Risk tier',
              value: riskTierText(application, review),
              // The scale note only makes sense next to an actual tier.
              note: /^[A-D]$/.test(riskTierText(application, review) ?? '') ? 'of A to D' : null,
            },
          ]}
        />
      </div>

      <div className="mt-5 grid animate-rise gap-5 lg:grid-cols-12 [&>div>section]:h-full" style={stagger(3)}>
        <div className="min-w-0 lg:col-span-5">
          {heloc ? (
            <HelocCollateral
              application={application}
              policyGate={
                review.state === 'available' ? review.policyGate : review.state === 'absent' ? null : undefined
              }
            />
          ) : (
            <MortgageCollateral application={application} review={review} />
          )}
        </div>
        <div className="min-w-0 lg:col-span-7">
          <ValuationBreakdown application={application} review={review} />
        </div>
      </div>

      <div className="mt-5 animate-rise" style={stagger(4)}>
        <DtiBreakdown application={application} review={review} />
      </div>
      <CommitteeConsole applicationId={application.id} />

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <FactSection
          facts={[
            { label: 'Name', value: application.borrowerName ?? null, mono: false },
            {
              label: 'Applicants',
              value: application.applicants === null ? null : application.applicants === 'joint' ? 'Joint' : 'Single',
              mono: false,
            },
            // Combined for a joint application: the form collects one household figure.
            { label: 'Gross income', unit: 'per year, combined', value: euro(application.grossIncomeAnnualEur) },
            { label: 'Existing debt repayments', unit: 'per month', value: euro(application.monthlyDebtsEur) },
            { label: 'Take-home pay', unit: 'per month', value: euro(application.monthlyTakeHomeEur) },
            { label: 'Living costs', unit: 'per month', value: euro(application.monthlyLivingCostsEur) },
          ]}
          title="Borrower"
        />
        <FactSection
          facts={[
            { label: heloc ? 'Credit limit requested' : 'Amount requested', value: euro(application.loanAmountEur) },
            { label: 'Term', value: count(application.termYears, ' years') },
            { label: 'Offered rate', unit: 'per year', value: application.aprPct === null ? null : formatPercent(application.aprPct) },
            ...(heloc
              ? [{ label: 'Existing mortgage balance', value: euro(application.existingMortgageBalanceEur) }]
              : []),
            { label: heloc ? 'Combined LTV' : 'Valuation LTV', value: ltvText(application) },
            ...(heloc ? [] : [{ label: 'Stored LTV band', unit: 'asking price', value: ltvBandText(application) }]),
            { label: 'Risk tier', value: riskTierText(application, review) },
            { label: 'Submitted', value: date(application.submittedAt), mono: false },
            { label: 'Updated', value: date(application.updatedAt), mono: false },
            { label: 'Decision', value: decisionText(application), mono: false },
          ]}
          title="Loan"
        />
        <FactSection
          facts={[
            { label: 'Address', value: [property.addressLine1, property.addressLine2].filter(Boolean).join(', ') || null, mono: false },
            { label: 'Eircode', value: property.eircode },
            { label: 'County', value: property.county, mono: false },
            { label: 'Property type', value: property.propertyType, mono: false },
            { label: 'Bedrooms', value: count(property.bedrooms) },
            { label: 'Floor area', value: count(property.floorAreaSqm, ' m²') },
            { label: 'BER rating', value: property.berRating },
            ...(heloc ? [] : [{ label: 'Asking price', value: euro(property.askingPriceEur) }]),
          ]}
          title="Property"
        />
      </div>
    </>
  );
}

function ReadyLoanFile({ application, review, viewer }: {
  application: LoanFileApplication;
  review: LoanFileReview;
  viewer: LoanFileViewer;
}) {
  // Keep the receipt outside the panel: Firestore can remove the controls before HTTP returns.
  const [recorded, setRecorded] = useState<DecisionResult | null>(null);
  const settlement = useSettlementService();
  const [mintState, setMintState] = useState<'idle' | 'pending' | 'confirmed' | 'failed'>('idle');
  const [mintError, setMintError] = useState<string | null>(null);
  const submitting = useRef(false);
  const active = useRef(true);
  const latest = useRef({ application, viewer });
  latest.current = { application, viewer };

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function mint(approval?: DecisionResult) {
    const current = latest.current;
    const approvedResponse = approval?.id === current.application.id &&
      approval.status === 'Underwriter Approved' && approval.decision.outcome === 'approved';
    const eligible = current.application.status === 'Underwriter Approved' ||
      (current.application.status === 'AI Deliberated' && approvedResponse);
    if (!active.current || submitting.current || current.viewer !== 'underwriter' ||
        current.application.loanNote || !eligible) {
      return;
    }
    // Lock before React renders disabled=true; keep it after success while the listener catches up.
    submitting.current = true;
    setMintState('pending');
    setMintError(null);
    try {
      await settlement.mint(current.application.id);
      if (active.current) setMintState('confirmed');
    } catch (error) {
      submitting.current = false;
      if (active.current) {
        setMintError(mintFailureMessage(error));
        setMintState('failed');
      }
    }
  }

  function onRecorded(result: DecisionResult) {
    if (!active.current) return;
    setRecorded(result);
    if (result.decision.outcome === 'approved' && result.status === 'Underwriter Approved') {
      void mint(result);
    }
  }

  const canMint = application.status === 'Underwriter Approved' ||
    (application.status === 'AI Deliberated' && recorded?.status === 'Underwriter Approved' &&
      recorded.decision.outcome === 'approved');

  return (
    <>
      <LoanFile application={application} review={review} />
      {recorded ? (
        <p className="mt-5 rounded-xl border border-success/20 bg-success-soft px-5 py-4 font-medium text-success" role="status">
          Decision recorded: {decisionLabels[recorded.decision.outcome]}. Saved status: {recorded.status}.
        </p>
      ) : null}
      {viewer === 'underwriter' && application.status === 'AI Deliberated' && !recorded ? (
        <SignOffPanel
          applicationId={application.id}
          borrowerName={application.borrowerName ?? null}
          onRecorded={onRecorded}
          policyGate={review.state === 'available' ? review.policyGate : null}
        />
      ) : null}
      {viewer === 'underwriter' && !application.loanNote && (canMint || mintState === 'confirmed') ? (
        <section aria-label="Mint loan note" className={`mt-5 ${sectionClass}`}>
          <h2 className="card-title">Mint loan note</h2>
          {mintState === 'pending' ? (
            <p aria-live="polite" className="mt-4 flex items-center gap-3 text-muted" role="status">
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-pine"
              />
              Minting…
            </p>
          ) : mintState === 'confirmed' ? (
            <p aria-live="polite" className="mt-4 font-medium text-success" role="status">
              Loan note minted. Waiting for the loan file to update…
            </p>
          ) : null}
          {mintError ? (
            <p className="mt-4 rounded-lg bg-danger-soft p-3 text-error" role="alert">{mintError}</p>
          ) : null}
          {canMint && mintState !== 'confirmed' ? (
            <button
              className="btn btn-primary mt-4"
              disabled={mintState === 'pending'}
              onClick={() => void mint(recorded ?? undefined)}
              type="button"
            >
              {mintState === 'failed' ? 'Retry mint' : 'Mint loan note'}
            </button>
          ) : null}
        </section>
      ) : null}
      {application.loanNote ? (
        <>
          <LoanNotePanel
            auditTxHash={application.auditTxHash}
            loanType={application.loanType}
            note={application.loanNote}
          />
          <AuditPackActions applicationId={application.id} />
        </>
      ) : null}
      {viewer === 'underwriter' && application.status !== 'Draft' ? (
        <MessageBorrower applicationId={application.id} borrowerName={application.borrowerName ?? null} />
      ) : null}
    </>
  );
}

// One application's file. Underwriters read any application; brokers read only their own
// clients', and see the same file with no decision or stress controls.
export function LoanFilePage({ viewer }: LoanFilePageProps) {
  const { applicationId } = useParams();
  const state = useLoanFile(applicationId);
  const borrowerId = state.status === 'ready' ? state.application.borrowerId : null;
  const back =
    viewer === 'underwriter'
      ? { to: '/underwriter/pipeline', label: 'Back to the pipeline' }
      : borrowerId
        ? { to: `/broker/clients/${encodeURIComponent(borrowerId)}`, label: 'Back to the client file' }
        : { to: '/broker/clients', label: 'Back to my clients' };

  return (
    <div className="min-h-screen bg-oat text-ink">
      <PortalHeader />

      <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8">
        <Link className={backLinkClass} to={back.to}>
          <svg
            aria-hidden="true"
            className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5"
            fill="none"
            viewBox="0 0 16 16"
          >
            <path d="M9.5 3.5 5 8l4.5 4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
          </svg>
          {back.label}
        </Link>

        <div className="mt-4">
          {state.status === 'ready' ? (
            <ReadyLoanFile
              application={state.application}
              key={state.application.id}
              review={state.review}
              viewer={viewer}
            />
          ) : (
            <NotReady state={state} viewer={viewer} />
          )}
        </div>
      </main>
    </div>
  );
}
