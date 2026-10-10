// Checks, against the seeded Auth and Firestore emulators, that the queries the client list uses
// return only the signed-in broker's files and that the rules refuse everything wider.
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  where,
} from 'firebase/firestore';

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const [firestoreHost, firestorePort] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
const password = process.env.AL_EMULATOR_TEST_PASSWORD;

if (!password) {
  throw new Error('Set AL_EMULATOR_TEST_PASSWORD to the documented local seed password.');
}

// The first broker is in every seed. The second arrives with the two-broker seed and may be missing.
const seededBrokers = ['bob@test.com', 'ciara@test.com'];
const [requiredBroker] = seededBrokers;

const app = initializeApp(
  {
    apiKey: 'demo-al-api-key',
    authDomain: 'demo-al.firebaseapp.com',
    projectId: 'demo-al',
    appId: 'demo-al-clients-smoke',
  },
  `broker-clients-smoke-${Date.now()}`,
);
const auth = getAuth(app);
const db = getFirestore(app);
connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
connectFirestoreEmulator(db, firestoreHost, Number(firestorePort));

async function refused(read) {
  try {
    await read();
    return false;
  } catch (error) {
    if (error.code === 'permission-denied') {
      return true;
    }
    throw error;
  }
}

const applicationsByBroker = new Map();
let failed = false;

function check(passed, message) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${message}`);
  failed ||= !passed;
}

try {
  for (const email of seededBrokers) {
    let uid;
    try {
      ({ user: { uid } } = await signInWithEmailAndPassword(auth, email, password));
    } catch (error) {
      const notSeeded = error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential';
      if (notSeeded && email !== requiredBroker) {
        console.log(`SKIP  ${email} is not in this seed, so the two-broker checks did not run for them`);
        continue;
      }
      throw error;
    }

    const own = await getDocs(query(collection(db, 'applications'), where('brokerId', '==', uid)));
    applicationsByBroker.set(uid, own.docs.map((snapshot) => snapshot.id));
    check(
      own.docs.every((snapshot) => snapshot.data().brokerId === uid),
      `${email} (${uid}) reads ${own.size} application(s), all assigned to them`,
    );

    check(
      await refused(() => getDocs(collection(db, 'applications'))),
      `${email} is refused an unfiltered read of every application`,
    );

    const profilesRefused = await refused(() =>
      getDocs(query(collection(db, 'users'), where('brokerId', '==', uid))),
    );
    console.log(
      `INFO  ${email} ${profilesRefused ? 'cannot read' : 'can read'} the profiles of borrowers who chose them`,
    );

    await signOut(auth);
  }

  const [first, second] = [...applicationsByBroker.entries()];
  if (first && second && second[1].length > 0) {
    const [firstUid] = first;
    const [, secondApplications] = second;
    check(
      first[1].every((id) => !secondApplications.includes(id)),
      'the two brokers have no application in common',
    );

    await signInWithEmailAndPassword(auth, seededBrokers[0], password);
    check(
      await refused(() => getDoc(doc(db, 'applications', secondApplications[0]))),
      `${seededBrokers[0]} (${firstUid}) is refused the other broker's application ${secondApplications[0]} by ID`,
    );
    await signOut(auth);
  }
} finally {
  await deleteApp(app);
}

if (failed) {
  process.exitCode = 1;
}
