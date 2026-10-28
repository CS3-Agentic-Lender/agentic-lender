import { doc, onSnapshot, type DocumentData, type FirestoreError } from 'firebase/firestore';
import {
  RISK_TIERS,
  readDate,
  readNumber,
  readString,
  toApplicationSummary,
  type ApplicationSummary,
  type RiskTier,
  type StoredField,
} from './clientsService';
import { db } from './firebase';

export const APPLICANT_TYPES = ['single', 'joint'] as const;
export type ApplicantType = (typeof APPLICANT_TYPES)[number];

export const AFFORDABILITY_BANDS = ['Comfortable', 'Caution', 'Adverse'] as const;
export type AffordabilityBand = (typeof AFFORDABILITY_BANDS)[number];

export const DECISION_OUTCOMES = ['approved', 'declined'] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

// The stress margin shown on the stressed column until a stored margin replaces it.
export const DEFAULT_STRESS_MARGIN_POINTS = 2;

export interface LoanFileProperty {
  addressLine1: string | null;
  addressLine2: string | null;
  eircode: string | null;
  county: string | null;
  propertyType: string | null;
  bedrooms: number | null;
  floorAreaSqm: number | null;
  berRating: string | null;
  askingPriceEur: number | null;
}

export interface LoanFileDecision {
  // Invalid marks a stored outcome outside the two agreed values.
  outcome: DecisionOutcome | 'invalid' | null;
  decidedAt: Date | null;
}

// Every figure is null when it is missing or unusable, so the page can say "Unavailable"
// instead of showing 0 or a made-up value.
export interface LoanFileApplication extends ApplicationSummary {
  borrowerId: string | null;
  brokerId: string | null;
  applicants: ApplicantType | null;
  grossIncomeAnnualEur: number | null;
  monthlyDebtsEur: number | null;
  monthlyTakeHomeEur: number | null;
  monthlyLivingCostsEur: number | null;
  termYears: number | null;
  aprPct: number | null;
  dtiPct: number | null;
  existingMortgageBalanceEur: number | null;
  property: LoanFileProperty;
  createdAt: Date | null;
  submittedAt: Date | null;
  decision: LoanFileDecision | null;
}

// applications/{id}/review/underwriting dtiBreakdown, monthly euro figures at the offered rate.
export interface DtiBreakdown {
  incomeMonthlyEur: number | null;
  existingDebtsMonthlyEur: number | null;
  newRepaymentMonthlyEur: number | null;
}

export interface StressTest {
  marginPoints: number | null;
  benchmarkRatePct: number | null;
  stressedRatePct: number | null;
  stressedRepaymentMonthlyEur: number | null;
  stressedDtiPct: number | null;
  surplusMonthlyEur: number | null;
  stressedSurplusMonthlyEur: number | null;
  dtiBand: AffordabilityBand | null;
  stressedDtiBand: AffordabilityBand | null;
  surplusBand: AffordabilityBand | null;
  stressedSurplusBand: AffordabilityBand | null;
  grossIncomePerApplicantAnnualEur: number[] | null;
}

export type LoanFileReview =
  | { state: 'pending' }
  | {
      state: 'available';
      riskTier: RiskTier | null;
      dtiBreakdown: DtiBreakdown;
      stressTest: StressTest;
    }
  // The underwriter's read answered and there is no review document yet.
  | { state: 'absent' }
  // Refused or failed. A broker is refused for a review that does not exist, so the two are one state.
  | { state: 'unavailable' };

export type LoanFileUpdate =
  | { status: 'not-found' }
  | { status: 'ready'; application: LoanFileApplication; review: LoanFileReview };

export type LoanFileError = 'forbidden' | 'unavailable';
export type LoanFileListener = (update: LoanFileUpdate) => void;
export type LoanFileErrorListener = (error: LoanFileError) => void;

export interface LoanFileService {
  subscribeToLoanFile(
    applicationId: string,
    listener: LoanFileListener,
    onError: LoanFileErrorListener,
  ): () => void;
}

// Money, counts and rates cannot be negative; a negative stored value is treated as unusable.
function readAmount(value: unknown) {
  const number = readNumber(value);

  return number !== null && number >= 0 ? number : null;
}

function readOneOf<T>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.find((entry) => entry === value) ?? null;
}

function readMap(value: unknown): DocumentData {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as DocumentData) : {};
}

function readDecision(value: unknown): LoanFileDecision | null {
  if (value == null) {
    return null;
  }

  const decision = readMap(value);

  return {
    outcome:
      decision.outcome == null ? null : readOneOf(decision.outcome, DECISION_OUTCOMES) ?? 'invalid',
    decidedAt: readDate(decision.decidedAt),
  };
}

export function toLoanFileApplication(id: string, data: DocumentData): LoanFileApplication {
  const property = readMap(data.property);

  return {
    ...toApplicationSummary(id, data),
    loanAmountEur: readAmount(data.loanAmountEur),
    ltvPct: readAmount(data.ltvPct),
    borrowerId: readString(data.borrowerId),
    brokerId: readString(data.brokerId),
    applicants: readOneOf(data.applicants, APPLICANT_TYPES),
    // Yearly, as SCHEMA.md stores it. The monthly income comes from the review's DTI breakdown.
    grossIncomeAnnualEur: readAmount(data.grossIncomeEur),
    monthlyDebtsEur: readAmount(data.monthlyDebtsEur),
    monthlyTakeHomeEur: readAmount(data.monthlyTakeHomeEur),
    monthlyLivingCostsEur: readAmount(data.monthlyLivingCostsEur),
    termYears: readAmount(data.termYears),
    aprPct: readAmount(data.aprPct),
    dtiPct: readAmount(data.dtiPct),
    existingMortgageBalanceEur: readAmount(data.existingMortgageBalanceEur),
    property: {
      addressLine1: readString(property.addressLine1),
      addressLine2: readString(property.addressLine2),
      eircode: readString(property.eircode),
      county: readString(property.county),
      propertyType: readString(property.propertyType),
      bedrooms: readAmount(property.bedrooms),
      floorAreaSqm: readAmount(property.floorAreaSqm),
      berRating: readString(property.berRating),
      askingPriceEur: readAmount(property.askingPriceEur),
    },
    createdAt: readDate(data.createdAt),
    submittedAt: readDate(data.submittedAt),
    decision: readDecision(data.decision),
  };
}

// The stressed figures, surplus, bands, benchmark rate, stress margin and income per applicant
// are not stored yet: al-core has not named their fields. Every name below is a placeholder
// guess, kept in this one function so it is the only thing to change once the names are agreed.
// Nothing here is calculated in the browser; a missing field stays null and shows "Unavailable".
export function readStressTest(review: DocumentData): StressTest {
  const stress = readMap(review.stressTest);
  const perApplicant = Array.isArray(stress.grossIncomePerApplicantEur)
    ? stress.grossIncomePerApplicantEur.map(readAmount)
    : null;

  return {
    marginPoints: readAmount(stress.marginPoints),
    benchmarkRatePct: readAmount(stress.benchmarkRatePct),
    stressedRatePct: readAmount(stress.stressedRatePct),
    stressedRepaymentMonthlyEur: readAmount(stress.stressedRepaymentMonthlyEur),
    stressedDtiPct: readAmount(stress.stressedDtiPct),
    // A surplus can be negative: that is a shortfall, not an unusable value.
    surplusMonthlyEur: readNumber(stress.surplusMonthlyEur),
    stressedSurplusMonthlyEur: readNumber(stress.stressedSurplusMonthlyEur),
    dtiBand: readOneOf(stress.dtiBand, AFFORDABILITY_BANDS),
    stressedDtiBand: readOneOf(stress.stressedDtiBand, AFFORDABILITY_BANDS),
    surplusBand: readOneOf(stress.surplusBand, AFFORDABILITY_BANDS),
    stressedSurplusBand: readOneOf(stress.stressedSurplusBand, AFFORDABILITY_BANDS),
    grossIncomePerApplicantAnnualEur:
      perApplicant && perApplicant.length > 0 && perApplicant.every((amount) => amount !== null)
        ? (perApplicant as number[])
        : null,
  };
}

export function toLoanFileReview(data: DocumentData): LoanFileReview {
  const breakdown = readMap(data.dtiBreakdown);

  return {
    state: 'available',
    riskTier: readOneOf(data.riskTier, RISK_TIERS),
    dtiBreakdown: {
      incomeMonthlyEur: readAmount(breakdown.incomeMonthlyEur),
      existingDebtsMonthlyEur: readAmount(breakdown.existingDebtsMonthlyEur),
      newRepaymentMonthlyEur: readAmount(breakdown.newRepaymentMonthlyEur),
    },
    stressTest: readStressTest(data),
  };
}

// The tier the loan file shows: a present stored tier wins, even an invalid one; only an absent
// stored tier uses the review's, the same precedence as the pipeline queue.
export function loanFileRiskTier(
  application: LoanFileApplication,
  review: LoanFileReview,
): StoredField<RiskTier> {
  if (application.riskTier != null) {
    return application.riskTier;
  }

  return review.state === 'available' ? review.riskTier : null;
}

// A route parameter that cannot be one Firestore document ID (empty, containing a slash, "." or
// "..", or a reserved __name__) is not looked up: it can only be "not found".
export function isDocumentId(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    value !== '' &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !/^__.*__$/.test(value)
  );
}

// Metadata changes are listened for so that the server's answer is delivered even when it only
// confirms what the cache said.
const LISTEN_OPTIONS = { includeMetadataChanges: true } as const;

// With no backend reachable the SDK can raise a first snapshot from an empty cache. A missing
// document from the cache is not an answer: publishing it would say "not found" for an
// application that exists.
function isUnconfirmedMissing(snapshot: { exists(): boolean; metadata: { fromCache: boolean } }) {
  return snapshot.metadata.fromCache && !snapshot.exists();
}

function toLoanFileError(error: FirestoreError): LoanFileError {
  return error.code === 'permission-denied' ? 'forbidden' : 'unavailable';
}

export const firestoreLoanFileService: LoanFileService = {
  subscribeToLoanFile(applicationId, listener, onError) {
    if (!isDocumentId(applicationId)) {
      listener({ status: 'not-found' });
      return () => {};
    }

    // Undefined until the application's listener has answered; null when it does not exist.
    let application: LoanFileApplication | null | undefined;
    let review: LoanFileReview = { state: 'pending' };
    let stopped = false;
    const unsubscribers: Array<() => void> = [];

    const stop = () => {
      if (stopped) {
        return;
      }

      stopped = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };

    // The file is published as soon as the application answers; the review never holds it back.
    const emit = () => {
      if (stopped || application === undefined) {
        return;
      }

      listener(application === null ? { status: 'not-found' } : { status: 'ready', application, review });
    };

    unsubscribers.push(
      onSnapshot(
        doc(db, 'applications', applicationId),
        LISTEN_OPTIONS,
        (snapshot) => {
          if (stopped || isUnconfirmedMissing(snapshot)) {
            return;
          }

          const data = snapshot.data();
          application = data ? toLoanFileApplication(snapshot.id, data) : null;
          emit();
        },
        (error) => {
          if (stopped) {
            return;
          }

          stop();
          onError(toLoanFileError(error));
        },
      ),
    );

    // A broker may read the review only when its copied brokerId is theirs (al-core/firestore.rules).
    unsubscribers.push(
      onSnapshot(
        doc(db, 'applications', applicationId, 'review', 'underwriting'),
        LISTEN_OPTIONS,
        (snapshot) => {
          if (stopped || isUnconfirmedMissing(snapshot)) {
            return;
          }

          const data = snapshot.data();
          review = data ? toLoanFileReview(data) : { state: 'absent' };
          emit();
        },
        () => {
          if (stopped) {
            return;
          }

          // The application stays readable without its review; the page says why figures are missing.
          review = { state: 'unavailable' };
          emit();
        },
      ),
    );

    return stop;
  },
};
