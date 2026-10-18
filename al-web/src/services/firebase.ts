import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';

function requiredConfig(value: string | undefined, name: string, developmentFallback: string) {
  if (value) {
    return value;
  }

  if (import.meta.env.DEV) {
    return developmentFallback;
  }

  throw new Error(`Missing required Firebase configuration: ${name}`);
}

const firebaseConfig = {
  apiKey: requiredConfig(import.meta.env.VITE_FIREBASE_API_KEY, 'VITE_FIREBASE_API_KEY', 'demo-al-api-key'),
  authDomain: requiredConfig(
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    'VITE_FIREBASE_AUTH_DOMAIN',
    'demo-al.firebaseapp.com',
  ),
  projectId: requiredConfig(import.meta.env.VITE_FIREBASE_PROJECT_ID, 'VITE_FIREBASE_PROJECT_ID', 'demo-al'),
  appId: requiredConfig(import.meta.env.VITE_FIREBASE_APP_ID, 'VITE_FIREBASE_APP_ID', 'demo-al-web'),
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);

type EmulatorConnectionRegistry = typeof globalThis & {
  __agenticLenderAuthEmulators?: WeakSet<Auth>;
};

const registry = globalThis as EmulatorConnectionRegistry;
registry.__agenticLenderAuthEmulators ??= new WeakSet<Auth>();

if (import.meta.env.DEV && !registry.__agenticLenderAuthEmulators.has(auth)) {
  connectAuthEmulator(
    auth,
    import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? 'http://127.0.0.1:9099',
    { disableWarnings: true },
  );
  registry.__agenticLenderAuthEmulators.add(auth);
}

