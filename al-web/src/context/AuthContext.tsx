import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  firebaseAuthService,
  type AuthService,
  type AuthUser,
  type DenialReason,
  type TrustedRole,
} from '../services/authService';

type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'error';
type AuthAction = 'idle' | 'signing-in' | 'signing-out';

interface AuthContextValue {
  status: AuthStatus;
  action: AuthAction;
  user: AuthUser | null;
  role: TrustedRole | null;
  denialReason: DenialReason | null;
  authError: string | null;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  service?: AuthService;
}

export function AuthProvider({ children, service = firebaseAuthService }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [action, setAction] = useState<AuthAction>('idle');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [role, setRole] = useState<TrustedRole | null>(null);
  const [denialReason, setDenialReason] = useState<DenialReason | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let authChange = 0;

    const unsubscribe = service.subscribe(
      (nextUser) => {
        const change = ++authChange;
        setAuthError(null);
        setRole(null);
        setDenialReason(null);

        if (!nextUser) {
          setUser(null);
          setStatus('anonymous');
          setAction('idle');
          return;
        }

        setUser(nextUser);
        setStatus('loading');

        void service
          .resolveTrustedRole(nextUser)
          .then((resolution) => {
            if (!active || change !== authChange) {
              return;
            }

            setRole(resolution.role);
            setDenialReason(resolution.denialReason);
            setStatus('authenticated');
            setAction('idle');
          })
          .catch(() => {
            if (!active || change !== authChange) {
              return;
            }

            setRole(null);
            setDenialReason('claim-error');
            setAuthError('Your access role could not be verified.');
            setStatus('authenticated');
            setAction('idle');
          });
      },
      () => {
        if (!active) {
          return;
        }

        ++authChange;
        setUser(null);
        setRole(null);
        setDenialReason('claim-error');
        setAuthError('Firebase authentication could not be restored.');
        setStatus('error');
        setAction('idle');
      },
    );

    return () => {
      active = false;
      ++authChange;
      unsubscribe();
    };
  }, [service]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setAction('signing-in');
      setAuthError(null);
      try {
        await service.signIn(email, password);
      } catch (error) {
        setAction('idle');
        throw error;
      }
    },
    [service],
  );

  const signOut = useCallback(async () => {
    setAction('signing-out');
    setAuthError(null);

    try {
      await service.signOut();
      setUser(null);
      setRole(null);
      setDenialReason(null);
      setStatus('anonymous');
    } catch (error) {
      setAuthError('Firebase sign-out failed. Try again.');
      throw error;
    } finally {
      setAction('idle');
    }
  }, [service]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, action, user, role, denialReason, authError, signIn, signOut }),
    [status, action, user, role, denialReason, authError, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return context;
}

