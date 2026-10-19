import {
  collection,
  collectionGroup,
  onSnapshot,
  type DocumentData,
  type FirestoreError,
} from 'firebase/firestore';
import {
  newestFirst,
  readRiskTier,
  toApplicationSummary,
  type ApplicationSummary,
  type RiskTier,
} from './clientsService';
import { db } from './firebase';

export { RISK_TIERS, readRiskTier, type RiskTier } from './clientsService';

// Pending means the tier query has not answered; unavailable carries a separate failure reason.
export type RiskTierState = 'pending' | 'available' | 'unavailable';

export interface PipelineApplication extends ApplicationSummary {
  riskTier: RiskTier | null;
  // Preserve the source so a pending or failed fallback cannot hide a stored tier.
  storedRiskTier?: RiskTier | null;
}

export interface PipelineSnapshot {
  applications: PipelineApplication[];
  riskTierState: RiskTierState;
  riskTierError: PipelineError | null;
}

export type PipelineError = 'permission-denied' | 'unavailable';
export type PipelineListener = (snapshot: PipelineSnapshot) => void;
export type PipelineErrorListener = (error: PipelineError) => void;

export interface PipelineService {
  subscribeToPipeline(listener: PipelineListener, onError: PipelineErrorListener): () => void;
}

// The application a review document belongs to, or null when the document is anything other
// than applications/{id}/review/underwriting.
export function applicationIdOfReview(path: string): string | null {
  const [root, applicationId, subcollection, documentId, ...rest] = path.split('/');

  return root === 'applications' &&
    applicationId &&
    subcollection === 'review' &&
    documentId === 'underwriting' &&
    rest.length === 0
    ? applicationId
    : null;
}

interface ReviewDocument {
  ref: { path: string };
  data(): DocumentData;
}

export function toRiskTiers(documents: readonly ReviewDocument[]): Map<string, RiskTier> {
  const tiers = new Map<string, RiskTier>();

  for (const document of documents) {
    const applicationId = applicationIdOfReview(document.ref.path);
    const riskTier = readRiskTier(document.data().riskTier);

    if (applicationId && riskTier) {
      tiers.set(applicationId, riskTier);
    }
  }

  return tiers;
}

export function withRiskTiers(
  applications: readonly ApplicationSummary[],
  riskTiers: ReadonlyMap<string, RiskTier>,
): PipelineApplication[] {
  return applications
    .map((application) => ({
      ...application,
      storedRiskTier: application.riskTier ?? null,
      riskTier: application.riskTier ?? riskTiers.get(application.id) ?? null,
    }))
    .sort(newestFirst);
}

// When the backend cannot be reached the SDK can raise a first snapshot from an empty local
// cache. That is not an answer, so it is never published as a real empty result: the listener
// stays pending until the server answers or the error path fires.
// Metadata events are needed so the server's confirmation is delivered.
function isUnconfirmedEmpty(snapshot: { empty: boolean; metadata: { fromCache: boolean } }) {
  return snapshot.metadata.fromCache && snapshot.empty;
}

function toPipelineError(error: FirestoreError): PipelineError {
  return error.code === 'permission-denied' ? 'permission-denied' : 'unavailable';
}

export const firestorePipelineService: PipelineService = {
  subscribeToPipeline(listener, onError) {
    let applications: ApplicationSummary[] | null = null;
    let riskTiers: ReadonlyMap<string, RiskTier> = new Map();
    let riskTierState: RiskTierState = 'pending';
    let riskTierError: PipelineError | null = null;
    let stopped = false;
    const unsubscribers: Array<() => void> = [];

    const stop = () => {
      if (stopped) {
        return;
      }

      stopped = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };

    // The queue is published as soon as the applications answer; tiers never hold it back.
    const emit = () => {
      if (stopped || applications === null) {
        return;
      }

      listener({ applications: withRiskTiers(applications, riskTiers), riskTierState, riskTierError });
    };

    // Keep one unfiltered applications listener and filter statuses client-side: the summary
    // counts all applications, and orderBy('submittedAt') would silently drop Drafts without it.
    unsubscribers.push(
      onSnapshot(
        collection(db, 'applications'),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (stopped || isUnconfirmedEmpty(snapshot)) {
            return;
          }

          applications = snapshot.docs.map((doc) => toApplicationSummary(doc.id, doc.data()));
          emit();
        },
        (error) => {
          if (stopped) {
            return;
          }

          stop();
          onError(toPipelineError(error));
        },
      ),
    );

    // Keep review/underwriting as a tier fallback until al-ai writes the application fields.
    // A valid stored tier always takes precedence over this collection-group listener.
    unsubscribers.push(
      onSnapshot(
        collectionGroup(db, 'review'),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (stopped || isUnconfirmedEmpty(snapshot)) {
            return;
          }

          riskTiers = toRiskTiers(snapshot.docs);
          riskTierState = 'available';
          riskTierError = null;
          emit();
        },
        (error) => {
          if (stopped) {
            return;
          }

          // The queue stays usable without tiers; the page says why they are missing.
          riskTiers = new Map();
          riskTierState = 'unavailable';
          riskTierError = toPipelineError(error);
          emit();
        },
      ),
    );

    return stop;
  },
};
