import {
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

export type PortalRole = 'broker' | 'underwriter' | 'admin';
export type TrustedRole = PortalRole | 'borrower';
export type DenialReason = 'missing-role' | 'unknown-role' | 'malformed-role';

export type RoleResolution =
  | { role: TrustedRole; denialReason: null }
  | { role: null; denialReason: DenialReason };

export type AuthUser = Pick<User, 'uid' | 'email' | 'getIdToken' | 'getIdTokenResult'>;
export type AuthStateListener = (user: AuthUser | null) => void;
export type AuthErrorListener = (error: Error) => void;

export interface AuthService {
  subscribe(listener: AuthStateListener, onError?: AuthErrorListener): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  resolveTrustedRole(user: AuthUser): Promise<RoleResolution>;
  getCurrentIdToken(forceRefresh?: boolean): Promise<string>;
}

export function resolveRoleClaim(claims: Record<string, unknown>): RoleResolution {
  const role = claims.role;

  if (role === undefined || role === null || role === '') {
    return { role: null, denialReason: 'missing-role' };
  }

  if (typeof role !== 'string') {
    return { role: null, denialReason: 'malformed-role' };
  }

  if (role === 'broker' || role === 'underwriter' || role === 'admin' || role === 'borrower') {
    return { role, denialReason: null };
  }

  return { role: null, denialReason: 'unknown-role' };
}

export function getSignInErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/user-not-found' ||
    code === 'auth/wrong-password'
  ) {
    return 'Email or password is incorrect.';
  }

  // An admin disabled the account (AL-340); saying so saves the person retrying a correct password.
  if (code === 'auth/user-disabled') {
    return 'This account is disabled. Ask an administrator to enable it.';
  }

  if (code === 'auth/too-many-requests') {
    return 'Too many sign-in attempts. Wait a moment and try again.';
  }

  return import.meta.env.DEV
    ? 'Sign-in failed. Try again. In development, check that the Auth emulator is running.'
    : 'Sign-in failed. Try again.';
}

export async function getCurrentFirebaseIdToken(forceRefresh = false) {
  if (!auth.currentUser) {
    throw new Error('An authenticated Firebase user is required to retrieve an ID token.');
  }

  return auth.currentUser.getIdToken(forceRefresh);
}

export const firebaseAuthService: AuthService = {
  subscribe(listener, onError) {
    return onIdTokenChanged(auth, listener, onError);
  },

  async signIn(email, password) {
    await signInWithEmailAndPassword(auth, email, password);
  },

  async signOut() {
    await firebaseSignOut(auth);
  },

  async resolveTrustedRole(user) {
    const token = await user.getIdTokenResult();
    return resolveRoleClaim(token.claims);
  },

  async getCurrentIdToken(forceRefresh = false) {
    return getCurrentFirebaseIdToken(forceRefresh);
  },
};

