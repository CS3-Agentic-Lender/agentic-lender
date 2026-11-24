// scripts/create-hosted-accounts.js (AL-181): every refusal, and what it writes, against stand-ins. No emulator and no real
// project or key: the real run needs the team's Firebase project.

const path = require('path');
const { accountsFor, validate, run, SetupError } = require('../scripts/create-hosted-accounts');

const GOOD_PASSWORD = 'a-long-demo-password'; // betterleaks:allow — fake test value, not a credential
const KEY_PATH = path.join(path.parse(process.cwd()).root, 'keys', 'agentic-lender-key.json'); // outside the repo
const goodKey = { type: 'service_account', project_id: 'agentic-lender' };

const goodEnv = () => ({
  FIREBASE_PROJECT_ID: 'agentic-lender',
  GOOGLE_APPLICATION_CREDENTIALS: KEY_PATH,
  HOSTED_DEMO_PASSWORD: GOOD_PASSWORD,
});

// File functions that say the key exists and holds `key`.
const withKey = (key = goodKey) => ({ exists: () => true, readFile: () => JSON.stringify(key) });

describe('validate: what it refuses', () => {
  test('a good setup is accepted and returns the project, the default domain and the key path', () => {
    const settings = validate(goodEnv(), withKey());
    expect(settings).toMatchObject({ projectId: 'agentic-lender', domain: 'example.com', password: GOOD_PASSWORD });
  });

  test('no project id', () => {
    const env = goodEnv();
    delete env.FIREBASE_PROJECT_ID;
    expect(() => validate(env, withKey())).toThrow(/FIREBASE_PROJECT_ID is not set/);
  });

  test.each(['demo-al', 'demo-anything'])('the emulators\' project (%s) is refused', (id) => {
    expect(() => validate({ ...goodEnv(), FIREBASE_PROJECT_ID: id }, withKey())).toThrow(/demo project/);
  });

  test.each(['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'])('%s set means it would write to an emulator', (name) => {
    expect(() => validate({ ...goodEnv(), [name]: '127.0.0.1:9099' }, withKey())).toThrow(new RegExp(`${name} is set`));
  });

  test('no password, a short one, and the emulator seed\'s password are refused', () => {
    const env = goodEnv();
    delete env.HOSTED_DEMO_PASSWORD;
    expect(() => validate(env, withKey())).toThrow(/HOSTED_DEMO_PASSWORD is not set/);
    expect(() => validate({ ...goodEnv(), HOSTED_DEMO_PASSWORD: 'short' }, withKey())).toThrow(/at least 12/); // betterleaks:allow — fake test value, not a credential
    expect(() => validate({ ...goodEnv(), HOSTED_DEMO_PASSWORD: 'password123' }, withKey())).toThrow(/at least 12|not the emulator seed/); // betterleaks:allow — fake test value, not a credential
    expect(() => validate({ ...goodEnv(), HOSTED_DEMO_PASSWORD: 'Password1234' }, withKey())).toThrow(/not the emulator seed/); // betterleaks:allow — fake test value, not a credential
  });

  test('a key inside the repo is refused, even without a file behind it', () => {
    const inside = path.join(__dirname, '..', 'service-account.json');
    expect(() => validate({ ...goodEnv(), GOOGLE_APPLICATION_CREDENTIALS: inside }, { exists: () => false })).toThrow(/inside this repo/);
  });

  test('no key path, a missing file, bad JSON and a file that is not a service account key', () => {
    const env = goodEnv();
    delete env.GOOGLE_APPLICATION_CREDENTIALS;
    expect(() => validate(env, withKey())).toThrow(/GOOGLE_APPLICATION_CREDENTIALS is not set/);
    expect(() => validate(goodEnv(), { exists: () => false })).toThrow(/does not exist/);
    expect(() => validate(goodEnv(), { exists: () => true, readFile: () => 'not json' })).toThrow(/not valid JSON/);
    expect(() => validate(goodEnv(), withKey({ type: 'authorized_user', project_id: 'agentic-lender' }))).toThrow(/not a service account key/);
  });

  test('a key for another project is refused and the message names both projects, not the key', () => {
    const key = { ...goodKey, project_id: 'someone-elses-project', private_key: '-----BEGIN PRIVATE KEY-----secret' };
    let message = '';
    try {
      validate(goodEnv(), withKey(key));
    } catch (err) {
      message = err.message;
    }
    expect(message).toMatch(/someone-elses-project/);
    expect(message).toMatch(/agentic-lender/);
    expect(message).not.toMatch(/PRIVATE KEY|secret/);
  });

  test('the email domain: a custom one is used, an invalid one and test.com are refused', () => {
    expect(validate({ ...goodEnv(), HOSTED_DEMO_EMAIL_DOMAIN: 'Agentic-Lender.com' }, withKey()).domain).toBe('agentic-lender.com');
    expect(() => validate({ ...goodEnv(), HOSTED_DEMO_EMAIL_DOMAIN: 'not a domain' }, withKey())).toThrow(/not a domain name/);
    expect(() => validate({ ...goodEnv(), HOSTED_DEMO_EMAIL_DOMAIN: 'test.com' }, withKey())).toThrow(/real domain/);
  });

  test('a dry run needs neither the password nor the key, but still refuses a demo project or an emulator', () => {
    expect(validate({ FIREBASE_PROJECT_ID: 'agentic-lender' }, { dryRun: true })).toEqual({ projectId: 'agentic-lender', domain: 'example.com' });
    expect(() => validate({ FIREBASE_PROJECT_ID: 'demo-al' }, { dryRun: true })).toThrow(/demo project/);
    expect(() => validate({ FIREBASE_PROJECT_ID: 'agentic-lender', FIRESTORE_EMULATOR_HOST: 'x' }, { dryRun: true })).toThrow(/is set/);
  });
});

describe('accountsFor: who is created', () => {
  const accounts = accountsFor('example.com');
  const byUid = Object.fromEntries(accounts.map((a) => [a.uid, a]));

  test('two borrowers, two brokers and an underwriter, each with its role', () => {
    expect(accounts.map((a) => a.role).sort()).toEqual(['borrower', 'borrower', 'broker', 'broker', 'underwriter']);
  });

  test('the emulator\'s admin is never a hosted demo account', () => {
    expect(byUid).not.toHaveProperty('admin1');
    expect(accounts.some((a) => a.role === 'admin')).toBe(false);
  });

  test('Alice is verified and Ben is not, as in the emulator seed', () => {
    expect(byUid.borrower1.emailVerified).toBe(true);
    expect(byUid.borrower2.emailVerified).toBe(false);
  });

  test('the emails keep the seed\'s names on the chosen domain, in the account and the profile', () => {
    expect(byUid.borrower1.email).toBe('alice@example.com');
    expect(byUid.borrower1.profile.email).toBe('alice@example.com');
    expect(accounts.every((a) => a.email.endsWith('@example.com'))).toBe(true);
  });

  test('the profile keeps the seed\'s broker choice', () => {
    expect(byUid.borrower1.profile.brokerId).toBe('broker1');
  });

  test('no account has a password in it', () => {
    expect(JSON.stringify(accounts)).not.toMatch(/password/i);
  });
});

describe('run: what it writes', () => {
  // A stand-in for the Admin SDK: records every call, and can pretend an account already exists.
  function fakes({ existingUids = [], existingProfiles = [], emailOwnedByOther = [] } = {}) {
    const calls = { createUser: [], updateUser: [], claims: [], profiles: {} };
    const emailTaken = (email) => Object.assign(new Error('email taken'), { code: 'auth/email-already-exists', email });
    const auth = {
      async createUser(args) {
        if (existingUids.includes(args.uid)) throw Object.assign(new Error('uid taken'), { code: 'auth/uid-already-exists' });
        if (emailOwnedByOther.includes(args.email)) throw emailTaken(args.email);
        calls.createUser.push(args);
      },
      async updateUser(uid, args) {
        if (emailOwnedByOther.includes(args.email)) throw emailTaken(args.email);
        calls.updateUser.push({ uid, ...args });
      },
      async setCustomUserClaims(uid, claims) { calls.claims.push({ uid, ...claims }); },
    };
    const db = {
      doc: (docPath) => ({
        async get() { return { exists: existingProfiles.includes(docPath.split('/')[1]) }; },
        async set(data) { calls.profiles[docPath] = data; },
      }),
    };
    return { auth, db, calls };
  }

  const accounts = accountsFor('example.com');

  test('creates every account with the password, the verified flag and the role claim, and a profile', async () => {
    const { auth, db, calls } = fakes();
    const results = await run({ auth, db, accounts, password: GOOD_PASSWORD });

    expect(calls.createUser).toHaveLength(5);
    const alice = calls.createUser.find((c) => c.uid === 'borrower1');
    expect(alice).toMatchObject({ email: 'alice@example.com', password: GOOD_PASSWORD, displayName: 'Alice Byrne', emailVerified: true });
    expect(calls.createUser.find((c) => c.uid === 'borrower2').emailVerified).toBe(false);
    expect(calls.claims).toContainEqual({ uid: 'underwriter1', role: 'underwriter' });
    expect(calls.claims).toContainEqual({ uid: 'broker2', role: 'broker' });
    expect(Object.keys(calls.profiles).sort()).toEqual(['users/borrower1', 'users/borrower2', 'users/broker1', 'users/broker2', 'users/underwriter1']);
    expect(results.every((r) => r.auth === 'created' && r.profile === 'created')).toBe(true);
  });

  test('the results never contain the password', async () => {
    const { auth, db } = fakes();
    const results = await run({ auth, db, accounts, password: GOOD_PASSWORD });
    expect(JSON.stringify(results)).not.toContain(GOOD_PASSWORD);
  });

  test('an account that already exists is updated, not recreated, and still gets its claim', async () => {
    const { auth, db, calls } = fakes({ existingUids: ['borrower1'] });
    const results = await run({ auth, db, accounts, password: GOOD_PASSWORD });
    expect(calls.createUser.map((c) => c.uid)).not.toContain('borrower1');
    expect(calls.updateUser).toEqual([expect.objectContaining({ uid: 'borrower1', password: GOOD_PASSWORD, emailVerified: true })]);
    expect(calls.claims).toContainEqual({ uid: 'borrower1', role: 'borrower' });
    expect(results.find((r) => r.uid === 'borrower1').auth).toBe('updated');
  });

  test('a profile that already exists is left alone, so a borrower\'s broker choice is not undone', async () => {
    const { auth, db, calls } = fakes({ existingProfiles: ['borrower1'] });
    const results = await run({ auth, db, accounts, password: GOOD_PASSWORD });
    expect(calls.profiles).not.toHaveProperty('users/borrower1');
    expect(results.find((r) => r.uid === 'borrower1').profile).toBe('kept');
    expect(results.find((r) => r.uid === 'borrower2').profile).toBe('created');
  });

  test('an email that belongs to another user stops the run with a clear message', async () => {
    const { auth, db } = fakes({ emailOwnedByOther: ['bob@example.com'] });
    await expect(run({ auth, db, accounts, password: GOOD_PASSWORD })).rejects.toThrow(SetupError);
    await expect(run({ auth, db, accounts, password: GOOD_PASSWORD })).rejects.toThrow(/bob@example.com already belongs to another user/);
  });

  test('the same for an existing account whose email another user holds', async () => {
    const { auth, db } = fakes({ existingUids: ['broker1'], emailOwnedByOther: ['bob@example.com'] });
    await expect(run({ auth, db, accounts, password: GOOD_PASSWORD })).rejects.toThrow(/bob@example.com already belongs to another user/);
  });

  test('any other Firebase error is not swallowed', async () => {
    const { db } = fakes();
    const auth = { createUser: async () => { throw Object.assign(new Error('quota'), { code: 'auth/quota-exceeded' }); } };
    await expect(run({ auth, db, accounts, password: GOOD_PASSWORD })).rejects.toThrow('quota');
  });
});
