// What the Firestore rules should answer for each person and each request (AL-321). Data and small pure functions only: nothing here
// touches the network or the environment, so scripts/check-hosted-rules.js (the live check) and test/hosted-rules-probes.test.js
// (which replays this same table through the rules engine on the emulator) share one source of truth.
//
// The expected answers come from al-core/firestore.rules: clients only read, so every write is refused, and a read is allowed
// by role. A read of a document that does not exist is still "allowed" when the rules would allow it (Firestore answers 404, not 403),
// which is why the hosted project does not need any applications for this check.
//
// Fixture assumed (the demo accounts in scripts/demo-users.js): users/borrower1 (Alice, broker1), users/borrower2 (Ben, broker2),
// users/broker1 (Bob), users/broker2 (Ciara), users/underwriter1 (Uma). Everything else is probed at ids that do not exist.

const ACTORS = {
  alice: { uid: 'borrower1', role: 'borrower', local: 'alice' },
  bob: { uid: 'broker1', role: 'broker', local: 'bob' },
  uma: { uid: 'underwriter1', role: 'underwriter', local: 'uma' },
};

const NOBODY = null; // a request with no sign-in at all

const GHOST_APP = 'rules-probe-app'; // an application id that does not exist
const PROBE_DOC = 'rules-probe-doc'; // a document id that does not exist

const probes = [];
const read = (actor, path, expect, why) => probes.push({ actor, op: 'get', path, expect, why });
const write = (actor, path, why) => probes.push({ actor, op: 'write', path, expect: 'deny', why });
const remove = (actor, path, why) => probes.push({ actor, op: 'delete', path, expect: 'deny', why });

// ---------- users: your own profile, a broker's clients, everyone for the underwriter ----------
read('alice', 'users/borrower1', 'allow', 'a borrower reads their own profile');
read('alice', 'users/borrower2', 'deny', 'a borrower cannot read another borrower');
read('alice', 'users/broker1', 'deny', 'a borrower cannot read a broker');
read('alice', 'users/underwriter1', 'deny', 'a borrower cannot read the underwriter');
read('bob', 'users/broker1', 'allow', 'a broker reads their own profile');
read('bob', 'users/borrower1', 'allow', 'a broker reads their own client (brokerId matches)');
read('bob', 'users/borrower2', 'deny', 'a broker cannot read another broker\'s client');
read('bob', 'users/broker2', 'deny', 'a broker cannot read another broker');
read('bob', 'users/underwriter1', 'deny', 'a broker cannot read the underwriter');
for (const uid of ['borrower1', 'borrower2', 'broker1', 'broker2', 'underwriter1']) {
  read('uma', `users/${uid}`, 'allow', 'the underwriter reads every profile');
}
read(NOBODY, 'users/borrower1', 'deny', 'no sign-in, no read');

// ---------- a borrower's saved checks: only the owner, not even the underwriter ----------
read('alice', `users/borrower1/saved_checks/${PROBE_DOC}`, 'allow', 'a borrower reads their own saved checks');
read('alice', `users/borrower2/saved_checks/${PROBE_DOC}`, 'deny', 'not another borrower\'s');
read('bob', `users/borrower1/saved_checks/${PROBE_DOC}`, 'deny', 'not a broker');
read('uma', `users/borrower1/saved_checks/${PROBE_DOC}`, 'deny', 'not even the underwriter');

// ---------- applications and what hangs off them: the underwriter reads, the others only their own (none exist here) ----------
read('uma', `applications/${GHOST_APP}`, 'allow', 'the underwriter may read any application');
read('alice', `applications/${GHOST_APP}`, 'deny', 'a borrower reads only their own');
read('bob', `applications/${GHOST_APP}`, 'deny', 'a broker reads only their own clients\'');
read(NOBODY, `applications/${GHOST_APP}`, 'deny', 'no sign-in, no read');
read('uma', `applications/${GHOST_APP}/audit/record`, 'allow', 'the underwriter reads the audit record');
read('alice', `applications/${GHOST_APP}/audit/record`, 'deny', 'a borrower never reads the audit record');
read('bob', `applications/${GHOST_APP}/audit/record`, 'deny', 'a broker reads it only for their own client');
read('uma', `applications/${GHOST_APP}/messages/${PROBE_DOC}`, 'allow', 'the underwriter reads messages');
read('alice', `applications/${GHOST_APP}/messages/${PROBE_DOC}`, 'deny', 'a borrower reads messages only of their own application');
read('bob', `applications/${GHOST_APP}/messages/${PROBE_DOC}`, 'deny', 'a broker the same');
read('uma', `applications/${GHOST_APP}/readState/underwriter1`, 'allow', 'a person reads their own read marker');
read('uma', `applications/${GHOST_APP}/readState/borrower1`, 'deny', 'but not someone else\'s');
read('alice', `applications/${GHOST_APP}/readState/borrower1`, 'deny', 'and only while they can read the application');
read('uma', `applications/${GHOST_APP}/review/underwriting`, 'allow', 'the underwriter reads the review');
read('alice', `applications/${GHOST_APP}/review/underwriting`, 'deny', 'a borrower never reads the review');
read('bob', `applications/${GHOST_APP}/review/underwriting`, 'deny', 'a broker only for their own client');

// ---------- the AI committee's records ----------
for (const collection of ['ai_runs', 'ai_calls']) {
  read('uma', `${collection}/${PROBE_DOC}`, 'allow', `the underwriter reads ${collection}`);
  read('alice', `${collection}/${PROBE_DOC}`, 'deny', `a borrower never reads ${collection}`);
  read('bob', `${collection}/${PROBE_DOC}`, 'deny', collection === 'ai_calls'
    ? 'a broker never reads ai_calls, even for their own client (AL-334)'
    : 'a broker reads ai_runs only for their own client');
  read(NOBODY, `${collection}/${PROBE_DOC}`, 'deny', 'no sign-in, no read');
}

// ---------- support requests and reviews ----------
read('uma', `support_requests/${PROBE_DOC}`, 'allow', 'the underwriter reads support requests');
read('alice', `support_requests/${PROBE_DOC}`, 'deny', 'a borrower reads only their own');
read('bob', `support_requests/${PROBE_DOC}`, 'deny', 'a broker does not read support requests');
read('alice', 'reviews/borrower1', 'allow', 'a borrower reads their own review');
read('alice', 'reviews/borrower2', 'deny', 'not another borrower\'s');
read('bob', 'reviews/broker1', 'allow', 'anyone signed in reads the review with their own uid');
read('bob', 'reviews/borrower1', 'deny', 'a broker does not read a borrower\'s review');
read('uma', 'reviews/borrower1', 'allow', 'the underwriter reads every review');
read(NOBODY, 'reviews/borrower1', 'deny', 'no sign-in, no read');

// ---------- writes: there is no `allow write` anywhere, so every one is refused, for every role and for no sign-in ----------
const WRITE_TARGETS = [
  `users/${PROBE_DOC}`,
  `applications/${PROBE_DOC}`,
  `applications/${PROBE_DOC}/messages/${PROBE_DOC}`,
  `applications/${PROBE_DOC}/audit/${PROBE_DOC}`,
  `applications/${PROBE_DOC}/review/${PROBE_DOC}`,
  `ai_runs/${PROBE_DOC}`,
  `ai_calls/${PROBE_DOC}`,
  `support_requests/${PROBE_DOC}`,
  `reviews/${PROBE_DOC}`,
];
for (const actor of ['alice', 'bob', 'uma', NOBODY]) {
  for (const target of WRITE_TARGETS) write(actor, target, 'no client may create or change anything');
  remove(actor, `applications/${PROBE_DOC}`, 'no client may delete anything');
  remove(actor, `reviews/${PROBE_DOC}`, 'no client may delete anything');
}

/** What an answer from Firestore means. Reads: 200 or 404 (allowed, the document just may not exist), 403 (refused). Writes: 200 would mean allowed. */
function classify(status) {
  if (status === 200 || status === 404) return 'allow';
  if (status === 403) return 'deny';
  return 'error'; // 401 (the token was not accepted), 400, 429, 5xx: not an answer about the rules
}

/** The `role` claim in an ID token, read without checking the signature (we only want to see what the rules will see). */
function roleFromToken(idToken) {
  try {
    const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).role;
  } catch {
    return undefined;
  }
}

/** The probe's name for a report: who, what, where. */
function label(probe) {
  const who = probe.actor === NOBODY ? 'signed out' : `${probe.actor} (${ACTORS[probe.actor].role})`;
  const verb = { get: 'read', write: 'write', delete: 'delete' }[probe.op];
  return `${who} ${verb} ${probe.path}`;
}

/** How many probes there are, per person and kind, for a dry run. */
function summarise(list = probes) {
  const counts = {};
  for (const p of list) {
    const key = p.actor === NOBODY ? 'signed out' : p.actor;
    counts[key] = counts[key] || { get: 0, write: 0, delete: 0 };
    counts[key][p.op] += 1;
  }
  return counts;
}

module.exports = { ACTORS, NOBODY, PROBES: probes, GHOST_APP, PROBE_DOC, classify, roleFromToken, label, summarise };
