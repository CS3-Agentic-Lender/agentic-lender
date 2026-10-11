import {
  collection,
  collectionGroup,
  onSnapshot,
  type FirestoreError,
} from 'firebase/firestore';
import { newestFirst, toBrokerApplication, type BrokerApplication } from './clientsService';
import { db } from './firebase';

export const RISK_TIERS = ['A', 'B', 'C', 'D'] as const;

export type RiskTier = (typeof RISK_TIERS)[number];

export interface PipelineApplication extends BrokerApplication {
  riskTier: RiskTier | null;
}

export interface PipelineSnapshot {
  applications: PipelineApplication[];
  // False when the underwriting review documents cannot be read, so no tier is known.
  riskTiersAvailable: boolean;
}

export type PipelineError = 'permission-denied' | 'unavailable';
export type PipelineListener = (snapshot: PipelineSnapshot) => void;
export type PipelineErrorListener = (error: PipelineError) => void;

export interface PipelineService {
  subscribeToPipeline(listener: PipelineListener, onError: PipelineErrorListener): () => void;
}

// Only a stored A, B, C or D is a tier. Nothing else is mapped to one.
export function readRiskTier(value: unknown): RiskTier | null {
  return RISK_TIERS.find((tier) => tier === value) ?? null;
}

export function withRiskTiers(
  applications: readonly BrokerApplication[],
  riskTiers: ReadonlyMap<string, RiskTier>,
): PipelineApplication[] {
  return applications
    .map((application) => ({ ...application, riskTier: riskTiers.get(application.id) ?? null }))
    .sort(newestFirst);
}

function toPipelineError(error: FirestoreError): PipelineError {
  return error.code === 'permission-denied' ? 'permission-denied' : 'unavailable';
}

export const firestorePipelineService: PipelineService = {
  subscribeToPipeline(listener, onError) {
    let applications: BrokerApplication[] | null = null;
    let riskTiers: Map<string, RiskTier> | null = null;
    let riskTiersAvailable = true;
    let stopped = false;
    const unsubscribers: Array<() => void> = [];

    const stop = () => {
      stopped = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };

    const emit = () => {
      if (stopped || applications === null || (riskTiers === null && riskTiersAvailable)) {
        return;
      }

      listener({
        applications: withRiskTiers(applications, riskTiers ?? new Map()),
        riskTiersAvailable,
      });
    };

    // The rules let an underwriter read every application, so the whole collection is one query.
    unsubscribers.push(
      onSnapshot(
        collection(db, 'applications'),
        (snapshot) => {
          applications = snapshot.docs
            .map((doc) => toBrokerApplication(doc.id, doc.data()))
            .filter((application) => application !== null);
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

    // Draft contract, not agreed: the tier is read from applications/{id}/review/underwriting
    // with one collection-group query. No rule allows it yet, so today this is refused and the
    // queue says tiers are unavailable.
    unsubscribers.push(
      onSnapshot(
        collectionGroup(db, 'review'),
        (snapshot) => {
          const tiers = new Map<string, RiskTier>();

          for (const doc of snapshot.docs) {
            const application = doc.ref.parent.parent;
            const riskTier = readRiskTier(doc.data().riskTier);

            if (doc.id === 'underwriting' && application?.parent.id === 'applications' && riskTier) {
              tiers.set(application.id, riskTier);
            }
          }

          riskTiers = tiers;
          riskTiersAvailable = true;
          emit();
        },
        () => {
          // The queue stays usable without tiers; the page says they are unavailable.
          riskTiers = null;
          riskTiersAvailable = false;
          emit();
        },
      ),
    );

    return stop;
  },
};
