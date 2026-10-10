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

export interface BrokerApplication {
  id: string;
  borrowerId: string;
  status: string;
  loanType: string | null;
  loanAmountEur: number | null;
  ltvPct: number | null;
  updatedAt: Date | null;
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
  profilesAvailable: boolean;
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

export function toBrokerApplication(id: string, data: DocumentData): BrokerApplication | null {
  const borrowerId = readString(data.borrowerId);

  if (!borrowerId) {
    return null;
  }

  return {
    id,
    borrowerId,
    status: readString(data.status) ?? 'Unknown',
    loanType: readString(data.loanType),
    loanAmountEur: readNumber(data.loanAmountEur),
    ltvPct: readNumber(data.ltvPct),
    updatedAt: readDate(data.updatedAt) ?? readDate(data.createdAt),
  };
}

export function toClientProfile(uid: string, data: DocumentData): ClientProfile {
  return {
    uid,
    fullName: readString(data.fullName),
    email: readString(data.email),
    county: readString(data.county),
  };
}

function newestFirst(a: BrokerApplication, b: BrokerApplication) {
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

function toClientsError(error: FirestoreError): ClientsError {
  return error.code === 'permission-denied' ? 'permission-denied' : 'unavailable';
}

export const firestoreClientsService: ClientsService = {
  subscribeToBrokerClients(brokerUid, listener, onError) {
    let applications: BrokerApplication[] | null = null;
    let profiles: ClientProfile[] | null = null;
    let profilesAvailable = true;
    let stopped = false;
    const unsubscribers: Array<() => void> = [];

    const stop = () => {
      stopped = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };

    const emit = () => {
      if (stopped || applications === null || (profiles === null && profilesAvailable)) {
        return;
      }

      listener({ clients: buildBrokerClients(profiles ?? [], applications), profilesAvailable });
    };

    // Both queries filter on brokerId, which is what the Firestore rules check: an unfiltered
    // list is refused for a broker.
    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'applications'), where('brokerId', '==', brokerUid)),
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
          onError(toClientsError(error));
        },
      ),
    );

    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'users'), where('brokerId', '==', brokerUid)),
        (snapshot) => {
          profiles = snapshot.docs.map((doc) => toClientProfile(doc.id, doc.data()));
          profilesAvailable = true;
          emit();
        },
        () => {
          // Client files stay usable without profiles; the page says names are unavailable.
          profiles = null;
          profilesAvailable = false;
          emit();
        },
      ),
    );

    return stop;
  },
};
