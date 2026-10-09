import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const password = process.env.AL_EMULATOR_TEST_PASSWORD;

if (!password) {
  throw new Error('Set AL_EMULATOR_TEST_PASSWORD to the documented local seed password.');
}

const seededUsers = [
  { email: 'bob@test.com', role: 'broker' },
  { email: 'uma@test.com', role: 'underwriter' },
  { email: 'alice@test.com', role: 'borrower' },
];

const app = initializeApp(
  {
    apiKey: 'demo-al-api-key',
    authDomain: 'demo-al.firebaseapp.com',
    projectId: 'demo-al',
    appId: 'demo-al-auth-smoke',
  },
  `auth-emulator-smoke-${Date.now()}`,
);
const auth = getAuth(app);
connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });

try {
  for (const seededUser of seededUsers) {
    const credential = await signInWithEmailAndPassword(auth, seededUser.email, password);
    const token = await credential.user.getIdTokenResult(true);

    if (token.claims.role !== seededUser.role) {
      throw new Error(
        `Expected ${seededUser.email} to have role ${seededUser.role}, received ${String(token.claims.role)}.`,
      );
    }

    console.log(`Verified ${seededUser.email}: ${seededUser.role}`);
    await signOut(auth);
  }
} finally {
  await deleteApp(app);
}

