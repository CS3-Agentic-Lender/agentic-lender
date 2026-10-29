// Firestore rules tests. Needs the Firestore emulator running on 127.0.0.1:8080
// (firebase emulators:start --project demo-al), then: npx jest
//
// Each test seeds the same small fixture with rules disabled, then checks one read
// or write as a given user. Every collection has an allowed read, a denied read and
// a denied write.

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-al-test',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const set = (p, data) => db.doc(p).set(data);

    await set('users/borrower1', { uid: 'borrower1', role: 'borrower', fullName: 'Alice', brokerId: 'broker1' });
    await set('users/borrower2', { uid: 'borrower2', role: 'borrower', fullName: 'Ben', brokerId: 'broker2' });
    await set('users/broker1', { uid: 'broker1', role: 'broker', fullName: 'Bob' });
    await set('users/broker2', { uid: 'broker2', role: 'broker', fullName: 'Ciara' });
    await set('users/underwriter1', { uid: 'underwriter1', role: 'underwriter', fullName: 'Uma' });
    await set('users/borrower1/saved_checks/check1', { estimatedValueEur: 310000 });

    await set('applications/app1', {
      borrowerId: 'borrower1', brokerId: 'broker1', status: 'AI Deliberated', loanType: 'mortgage',
      ltvBand: '80_to_90', riskTier: 'B', submittedAt: new Date('2026-10-02T09:00:00Z'),
    });
    await set('applications/app2', {
      borrowerId: 'borrower2', brokerId: 'broker2', status: 'AI Deliberated', loanType: 'heloc',
      ltvBand: 'over_90', riskTier: 'D', submittedAt: new Date('2026-10-03T09:00:00Z'),
    });
    await set('applications/app3', {
      borrowerId: 'borrower1', brokerId: 'broker1', status: 'Draft', submittedAt: new Date('2026-10-04T09:00:00Z'),
    });
    await set('applications/app3/audit/record', { applicationId: 'app3', auditHash: 'def' });
    await set('applications/app3/messages/msg3', { senderId: 'borrower1', text: 'Draft note', read: false });
    await set('applications/app1/review/underwriting', { applicationId: 'app1', brokerId: 'broker1', riskTier: 'B' });
    await set('applications/app2/review/underwriting', { applicationId: 'app2', brokerId: 'broker2', riskTier: 'D' });
    await set('applications/app1/audit/record', { applicationId: 'app1', auditHash: 'abc' });
    await set('applications/app1/messages/msg1', { senderId: 'broker1', text: 'Hi', read: false });

    await set('ai_runs/run1', { applicationId: 'app1', brokerId: 'broker1', status: 'complete' });
    await set('ai_runs/run2', { applicationId: 'app2', brokerId: 'broker2', status: 'complete' });
    await set('ai_calls/call1', { runId: 'run1', applicationId: 'app1', brokerId: 'broker1' });
    await set('ai_calls/call2', { runId: 'run2', applicationId: 'app2', brokerId: 'broker2' });

    await set('support_requests/req1', { userId: 'borrower1', subject: 'Help', status: 'open' });
    await set('reviews/borrower1', { userId: 'borrower1', rating: 5 });
  });
});

// Firestore handles for each test user.
const as = (uid, role) => testEnv.authenticatedContext(uid, { role }).firestore();
const borrower1 = () => as('borrower1', 'borrower');
const borrower2 = () => as('borrower2', 'borrower');
const broker1 = () => as('broker1', 'broker');
const broker2 = () => as('broker2', 'broker');
const underwriter = () => as('underwriter1', 'underwriter');
const signedOut = () => testEnv.unauthenticatedContext().firestore();

describe('users', () => {
  test('a borrower can read their own profile', () =>
    assertSucceeds(borrower1().doc('users/borrower1').get()));
  test("a borrower can't read another user's profile", () =>
    assertFails(borrower1().doc('users/borrower2').get()));
  test("a broker can read their client's profile", () =>
    assertSucceeds(broker1().doc('users/borrower1').get()));
  test("a broker can't read another broker's client", () =>
    assertFails(broker1().doc('users/borrower2').get()));
  test("a broker can't read another staff member's profile", () =>
    assertFails(broker1().doc('users/underwriter1').get()));
  test('a broker can list their clients when filtering on brokerId', () =>
    assertSucceeds(broker1().collection('users').where('brokerId', '==', 'broker1').get()));
  test("a broker can't list users without the brokerId filter", () =>
    assertFails(broker1().collection('users').get()));
  test('after a broker change the new broker can read the profile and the old one cannot', async () => {
    await testEnv.withSecurityRulesDisabled((context) =>
      context.firestore().doc('users/borrower1').update({ brokerId: 'broker2' }));
    await assertSucceeds(broker2().doc('users/borrower1').get());
    await assertFails(broker1().doc('users/borrower1').get());
  });
  test('after a broker change the old broker keeps the applications made before it', async () => {
    await testEnv.withSecurityRulesDisabled((context) =>
      context.firestore().doc('users/borrower1').update({ brokerId: 'broker2' }));
    await assertSucceeds(broker1().doc('applications/app1').get());
    await assertFails(broker2().doc('applications/app1').get());
  });
  test('an underwriter can read any profile', () =>
    assertSucceeds(underwriter().doc('users/borrower2').get()));
  test("a signed-out user can't read profiles", () =>
    assertFails(signedOut().doc('users/borrower1').get()));
  test("a borrower can't write their own profile", () =>
    assertFails(borrower1().doc('users/borrower1').set({ fullName: 'Changed' }, { merge: true })));
});

describe('users/{uid}/saved_checks', () => {
  test('a borrower can read their own saved checks', () =>
    assertSucceeds(borrower1().collection('users/borrower1/saved_checks').get()));
  test("a broker can't read a client's saved checks", () =>
    assertFails(broker1().doc('users/borrower1/saved_checks/check1').get()));
  test("a borrower can't add a saved check directly", () =>
    assertFails(borrower1().collection('users/borrower1/saved_checks').add({ estimatedValueEur: 1 })));
  // Only the owner reads a saved check, and only the API (the Admin SDK) writes one (AL-272).
  test("a borrower can't read another borrower's saved check", () =>
    assertFails(borrower2().doc('users/borrower1/saved_checks/check1').get()));
  test("an underwriter can't read a borrower's saved check", () =>
    assertFails(underwriter().doc('users/borrower1/saved_checks/check1').get()));
  test("a signed-out user can't read a saved check", () =>
    assertFails(signedOut().doc('users/borrower1/saved_checks/check1').get()));
  test("a borrower can't change or delete their own saved check directly", async () => {
    const own = borrower1().doc('users/borrower1/saved_checks/check1');
    await assertFails(own.update({ estimatedValueEur: 1 }));
    await assertFails(own.set({ estimatedValueEur: 1, property: { eircode: 'T12 X8Y2' } }));
    await assertFails(own.delete());
  });
  test("a staff member can't add a saved check to a borrower", async () => {
    await assertFails(broker1().collection('users/borrower1/saved_checks').add({ estimatedValueEur: 1 }));
    await assertFails(underwriter().collection('users/borrower1/saved_checks').add({ estimatedValueEur: 1 }));
  });
});

// Brokers don't read Drafts (AL-263). A broker's query must exclude them, or Firestore refuses it.
describe('applications: brokers and Drafts', () => {
  const brokerQuery = (db) => db.collection('applications').where('brokerId', '==', 'broker1');

  test("a broker can't read their client's Draft", () =>
    assertFails(broker1().doc('applications/app3').get()));
  for (const status of ['Applied', 'AI Deliberated', 'Underwriter Approved', 'Declined', 'Funded', 'Closed']) {
    test(`a broker can read their client's ${status} application`, async () => {
      await testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('applications/app3').update({ status }));
      await assertSucceeds(broker1().doc('applications/app3').get());
    });
  }
  test('a broker query for brokerId == uid and status != Draft succeeds and leaves the Draft out', async () => {
    const snap = await assertSucceeds(brokerQuery(broker1()).where('status', '!=', 'Draft').get());
    expect(snap.docs.map((d) => d.id)).toEqual(['app1']);
  });
  test("a broker query without the status filter is refused, because it could return a Draft", () =>
    assertFails(brokerQuery(broker1()).get()));
  test("a broker can't read the audit record under a Draft", () =>
    assertFails(broker1().doc('applications/app3/audit/record').get()));
  test("a broker can't read the messages under a Draft", () =>
    assertFails(broker1().doc('applications/app3/messages/msg3').get()));
  test('the audit record and messages open to the broker once the application is Applied', async () => {
    await testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('applications/app3').update({ status: 'Applied' }));
    await assertSucceeds(broker1().doc('applications/app3/audit/record').get());
    await assertSucceeds(broker1().doc('applications/app3/messages/msg3').get());
  });
  test('a borrower can still read their own Draft and its messages', async () => {
    await assertSucceeds(borrower1().doc('applications/app3').get());
    await assertSucceeds(borrower1().doc('applications/app3/messages/msg3').get());
  });
  test('an underwriter can still read a Draft, its audit record and its messages', async () => {
    await assertSucceeds(underwriter().doc('applications/app3').get());
    await assertSucceeds(underwriter().doc('applications/app3/audit/record').get());
    await assertSucceeds(underwriter().doc('applications/app3/messages/msg3').get());
  });
  test("a broker still can't read another broker's client's application", () =>
    assertFails(broker2().doc('applications/app3').get()));
});

describe('applications', () => {
  test('a borrower can read their own application', () =>
    assertSucceeds(borrower1().doc('applications/app1').get()));
  test("a borrower can't read someone else's application", () =>
    assertFails(borrower1().doc('applications/app2').get()));
  test('a borrower can list their applications when filtering on borrowerId', () =>
    assertSucceeds(borrower1().collection('applications').where('borrowerId', '==', 'borrower1').get()));
  test("a borrower can't list applications without the borrowerId filter", () =>
    assertFails(borrower1().collection('applications').get()));
  test("a broker can read their client's application", () =>
    assertSucceeds(broker1().doc('applications/app1').get()));
  test("a broker can't read another broker's client's application", () =>
    assertFails(broker2().doc('applications/app1').get()));
  test('an underwriter can read any application', () =>
    assertSucceeds(underwriter().doc('applications/app2').get()));
  test("a borrower can't change their application's status", () =>
    assertFails(borrower1().doc('applications/app1').update({ status: 'Underwriter Approved' })));
  test("a borrower can't create an application directly", () =>
    assertFails(borrower1().collection('applications').add({ borrowerId: 'borrower1', brokerId: 'broker1', status: 'Draft' })));
});

// The underwriter's pipeline queue (AL-64): status with LTV band or risk tier, newest first.
describe('pipeline queue', () => {
  const queue = (db, field, value) =>
    db.collection('applications')
      .where('status', '==', 'AI Deliberated')
      .where(field, '==', value)
      .orderBy('submittedAt', 'desc')
      .get();

  test('an underwriter can filter by status and LTV band', async () => {
    const snap = await assertSucceeds(queue(underwriter(), 'ltvBand', 'over_90'));
    expect(snap.docs.map((d) => d.id)).toEqual(['app2']);
  });
  test('an underwriter can filter by status and risk tier', async () => {
    const snap = await assertSucceeds(queue(underwriter(), 'riskTier', 'B'));
    expect(snap.docs.map((d) => d.id)).toEqual(['app1']);
  });
  test('an underwriter can filter by status and loan type', async () => {
    const snap = await assertSucceeds(queue(underwriter(), 'loanType', 'heloc'));
    expect(snap.docs.map((d) => d.id)).toEqual(['app2']);
  });
  test('the queue is newest first', async () => {
    const snap = await assertSucceeds(
      underwriter().collection('applications').where('status', '==', 'AI Deliberated').orderBy('submittedAt', 'desc').get(),
    );
    expect(snap.docs.map((d) => d.id)).toEqual(['app2', 'app1']);
  });
  test("a broker can't run the whole queue", () => assertFails(queue(broker1(), 'riskTier', 'B')));
  // Only al-ai (through the Admin SDK) sets the band and tier.
  for (const [who, db] of [['borrower', borrower1], ['broker', broker1], ['underwriter', underwriter]]) {
    test(`a ${who} can't change the LTV band or risk tier`, async () => {
      await assertFails(db().doc('applications/app1').update({ riskTier: 'A' }));
      await assertFails(db().doc('applications/app1').update({ ltvBand: '80_or_less' }));
    });
  }
  test("a borrower can't run the whole queue", () => assertFails(queue(borrower1(), 'riskTier', 'B')));
});

test('firestore.indexes.json has an index for every queue and broker query', () => {
  const { indexes } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../firestore.indexes.json'), 'utf8'));
  const shapes = indexes.map((i) => `${i.collectionGroup}:${i.fields.map((f) => `${f.fieldPath} ${f.order}`).join(',')}`);
  expect(shapes).toEqual([
    'applications:status ASCENDING,submittedAt DESCENDING',
    'applications:status ASCENDING,ltvBand ASCENDING,submittedAt DESCENDING',
    'applications:status ASCENDING,loanType ASCENDING,submittedAt DESCENDING',
    'applications:status ASCENDING,riskTier ASCENDING,submittedAt DESCENDING',
    // The broker's application query: brokerId == uid and status != 'Draft' (AL-263).
    'applications:brokerId ASCENDING,status ASCENDING',
  ]);
});

describe('applications/{id}/review/underwriting', () => {
  test('an underwriter can read a review', () =>
    assertSucceeds(underwriter().doc('applications/app2/review/underwriting').get()));
  test("a broker can read their client's review", () =>
    assertSucceeds(broker1().doc('applications/app1/review/underwriting').get()));
  test("a broker can't read another broker's review", () =>
    assertFails(broker1().doc('applications/app2/review/underwriting').get()));
  test("a borrower can't read their own review", () =>
    assertFails(borrower1().doc('applications/app1/review/underwriting').get()));
  test('an underwriter can query every review across applications', () =>
    assertSucceeds(underwriter().collectionGroup('review').get()));
  test('a broker can query reviews across applications when filtering on brokerId', () =>
    assertSucceeds(broker1().collectionGroup('review').where('brokerId', '==', 'broker1').get()));
  test("a broker can't query reviews across applications without the brokerId filter", () =>
    assertFails(broker1().collectionGroup('review').get()));
  test("a borrower can't query reviews across applications", () =>
    assertFails(borrower1().collectionGroup('review').where('brokerId', '==', 'broker1').get()));
  test("an underwriter can't write a review directly", () =>
    assertFails(underwriter().doc('applications/app1/review/underwriting').set({ riskTier: 'A' })));
  // The DTI breakdown is written by the API only (al-ai, with the Admin SDK): no client can change a figure in it.
  for (const [who, db] of [['borrower', borrower1], ['broker', broker1], ['underwriter', underwriter]]) {
    test(`a ${who} can't write the DTI breakdown`, async () => {
      const review = db().doc('applications/app1/review/underwriting');
      await assertFails(review.update({ 'dtiBreakdown.stressedDtiPct': 20 }));
      await assertFails(review.set({ dtiBreakdown: { dtiBand: 'Comfortable' } }, { merge: true }));
    });
  }
});

describe('applications/{id}/audit/record', () => {
  test('an underwriter can read an audit record', () =>
    assertSucceeds(underwriter().doc('applications/app1/audit/record').get()));
  test("a broker can read their client's audit record", () =>
    assertSucceeds(broker1().doc('applications/app1/audit/record').get()));
  test("a broker can't read another broker's audit record", () =>
    assertFails(broker2().doc('applications/app1/audit/record').get()));
  test("a borrower can't read their own audit record", () =>
    assertFails(borrower1().doc('applications/app1/audit/record').get()));
  test("an underwriter can't write an audit record directly", () =>
    assertFails(underwriter().doc('applications/app1/audit/record').set({ auditHash: 'x' })));
});

describe('applications/{id}/messages', () => {
  test('a borrower can read messages on their own application', () =>
    assertSucceeds(borrower1().collection('applications/app1/messages').get()));
  test("a borrower can't read messages on someone else's application", () =>
    assertFails(borrower2().collection('applications/app1/messages').get()));
  test("a broker can read messages on their client's application", () =>
    assertSucceeds(broker1().collection('applications/app1/messages').get()));
  test("a broker can't read messages on another broker's application", () =>
    assertFails(broker2().collection('applications/app1/messages').get()));
  test('an underwriter can read messages on any application', () =>
    assertSucceeds(underwriter().collection('applications/app1/messages').get()));
  test("a borrower can't send a message directly", () =>
    assertFails(borrower1().collection('applications/app1/messages').add({ senderId: 'borrower1', text: 'Hi' })));
});

describe('ai_runs and ai_calls', () => {
  test('an underwriter can read any AI run', () =>
    assertSucceeds(underwriter().doc('ai_runs/run2').get()));
  test("a broker can read their client's AI run", () =>
    assertSucceeds(broker1().doc('ai_runs/run1').get()));
  test("a broker can't read another broker's AI run", () =>
    assertFails(broker1().doc('ai_runs/run2').get()));
  test("a borrower can't read an AI run", () =>
    assertFails(borrower1().doc('ai_runs/run1').get()));
  test('a broker can list their AI calls when filtering on brokerId', () =>
    assertSucceeds(broker1().collection('ai_calls').where('brokerId', '==', 'broker1').get()));
  test("a borrower can't read an AI call", () =>
    assertFails(borrower1().doc('ai_calls/call1').get()));
  test("an underwriter can't write an AI run directly", () =>
    assertFails(underwriter().doc('ai_runs/run1').update({ status: 'failed' })));
});

describe('support_requests', () => {
  test('a borrower can read their own support request', () =>
    assertSucceeds(borrower1().doc('support_requests/req1').get()));
  test("a borrower can't read someone else's support request", () =>
    assertFails(borrower2().doc('support_requests/req1').get()));
  test('an underwriter can read any support request', () =>
    assertSucceeds(underwriter().doc('support_requests/req1').get()));
  test("a broker can't read a support request, even their client's", () =>
    assertFails(broker1().doc('support_requests/req1').get()));
  test("a borrower can't create a support request directly", () =>
    assertFails(borrower1().collection('support_requests').add({ userId: 'borrower1', subject: 'Hi' })));
});

describe('reviews', () => {
  test('a borrower can read their own review', () =>
    assertSucceeds(borrower1().doc('reviews/borrower1').get()));
  test("a borrower can't read someone else's review", () =>
    assertFails(borrower2().doc('reviews/borrower1').get()));
  test('an underwriter can read any review', () =>
    assertSucceeds(underwriter().doc('reviews/borrower1').get()));
  test("a broker can't read a review, even their client's", () =>
    assertFails(broker1().doc('reviews/borrower1').get()));
  test("a borrower can't write their review directly", () =>
    assertFails(borrower1().doc('reviews/borrower1').set({ userId: 'borrower1', rating: 1 })));
});
