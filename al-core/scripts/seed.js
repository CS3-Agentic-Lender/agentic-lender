const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

const DEMO_PASSWORD = 'password123'; // betterleaks:allow — fake password, local emulator only, never real auth

initializeApp({ projectId: 'demo-al' });
const auth = getAuth();
const db = getFirestore();

async function seed() {
  const users = [
    { uid: 'borrower1', role: 'borrower', name: 'Alice Borrower', email: 'alice@test.com' },
    { uid: 'broker1', role: 'broker', name: 'Bob Broker', email: 'bob@test.com' },
    { uid: 'underwriter1', role: 'underwriter', name: 'Uma Underwriter', email: 'uma@test.com' },
  ];

  for (const u of users) {
    await auth.createUser({ uid: u.uid, email: u.email, password: DEMO_PASSWORD });
    await auth.setCustomUserClaims(u.uid, { role: u.role });
    await db.collection('users').doc(u.uid).set(u);
  }

  await db.collection('applications').add({
    borrowerId: 'borrower1',
    brokerId: 'broker1',
    status: 'Applied',
    createdAt: FieldValue.serverTimestamp(),
  });

  await db.collection('applications').add({
    borrowerId: 'borrower1',
    brokerId: 'broker1',
    status: 'Underwriter Approved',
    createdAt: FieldValue.serverTimestamp(),
  });

  console.log('Seed complete');
}

seed().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});