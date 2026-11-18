// Checks the Firestore rules that are DEPLOYED on the hosted Firebase project with real sign-ins (AL-321).
//
//   node scripts/check-hosted-rules.js --dry-run   show what it would check, send nothing
//   node scripts/check-hosted-rules.js             sign in as Alice, Bob and Uma and try every probe
//
// It needs, in your shell (never in a file in this repo):
//
//   FIREBASE_PROJECT_ID           the hosted project's id. A `demo-` id is refused: that is the emulators' project.
//   FIREBASE_API_KEY              the project's web API key (the API_KEY in GoogleService-Info.plist). It is not a secret, but it is not printed.
//   HOSTED_DEMO_PASSWORD          the demo accounts' password (see scripts/create-hosted-accounts.js). Never printed or stored.
//   HOSTED_DEMO_EMAIL_DOMAIN      optional, default example.com, as for create-hosted-accounts.js
//
// No service account key is needed: it signs in the way the app does, then asks Firestore's REST API with each person's ID token,
// so the rules decide. The probes are in scripts/hosted-rules-probes.js, and test/hosted-rules-probes.test.js replays the same table
// through the rules engine on the emulator, so what this checks is what the repo's own rules tests check.
//
// What it will not do: run with an emulator host set, run against a `demo-` project, or print the password. Every write it tries is
// at an id that does not exist (rules-probe-doc), so if a rule ever wrongly allowed one, no real data is touched; the script then
// lists the junk documents it created so they can be deleted in the console.
//
// Exit code 0 only if every probe got the answer the table expects.

const { ACTORS, NOBODY, PROBES, classify, roleFromToken, label, summarise } = require('./hosted-rules-probes');

const EMULATOR_HOSTS = ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'];
const DEFAULT_DOMAIN = 'example.com';

class SetupError extends Error {}

/** The settings, or a SetupError saying what to fix. With dryRun, only the project and domain are needed: nothing is sent. */
function validate(env, { dryRun = false } = {}) {
  const projectId = (env.FIREBASE_PROJECT_ID || '').trim();
  if (!projectId) throw new SetupError('FIREBASE_PROJECT_ID is not set. It is the hosted project\'s id, from the Firebase console.');
  if (projectId.startsWith('demo-')) {
    throw new SetupError(`FIREBASE_PROJECT_ID is "${projectId}", a demo project. That is the emulators' project: the rules tests cover it.`);
  }
  const emulator = EMULATOR_HOSTS.filter((name) => env[name]);
  if (emulator.length) throw new SetupError(`${emulator.join(' and ')} is set. Unset it: this check is for the hosted project, not an emulator.`);

  const domain = (env.HOSTED_DEMO_EMAIL_DOMAIN || DEFAULT_DOMAIN).trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    throw new SetupError(`HOSTED_DEMO_EMAIL_DOMAIN "${domain}" is not a domain name.`);
  }
  if (dryRun) return { projectId, domain };

  const apiKey = (env.FIREBASE_API_KEY || '').trim();
  if (!apiKey) throw new SetupError('FIREBASE_API_KEY is not set. It is the API_KEY in GoogleService-Info.plist (the project\'s web API key).');
  const password = env.HOSTED_DEMO_PASSWORD || '';
  if (!password) throw new SetupError('HOSTED_DEMO_PASSWORD is not set. Type it into this shell only, with a hidden prompt.');
  if (password.length < 12) throw new SetupError('HOSTED_DEMO_PASSWORD is shorter than 12 characters, so it is not the hosted demo password.');
  return { projectId, domain, apiKey, password };
}

/** Signs in with email and password and returns the ID token. On failure, says which account and Firebase's reason code, never the password. */
async function signIn(fetchFn, apiKey, email, password) {
  const response = await fetchFn(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.idToken) {
    const reason = (body.error && body.error.message) || `HTTP ${response.status}`;
    throw new SetupError(`could not sign in as ${email}: ${reason}`);
  }
  return body.idToken;
}

/** One request to Firestore's REST API; returns the HTTP status, or 0 if the request could not be made at all. */
async function ask(fetchFn, base, token, probe) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const url = `${base}/${probe.path}`;
  try {
    if (probe.op === 'get') return (await fetchFn(url, { method: 'GET', headers })).status;
    if (probe.op === 'delete') return (await fetchFn(url, { method: 'DELETE', headers })).status;
    const response = await fetchFn(`${url}?updateMask.fieldPaths=probe`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { probe: { booleanValue: true } } }),
    });
    return response.status;
  } catch {
    return 0;
  }
}

/**
 * Signs in as each person, checks the ID token carries the right role, tries every probe and compares the answer with the table.
 * Returns what happened; throws a SetupError if a sign-in fails or a token has the wrong role (then the rules answers would mean nothing).
 */
async function check({ fetchFn, projectId, domain, apiKey, password, probes = PROBES }) {
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;

  const tokens = { [NOBODY]: null };
  const roles = {};
  for (const actor of new Set(probes.map((p) => p.actor).filter((a) => a !== NOBODY))) {
    const { local, role } = ACTORS[actor];
    tokens[actor] = await signIn(fetchFn, apiKey, `${local}@${domain}`, password);
    roles[actor] = roleFromToken(tokens[actor]);
    if (roles[actor] !== role) throw new SetupError(`the ID token for ${local}@${domain} carries role "${roles[actor]}", not "${role}", so the rules would judge it wrongly.`);
  }

  const results = [];
  for (const probe of probes) {
    const status = await ask(fetchFn, base, tokens[probe.actor], probe);
    const got = classify(status);
    results.push({ probe, status, got, ok: got === probe.expect });
  }
  const mismatches = results.filter((r) => !r.ok);
  // A write or delete that came back "allowed" may have created or changed something at a probe id: list those so they can be cleaned up.
  const createdByMistake = results.filter((r) => r.probe.op === 'write' && r.got === 'allow').map((r) => r.probe.path);
  return { roles, results, mismatches, createdByMistake };
}

function report(outcome) {
  const lines = [];
  const byActor = new Map();
  for (const r of outcome.results) {
    const key = r.probe.actor === NOBODY ? 'signed out' : r.probe.actor;
    byActor.set(key, byActor.get(key) || []);
    byActor.get(key).push(r);
  }
  for (const [actor, rows] of byActor) {
    const bad = rows.filter((r) => !r.ok).length;
    const who = actor === 'signed out' ? 'signed out' : `${actor} (${outcome.roles[actor]})`;
    lines.push(`${who.padEnd(20)} ${rows.length} probes, ${bad === 0 ? 'all as expected' : `${bad} DIFFERENT`}`);
  }
  for (const r of outcome.mismatches) {
    lines.push(`  MISMATCH  ${label(r.probe)}: expected ${r.probe.expect}, got ${r.got} (HTTP ${r.status})`);
  }
  if (outcome.createdByMistake.length) {
    lines.push('', 'A write was ALLOWED, so these documents may now exist and should be deleted in the Firebase console:');
    for (const p of outcome.createdByMistake) lines.push(`  ${p}`);
  }
  return lines.join('\n');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const settings = validate(process.env, { dryRun });

  if (dryRun) {
    console.log(`Dry run: would check the rules on the hosted project "${settings.projectId}" as ${Object.values(ACTORS).map((a) => `${a.local}@${settings.domain}`).join(', ')} and signed out.`);
    for (const [who, c] of Object.entries(summarise())) console.log(`  ${who.padEnd(12)} ${c.get} reads, ${c.write} writes, ${c.delete} deletes`);
    console.log(`\n${PROBES.length} probes in all. Nothing was sent.`);
    return 0;
  }

  console.log(`Checking the deployed rules on "${settings.projectId}" with real sign-ins (${PROBES.length} probes)...\n`);
  const outcome = await check({ fetchFn: fetch, ...settings });
  console.log(report(outcome));
  const ok = outcome.mismatches.length === 0;
  console.log(`\n${ok ? 'PASS: every probe got the answer the rules should give.' : `FAIL: ${outcome.mismatches.length} of ${PROBES.length} probes got a different answer.`}`);
  return ok ? 0 : 1;
}

module.exports = { validate, signIn, ask, check, report, SetupError };

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(err instanceof SetupError ? `\nStopped: ${err.message}` : err);
    process.exit(2);
  });
}
