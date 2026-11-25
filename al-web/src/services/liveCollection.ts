import {
  onSnapshot,
  type DocumentData,
  type FirestoreError,
  type Query,
} from 'firebase/firestore';

export type LiveError = 'permission-denied' | 'unavailable';
export type LiveListener<T> = (items: T[]) => void;
export type LiveErrorListener = (error: LiveError) => void;

export function toLiveError(error: Pick<FirestoreError, 'code'>): LiveError {
  return error.code === 'permission-denied' ? 'permission-denied' : 'unavailable';
}

// One live Firestore query, each document parsed at the boundary. A document the parser rejects is
// left out. With no backend reachable the SDK raises a first snapshot from an empty local cache; that is
// not an answer, so it is never published as an empty list (metadata events deliver the server's reply).
export function subscribeToCollection<T>(
  source: Query<DocumentData>,
  parse: (id: string, data: DocumentData) => T | null,
  listener: LiveListener<T>,
  onError: LiveErrorListener,
): () => void {
  let stopped = false;
  const unsubscribe = onSnapshot(
    source,
    { includeMetadataChanges: true },
    (snapshot) => {
      if (stopped || (snapshot.metadata.fromCache && snapshot.empty)) {
        return;
      }

      listener(snapshot.docs.map((doc) => parse(doc.id, doc.data())).filter((item) => item !== null));
    },
    (error) => {
      if (!stopped) {
        onError(toLiveError(error));
      }
    },
  );

  return () => {
    stopped = true;
    unsubscribe();
  };
}
