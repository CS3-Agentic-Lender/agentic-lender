// scripts/check-hosted-rules.js (AL-321): every refusal, how answers are read, and what it reports, against a stand-in for Firebase.
// No emulator and no real project: the real run needs the hosted project and its demo password.

const { validate, signIn, check, report, probesFor, ADMIN_SKIPPED, SetupError } = require('../scripts/check-hosted-rules');
const { ACTORS, NOBODY, PROBES, classify, roleFromToken, label, summarise } = require('../scripts/hosted-rules-probes');

const GOOD_PASSWORD = 'a-long-demo-password'; // betterleaks:allow — fake test value, not a credential
const ADMIN_EMAIL = 'staff-q7x2@example.org'; // a stand-in: the real hosted admin's email is not in the repo
const ADMIN_PASSWORD = 'another-long-admin-pw'; // betterleaks:allow — fake test value, not a credential
const goodEnv = () => ({ FIREBASE_PROJECT_ID: 'agentic-lender', FIREBASE_API_KEY: 'fake-api-key', HOSTED_DEMO_PASSWORD: GOOD_PASSWORD });
const adminEnv = () => ({ ...goodEnv(), HOSTED_ADMIN_EMAIL: ADMIN_EMAIL, HOSTED_ADMIN_PASSWORD: ADMIN_PASSWORD });

const b64url = (object) => Buffer.from(JSON.stringify(object)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenFor = (actor, role = ACTORS[actor].role) => `${b64url({ alg: 'RS256' })}.${b64url({ role, user_id: ACTORS[actor].uid })}.signature`;

// A stand-in for fetch: signs people in, and answers Firestore requests from a function (token's actor, probe) -> HTTP status.
function fakeFirebase({ answer, roleOf = {}, signInFails = null }) {
  const sent = [];
  const actorOfToken = (auth) => Object.keys(ACTORS).find((a) => auth === `Bearer ${tokenFor(a, roleOf[a])}`) ?? NOBODY;
  const fetchFn = async (url, options = {}) => {
    sent.push({ url, options });
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) {
      const { email } = JSON.parse(options.body);
      if (signInFails) return { ok: false, status: 400, json: async () => ({ error: { message: signInFails } }) };
      const actor = email === ADMIN_EMAIL ? 'admin' : Object.keys(ACTORS).find((a) => ACTORS[a].local && email.startsWith(`${ACTORS[a].local}@`));
      return { ok: true, status: 200, json: async () => ({ idToken: tokenFor(actor, roleOf[actor]) }) };
    }
    const docPath = url.split('/documents/')[1].split('?')[0];
    const op = { GET: 'get', PATCH: 'write', DELETE: 'delete' }[options.method];
    const actor = actorOfToken((options.headers || {}).Authorization);
    const probe = PROBES.find((p) => p.actor === actor && p.op === op && p.path === docPath);
    return { status: await answer(probe, actor) };
  };
  return { fetchFn, sent };
}

// What Firestore would answer if it did exactly what the table says.
const asTheTableExpects = (probe) => (probe.expect === 'allow' ? (probe.path.split('/').length % 2 === 0 ? 404 : 200) : 403);

const run = (fake, settings = {}) => check({
  fetchFn: fake.fetchFn, projectId: 'agentic-lender', domain: 'example.com', apiKey: 'fake-api-key', password: GOOD_PASSWORD,
  adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD, ...settings,
});

describe('validate: what it refuses', () => {
  test('a good setup is accepted', () => {
    expect(validate(goodEnv())).toEqual({
      projectId: 'agentic-lender', domain: 'example.com', apiKey: 'fake-api-key', password: GOOD_PASSWORD, adminEmail: null, adminPassword: null,
    });
    expect(validate(adminEnv())).toMatchObject({ adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD });
  });

  test('no project id, and the emulators\' demo project', () => {
    const env = goodEnv();
    delete env.FIREBASE_PROJECT_ID;
    expect(() => validate(env)).toThrow(/FIREBASE_PROJECT_ID is not set/);
    expect(() => validate({ ...goodEnv(), FIREBASE_PROJECT_ID: 'demo-al' })).toThrow(/demo project/);
  });

  test.each(['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'])('%s set means this would not be the hosted project', (name) => {
    expect(() => validate({ ...goodEnv(), [name]: '127.0.0.1:9099' })).toThrow(new RegExp(`${name} is set`));
  });

  test('no API key, no password, and a password too short to be the demo one', () => {
    const noKey = goodEnv();
    delete noKey.FIREBASE_API_KEY;
    expect(() => validate(noKey)).toThrow(/FIREBASE_API_KEY is not set/);
    const noPassword = goodEnv();
    delete noPassword.HOSTED_DEMO_PASSWORD;
    expect(() => validate(noPassword)).toThrow(/HOSTED_DEMO_PASSWORD is not set/);
    expect(() => validate({ ...goodEnv(), HOSTED_DEMO_PASSWORD: 'short' })).toThrow(/shorter than 12/); // betterleaks:allow — fake test value
  });

  test('a bad email domain is refused and a custom one is lowercased', () => {
    expect(() => validate({ ...goodEnv(), HOSTED_DEMO_EMAIL_DOMAIN: 'not a domain' })).toThrow(/not a domain name/);
    expect(validate({ ...goodEnv(), HOSTED_DEMO_EMAIL_DOMAIN: 'Agentic-Lender.com' }).domain).toBe('agentic-lender.com');
  });

  test('a dry run needs neither the key nor the password, but still refuses a demo project and an emulator', () => {
    expect(validate({ FIREBASE_PROJECT_ID: 'agentic-lender' }, { dryRun: true })).toEqual({ projectId: 'agentic-lender', domain: 'example.com', adminEmail: null });
    expect(() => validate({ FIREBASE_PROJECT_ID: 'demo-al' }, { dryRun: true })).toThrow(/demo project/);
    expect(() => validate({ FIREBASE_PROJECT_ID: 'agentic-lender', FIRESTORE_EMULATOR_HOST: 'x' }, { dryRun: true })).toThrow(/is set/);
  });
});

describe('the admin, whose email is not in the repo', () => {
  test('HOSTED_ADMIN_EMAIL set needs HOSTED_ADMIN_PASSWORD, of a real length, and a real email address', () => {
    const noPassword = adminEnv();
    delete noPassword.HOSTED_ADMIN_PASSWORD;
    expect(() => validate(noPassword)).toThrow(/HOSTED_ADMIN_PASSWORD is not/);
    expect(() => validate({ ...adminEnv(), HOSTED_ADMIN_PASSWORD: 'short' })).toThrow(/HOSTED_ADMIN_PASSWORD is shorter than 12/); // betterleaks:allow — fake test value
    expect(() => validate({ ...adminEnv(), HOSTED_ADMIN_EMAIL: 'not-an-email' })).toThrow(/not an email address/);
  });

  test('without HOSTED_ADMIN_EMAIL the admin probes are skipped, nobody signs in as an admin, and the rest still run', async () => {
    expect(probesFor(null).some((p) => p.actor === 'admin')).toBe(false);
    expect(probesFor(null).length).toBe(PROBES.filter((p) => p.actor !== 'admin').length);
    const fake = fakeFirebase({ answer: asTheTableExpects });
    const outcome = await run(fake, { adminEmail: null, adminPassword: null });
    expect(outcome.mismatches).toEqual([]);
    expect(Object.keys(outcome.roles).sort()).toEqual(['alice', 'bob', 'uma']);
    expect(outcome.results.some((r) => r.probe.actor === 'admin')).toBe(false);
    expect(ADMIN_SKIPPED).toBe('admin probes skipped: HOSTED_ADMIN_EMAIL not set');
  });

  test('the admin signs in with its own email and password, and neither appears in an error or the report', async () => {
    const fake = fakeFirebase({ answer: asTheTableExpects });
    const outcome = await run(fake);
    const adminSignIn = fake.sent.filter((s) => s.url.includes('identitytoolkit') && JSON.parse(s.options.body).email === ADMIN_EMAIL);
    expect(adminSignIn.map((s) => JSON.parse(s.options.body).password)).toEqual([ADMIN_PASSWORD]);
    expect(report(outcome)).not.toContain(ADMIN_EMAIL);
    const error = await run(fakeFirebase({ answer: asTheTableExpects, roleOf: { admin: 'underwriter' } })).catch((e) => e);
    expect(error.message).toMatch(/the admin account \(HOSTED_ADMIN_EMAIL\) carries role "underwriter", not "admin"/);
    expect(error.message).not.toContain(ADMIN_EMAIL);
  });

  test('no admin email is written anywhere in the probe table', () => {
    expect(JSON.stringify(ACTORS)).not.toMatch(/admin@/);
  });
});

describe('reading answers', () => {
  test('200 and 404 are "allowed" (a missing document is still a permitted read), 403 is "refused", anything else is not an answer', () => {
    expect([classify(200), classify(404), classify(403)]).toEqual(['allow', 'allow', 'deny']);
    for (const status of [0, 400, 401, 429, 500, 503]) expect(classify(status)).toBe('error');
  });

  test('the role claim is read from an ID token, and a bad token gives undefined, not a crash', () => {
    expect(roleFromToken(tokenFor('alice'))).toBe('borrower');
    expect(roleFromToken(tokenFor('uma'))).toBe('underwriter');
    expect(roleFromToken('not-a-token')).toBeUndefined();
    expect(roleFromToken('')).toBeUndefined();
  });

  test('a probe is described as who, what and where, and a dry-run summary counts them per person', () => {
    expect(label({ actor: 'alice', op: 'get', path: 'users/borrower2' })).toBe('alice (borrower) read users/borrower2');
    expect(label({ actor: NOBODY, op: 'delete', path: 'reviews/x' })).toBe('signed out delete reviews/x');
    const counts = summarise();
    expect(Object.keys(counts).sort()).toEqual(['admin', 'alice', 'bob', 'signed out', 'uma']);
    expect(Object.values(counts).reduce((n, c) => n + c.get + c.write + c.delete, 0)).toBe(PROBES.length);
  });
});

describe('signIn', () => {
  test('a failure names the account and Firebase\'s reason, and never the password', async () => {
    const fake = fakeFirebase({ answer: () => 200, signInFails: 'INVALID_LOGIN_CREDENTIALS' });
    const error = await signIn(fake.fetchFn, 'fake-api-key', 'alice@example.com', GOOD_PASSWORD).catch((e) => e);
    expect(error).toBeInstanceOf(SetupError);
    expect(error.message).toMatch(/alice@example.com.*INVALID_LOGIN_CREDENTIALS/);
    expect(error.message).not.toContain(GOOD_PASSWORD);
  });
});

describe('check: signing in and asking', () => {
  test('when Firestore answers as the table expects, every probe is as expected and there are no mismatches', async () => {
    const outcome = await run(fakeFirebase({ answer: asTheTableExpects }));
    expect(outcome.results).toHaveLength(PROBES.length);
    expect(outcome.mismatches).toEqual([]);
    expect(outcome.createdByMistake).toEqual([]);
    expect(outcome.roles).toEqual({ alice: 'borrower', bob: 'broker', uma: 'underwriter', admin: 'admin' });
  });

  test('it signs in as each person once, with the account\'s email, and asks signed-out probes with no token', async () => {
    const fake = fakeFirebase({ answer: asTheTableExpects });
    await run(fake);
    const signIns = fake.sent.filter((s) => s.url.includes('identitytoolkit')).map((s) => JSON.parse(s.options.body).email);
    expect(signIns.sort()).toEqual(['alice@example.com', 'bob@example.com', 'uma@example.com', ADMIN_EMAIL].sort());
    const signedOut = fake.sent.filter((s) => s.url.includes('firestore') && !(s.options.headers || {}).Authorization);
    expect(signedOut.length).toBe(PROBES.filter((p) => p.actor === NOBODY).length);
  });

  test('every write is a PATCH to a probe id that does not exist, and every delete too: nothing real is touched', async () => {
    const fake = fakeFirebase({ answer: asTheTableExpects });
    await run(fake);
    const changes = fake.sent.filter((s) => ['PATCH', 'DELETE'].includes(s.options.method));
    expect(changes.length).toBeGreaterThan(30);
    for (const { url } of changes) expect(url).toContain('rules-probe-doc');
  });

  test('a read that should be refused but is allowed is a mismatch, and the report names who, what and where', async () => {
    const outcome = await run(fakeFirebase({ answer: (probe) => (probe.actor === 'alice' && probe.path === 'users/borrower2' ? 200 : asTheTableExpects(probe)) }));
    expect(outcome.mismatches).toHaveLength(1);
    expect(report(outcome)).toMatch(/MISMATCH\s+alice \(borrower\) read users\/borrower2: expected deny, got allow \(HTTP 200\)/);
  });

  test('a write that is allowed is a mismatch and its document is listed for clean-up', async () => {
    const outcome = await run(fakeFirebase({ answer: (probe) => (probe.actor === 'bob' && probe.op === 'write' && probe.path.startsWith('ai_runs/') ? 200 : asTheTableExpects(probe)) }));
    expect(outcome.mismatches.length).toBe(1);
    expect(outcome.createdByMistake).toEqual(['ai_runs/rules-probe-doc']);
    expect(report(outcome)).toMatch(/should be deleted in the Firebase console:\s+ai_runs\/rules-probe-doc/);
  });

  test('a read that should be allowed but is refused is a mismatch too', async () => {
    const outcome = await run(fakeFirebase({ answer: (probe) => (probe.actor === 'uma' && probe.path === 'users/borrower1' ? 403 : asTheTableExpects(probe)) }));
    expect(outcome.mismatches).toHaveLength(1);
    expect(outcome.mismatches[0].got).toBe('deny');
  });

  test('a rejected token (401) or a request that never got through is a mismatch, not a quiet pass', async () => {
    const outcome401 = await run(fakeFirebase({ answer: (probe) => (probe.actor === 'bob' ? 401 : asTheTableExpects(probe)) }));
    expect(outcome401.mismatches.length).toBe(PROBES.filter((p) => p.actor === 'bob').length);
    expect(outcome401.mismatches.every((m) => m.got === 'error')).toBe(true);

    const fake = fakeFirebase({ answer: asTheTableExpects });
    const flaky = async (url, options) => {
      if (url.includes('firestore') && options.method === 'DELETE') throw new Error('network down');
      return fake.fetchFn(url, options);
    };
    const outcomeDown = await check({ fetchFn: flaky, projectId: 'agentic-lender', domain: 'example.com', apiKey: 'k', password: GOOD_PASSWORD, adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD });
    expect(outcomeDown.mismatches.every((m) => m.status === 0 && m.got === 'error' && m.probe.op === 'delete')).toBe(true);
    expect(outcomeDown.mismatches.length).toBeGreaterThan(0);
  });

  test('a token with the wrong role stops the check: the rules would be judging the wrong person', async () => {
    const error = await run(fakeFirebase({ answer: asTheTableExpects, roleOf: { bob: 'borrower' } })).catch((e) => e);
    expect(error).toBeInstanceOf(SetupError);
    expect(error.message).toMatch(/bob@example.com carries role "borrower", not "broker"/);
  });

  test('a failed sign-in stops the check with the account and reason', async () => {
    const error = await run(fakeFirebase({ answer: asTheTableExpects, signInFails: 'INVALID_LOGIN_CREDENTIALS' })).catch((e) => e);
    expect(error).toBeInstanceOf(SetupError);
    expect(error.message).toMatch(/could not sign in as .*@example.com: INVALID_LOGIN_CREDENTIALS/);
  });

  test('the password goes only to the sign-in call, and is not in the results or the report', async () => {
    const fake = fakeFirebase({ answer: asTheTableExpects });
    const outcome = await run(fake);
    const carriers = fake.sent.filter((s) => JSON.stringify(s).includes(GOOD_PASSWORD));
    expect(carriers.length).toBe(Object.values(ACTORS).filter((a) => a.local).length); // one sign-in per demo account
    expect(fake.sent.filter((s) => JSON.stringify(s).includes(ADMIN_PASSWORD)).length).toBe(1);
    expect(JSON.stringify(outcome)).not.toContain(ADMIN_PASSWORD);
    expect(carriers.every((s) => s.url.startsWith('https://identitytoolkit.googleapis.com/'))).toBe(true);
    expect(JSON.stringify(outcome)).not.toContain(GOOD_PASSWORD);
    expect(report(outcome)).not.toContain(GOOD_PASSWORD);
  });

  test('the report says per person how many probes were as expected', async () => {
    const text = report(await run(fakeFirebase({ answer: asTheTableExpects })));
    expect(text).toMatch(/alice \(borrower\)\s+\d+ probes, all as expected/);
    expect(text).toMatch(/bob \(broker\)\s+\d+ probes, all as expected/);
    expect(text).toMatch(/uma \(underwriter\)\s+\d+ probes, all as expected/);
    expect(text).toMatch(/admin \(admin\)\s+\d+ probes, all as expected/);
    expect(text).toMatch(/signed out\s+\d+ probes, all as expected/);
  });
});
