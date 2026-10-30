import { Link, useParams } from 'react-router';
import { PortalHeader } from '../../components/PortalHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { DtiBreakdown } from '../../components/lending/DtiBreakdown';
import { Figure } from '../../components/lending/Figure';
import { HelocCollateral } from '../../components/lending/HelocCollateral';
import { useLoanFile, type LoanFileState } from '../../context/LoanFileContext';
import {
  loanFileRiskTier,
  type LoanFileApplication,
  type LoanFileReview,
} from '../../services/loanFileService';
import { formatDate, formatEuro, formatPercent } from '../../utils/formatters';
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

const backLinkClass = 'font-medium text-pine underline-offset-4 hover:underline';
const sectionClass = 'rounded-2xl border border-line bg-surface p-6 sm:p-8';

const loanTypeLabels: Record<string, string> = { mortgage: 'Mortgage', heloc: 'HELOC' };

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
    <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {facts.map(({ label, unit, value, mono }) => (
        <div key={label}>
          <dt className="text-sm text-muted">
            {label}
            {unit ? <span className="text-xs">, {unit}</span> : null}
          </dt>
          <dd className="mt-1">
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
      <h2 className="text-xl font-semibold">{title}</h2>
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
      <h1 className="text-3xl font-semibold tracking-tight">{heading}</h1>
      <p className="mt-3 leading-7 text-muted">{detail}</p>
    </section>
  );
}

function Placeholder({ title, detail }: { title: string; detail: string }) {
  return (
    <section aria-label={title} className={`${sectionClass} border-dashed`}>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-muted">{detail}</p>
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
      <p className="font-mono text-xs font-medium tracking-widest text-muted uppercase">Loan file</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">
        {application.borrowerName ?? 'Borrower name unavailable'}
      </h1>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="font-mono text-sm">{application.id}</span>
        <StatusBadge status={application.status} />
        <span className="text-sm text-muted">
          {application.loanType ? loanTypeLabels[application.loanType] ?? application.loanType : 'Loan type unavailable'}
        </span>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
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
            { label: 'Asking price', value: euro(property.askingPriceEur) },
          ]}
          title="Property"
        />
        <div className="grid gap-6">
          {heloc ? (
            <HelocCollateral application={application} />
          ) : (
            <Placeholder
              detail="The collateral record for this property is not shown on the loan file yet."
              title="Collateral"
            />
          )}
          <Placeholder
            detail="The valuation and its breakdown are not shown on the loan file yet."
            title="Valuation"
          />
        </div>
      </div>

      <div className="mt-6">
        <DtiBreakdown application={application} review={review} />
      </div>
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

      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <Link className={backLinkClass} to={back.to}>
          {back.label}
        </Link>

        <div className="mt-8">
          {state.status === 'ready' ? (
            <LoanFile application={state.application} review={state.review} />
          ) : (
            <NotReady state={state} viewer={viewer} />
          )}
        </div>
      </main>
    </div>
  );
}
