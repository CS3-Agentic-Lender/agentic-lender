// Replays scripts/hosted-rules-probes.js through the Firestore rules engine on the emulator (AL-321). The live check against the hosted
// project uses this same table, so this test is what proves the table matches firestore.rules. Needs the Firestore emulator, like
// rules.test.js: firebase emulators:exec --only firestore --project demo-al-test "npx jest"
// It finds the emulator through FIRESTORE_EMULATOR_HOST, which emulators:exec sets, so it works on any port.
//
// The fixture is only what the hosted project has: the five demo users, plus the local admin (admin@test.com, uid admin1 in
// scripts/demo-users.js). The rules judge the admin by its `role` claim, so its uid and email don't change any answer. Every other probe is at an id that does not exist.

const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');
const { ACTORS, PROBES, PROBE_DOC, label } = require('../scripts/hosted-rules-probes');

let testEnv;

// "127.0.0.1:8090" -> { host, port }; the usual 127.0.0.1:8080 when the variable is not set.
const emulator = (() => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  return { host, port: Number(port) };
})();

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-al-probes', // its own project: Jest runs files in parallel, and clearFirestore() below must not wipe rules.test.js's data
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'), ...emulator },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('users/borrower1').set({ uid: 'borrower1', role: 'borrower', fullName: 'Alice Byrne', brokerId: 'broker1' });
    await db.doc('users/borrower2').set({ uid: 'borrower2', role: 'borrower', fullName: 'Ben Walsh', brokerId: 'broker2' });
    await db.doc('users/broker1').set({ uid: 'broker1', role: 'broker', fullName: 'Bob Murphy' });
    await db.doc('users/broker2').set({ uid: 'broker2', role: 'broker', fullName: 'Ciara Kelly' });
    await db.doc('users/underwriter1').set({ uid: 'underwriter1', role: 'underwriter', fullName: 'Uma Nolan' });
    await db.doc('users/admin1').set({ uid: 'admin1', role: 'admin', fullName: 'Admin' });
  });
});

const dbFor = (actor) => {
  if (actor === null) return testEnv.unauthenticatedContext().firestore();
  const { uid, role } = ACTORS[actor];
  return testEnv.authenticatedContext(uid, { role }).firestore();
};

// The same three operations the live check sends over REST: a get, an upsert (PATCH creates or changes), and a delete.
const attempt = (probe) => {
  const ref = dbFor(probe.actor).doc(probe.path);
  if (probe.op === 'get') return ref.get();
  if (probe.op === 'write') return ref.set({ probe: true }, { merge: true });
  return ref.delete();
};

describe('every probe gets the answer the table expects', () => {
  test.each(PROBES.map((probe) => [label(probe), probe]))('%s', async (_name, probe) => {
    if (probe.expect === 'allow') await assertSucceeds(attempt(probe));
    else await assertFails(attempt(probe));
  });
});

describe('the table itself', () => {
  test('it has reads that are allowed and reads that are refused, so a mix-up in either direction would be caught', () => {
    const reads = PROBES.filter((p) => p.op === 'get');
    expect(reads.filter((p) => p.expect === 'allow').length).toBeGreaterThan(10);
    expect(reads.filter((p) => p.expect === 'deny').length).toBeGreaterThan(20);
  });

  test('every write and delete is expected to be refused, for all four roles and for no sign-in', () => {
    const writes = PROBES.filter((p) => p.op !== 'get');
    expect(writes.length).toBeGreaterThanOrEqual(5 * 10);
    expect(writes.every((p) => p.expect === 'deny')).toBe(true);
    expect(new Set(writes.map((p) => p.actor))).toEqual(new Set(['alice', 'bob', 'uma', 'admin', null]));
  });

  test('the write harness works: the same upsert succeeds when the rules are off, so a refusal above really is the rules', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await assertSucceeds(context.firestore().doc(`applications/${PROBE_DOC}`).set({ probe: true }, { merge: true }));
      await assertSucceeds(context.firestore().doc(`applications/${PROBE_DOC}`).delete());
    });
  });

  test('every probe path has an even number of segments, so it points at a document', () => {
    for (const probe of PROBES) expect(probe.path.split('/').length % 2).toBe(0);
  });
});
