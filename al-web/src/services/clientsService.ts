import {
  Timestamp,
  collection,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type FirestoreError,
} from 'firebase/firestore';
import { db } from './firebase';

export const APPLICATION_STATUSES = [
  'Draft',
  'Applied',
  'AI Deliberated',
  'Underwriter Approved',
  'Declined',
  'Funded',
  'Closed',
] as const;

export const STORED_LTV_BANDS = ['80_or_less', '80_to_90', 'over_90'] as const;
export const RISK_TIERS = ['A', 'B', 'C', 'D'] as const;
export type StoredLtvBand = (typeof STORED_LTV_BANDS)[number];
export type RiskTier = (typeof RISK_TIERS)[number];

export function readRiskTier(value: unknown): RiskTier | null {
  return RISK_TIERS.find((tier) => tier === value) ?? null;
}

// What every portal screen reads from an application document, whoever is looking at it.
export interface ApplicationSummary {
  id: string;
  status: string;
  loanType: string | null;
  loanAmountEur: number | null;
  ltvPct: number | null;
  ltvBand?: StoredLtvBand | null;
  riskTier?: RiskTier | null;
  updatedAt: Date | null;
}

export interface BrokerApplication extends ApplicationSummary {
  borrowerId: string;
}

export interface ClientProfile {
  uid: string;
  fullName: string | null;
  email: string | null;
  county: string | null;
}

export interface BrokerClient {
  id: string;
  profile: ClientProfile | null;
  applications: BrokerApplication[];
}

export interface BrokerClientsSnapshot {
  clients: BrokerClient[];
  profilesState: 'pending' | 'available' | 'unavailable';
}

export type ClientsError = 'permission-denied' | 'unavailable';
export type ClientsListener = (snapshot: BrokerClientsSnapshot) => void;
export type ClientsErrorListener = (error: ClientsError) => void;

export interface ClientsService {
  subscribeToBrokerClients(
    brokerUid: string,
    listener: ClientsListener,
    onError: ClientsErrorListener,
  ): () => void;
}

function readString(value: unknown) {
  return typeof value === 'string' && value !== '' ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readDate(value: unknown) {
  return value instanceof Timestamp ? value.toDate() : null;
}

export function toApplicationSummary(id: string, data: DocumentData): ApplicationSummary {
  return {
    id,
    status: readString(data.status) ?? 'Unknown',
    loanType: readString(data.loanType),
    loanAmountEur: readNumber(data.loanAmountEur),
    ltvPct: readNumber(data.ltvPct),
    ltvBand: STORED_LTV_BANDS.find((band) => band === data.ltvBand) ?? null,
    riskTier: readRiskTier(data.riskTier),
    updatedAt: readDate(data.updatedAt) ?? readDate(data.createdAt),
  };
}

// The client list files an application under its borrower, so one without a borrower is skipped.
export function toBrokerApplication(id: string, data: DocumentData): BrokerApplication | null {
  const borrowerId = readString(data.borrowerId);

  if (!borrowerId) {
    return null;
  }

  return { ...toApplicationSummary(id, data), borrowerId };
}

export function toClientProfile(uid: string, data: DocumentData): ClientProfile {
  return {
    uid,
    fullName: readString(data.fullName),
    email: readString(data.email),
    county: readString(data.county),
  };
}

export function newestFirst(a: ApplicationSummary, b: ApplicationSummary) {
  return (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0) || a.id.localeCompare(b.id);
}

function byNameThenId(a: BrokerClient, b: BrokerClient) {
  const aName = a.profile?.fullName;
  const bName = b.profile?.fullName;

  if (aName && bName) {
    return aName.localeCompare(bName) || a.id.localeCompare(b.id);
  }

  if (aName || bName) {
    return aName ? -1 : 1;
  }

  return a.id.localeCompare(b.id);
}

// A client is a borrower who chose this broker, or who has an application assigned to this broker.
export function buildBrokerClients(
  profiles: readonly ClientProfile[],
  applications: readonly BrokerApplication[],
): BrokerClient[] {
  const clients = new Map<string, BrokerClient>();

  for (const profile of profiles) {
    clients.set(profile.uid, { id: profile.uid, profile, applications: [] });
  }

  for (const application of applications) {
    const client = clients.get(application.borrowerId) ?? {
      id: application.borrowerId,
      profile: null,
      applications: [],
    };
    client.applications.push(application);
    clients.set(client.id, client);
  }

  for (const client of clients.values()) {
    client.applications.sort(newestFirst);
  }

  return [...clients.values()].sort(byNameThenId);
}

// Metadata changes are listened for so that a server answer is delivered even when it only
// replaces an empty cache result with an empty server result.
const LISTEN_OPTIONS = { includeMetadataChanges: true } as const;

// With no backend reachable the SDK raises the first snapshot from an empty cache. That is not an
// answer: publishing it would show "No clients yet" for a broker who has clients.
function isUnconfirmedEmpty(snapshot: { empty: boolean; metadata: { fromCache: boolean } }) {
  return snapshot.metadata.fromCache && snapshot.empty;
}

function toClientsError(error: FirestoreError): ClientsError {
  return error.code === 'permission-denied' ? 'permission-denied' : 'unavailable';
}

export const firestoreClientsService: ClientsService = {
  subscribeToBrokerClients(brokerUid, listener, onError) {
    let applications: BrokerApplication[] | null = null;
    let profiles: ClientProfile[] | null = null;
    let profilesState: BrokerClientsSnapshot['profilesState'] = 'pending';
    let stopped = false;
    const unsubscribers: Array<() => void> = [];

    const stop = () => {
      stopped = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };

    const emit = () => {
      if (stopped || applications === null) {
        return;
      }

      listener({ clients: buildBrokerClients(profiles ?? [], applications), profilesState });
    };

    // Both queries filter on brokerId, which is what the Firestore rules check: an unfiltered
    // list is refused for a broker.
    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'applications'), where('brokerId', '==', brokerUid)),
        LISTEN_OPTIONS,
        (snapshot) => {
          if (isUnconfirmedEmpty(snapshot)) {
            return;
          }

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
          onError(toClientsError(error));
        },
      ),
    );

    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'users'), where('brokerId', '==', brokerUid)),
        LISTEN_OPTIONS,
        (snapshot) => {
          if (isUnconfirmedEmpty(snapshot)) {
            return;
          }

          profiles = snapshot.docs.map((doc) => toClientProfile(doc.id, doc.data()));
          profilesState = 'available';
          emit();
        },
        () => {
          // Client files stay usable without profiles; the page says names are unavailable.
          profiles = null;
          profilesState = 'unavailable';
          emit();
        },
      ),
    );

    return stop;
  },
};
