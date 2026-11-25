import { collection } from 'firebase/firestore';
import { toCommitteeRun, type CommitteeRun } from './committeeService';
import { db } from './firebase';
import { subscribeToCollection, type LiveErrorListener, type LiveListener } from './liveCollection';
import { toLoanFileApplication, type LoanFileApplication } from './loanFileService';

// The two collections behind the admin's business view, read whole and live.
export interface BusinessService {
  subscribeToApplications(listener: LiveListener<LoanFileApplication>, onError: LiveErrorListener): () => void;
  subscribeToRuns(listener: LiveListener<CommitteeRun>, onError: LiveErrorListener): () => void;
}

// Admins read every application and committee run (AL-339). Both collections are small enough for the
// portal to hold and count, so no query or index is needed.
export const firestoreBusinessService: BusinessService = {
  subscribeToApplications(listener, onError) {
    return subscribeToCollection(collection(db, 'applications'), toLoanFileApplication, listener, onError);
  },

  subscribeToRuns(listener, onError) {
    return subscribeToCollection(collection(db, 'ai_runs'), toCommitteeRun, listener, onError);
  },
};
