import { collection, type DocumentData } from 'firebase/firestore';
import { readDate, readString } from './clientsService';
import { db } from './firebase';
import { subscribeToCollection, type LiveErrorListener, type LiveListener } from './liveCollection';

// One users/{uid} profile, as an admin reads it: borrowers and staff alike (al-core/SCHEMA.md).
export interface DirectoryUser {
  uid: string;
  // `borrower`, `broker`, `underwriter` or `admin`; anything else is kept as stored.
  role: string | null;
  fullName: string | null;
  email: string | null;
  firm: string | null;
  // Borrowers only: the broker they chose.
  brokerId: string | null;
  // Staff only: set by the staff API while the account is disabled.
  disabled: boolean;
  createdAt: Date | null;
}

export interface UserDirectoryService {
  subscribeToUsers(listener: LiveListener<DirectoryUser>, onError: LiveErrorListener): () => void;
}

export function toDirectoryUser(uid: string, data: DocumentData): DirectoryUser {
  return {
    uid,
    role: readString(data.role),
    fullName: readString(data.fullName),
    email: readString(data.email),
    firm: readString(data.firm),
    brokerId: readString(data.brokerId),
    disabled: data.disabled === true,
    createdAt: readDate(data.createdAt),
  };
}

// A name for anyone the directory knows: their full name, else their email, else null.
export function directoryNames(users: readonly DirectoryUser[]) {
  const names = new Map(users.map((user) => [user.uid, user.fullName ?? user.email]));
  return (uid: string | null) => (uid ? names.get(uid) ?? null : null);
}

// Admins read every profile (AL-339). The whole collection is small enough for the portal to hold.
export const firestoreUserDirectoryService: UserDirectoryService = {
  subscribeToUsers(listener, onError) {
    return subscribeToCollection(collection(db, 'users'), toDirectoryUser, listener, onError);
  },
};
