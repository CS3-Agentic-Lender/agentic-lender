import { collection, query, where } from 'firebase/firestore';
import { toCommitteeRun, type CommitteeRun } from './committeeService';
import { db } from './firebase';
import { subscribeToCollection, type LiveErrorListener, type LiveListener } from './liveCollection';

// What the overview pages read beyond the pipeline and the broker's client list.
export interface OverviewService {
  // The broker's committee runs, for the policy conditions on their clients' applications.
  subscribeToBrokerRuns(
    brokerUid: string,
    listener: LiveListener<CommitteeRun>,
    onError: LiveErrorListener,
  ): () => void;
}

export const firestoreOverviewService: OverviewService = {
  subscribeToBrokerRuns(brokerUid, listener, onError) {
    // The ai_runs rule lets a broker read only runs whose copied brokerId is theirs, so the query must say so or
    // Firestore refuses the whole list. A single equality filter needs no composite index.
    return subscribeToCollection(
      query(collection(db, 'ai_runs'), where('brokerId', '==', brokerUid)),
      toCommitteeRun,
      listener,
      onError,
    );
  },
};
