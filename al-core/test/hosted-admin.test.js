// scripts/create-hosted-admin.js: the prompts' checks, and that it makes or refreshes one admin by the email typed, touching nothing else.

const { EventEmitter } = require('events');
const { askDetails, askPassword, promptHidden, runAdmin } = require('../scripts/create-hosted-admin');
const { validate, SetupError } = require('../scripts/create-hosted-accounts');

const GOOD = 'correct-horse-battery'; // betterleaks:allow — fake test value, not a credential

const answers = (...typed) => {
  const asked = [];
  const ask = async (question) => { asked.push(question); return typed.shift(); };
  return { ask, asked };
};

describe('askDetails', () => {
  test('lower-cases the email and trims both', async () => {
    const { ask } = answers('  Ops.Lead@Example.org ', ' Ada Admin ');
    await expect(askDetails(ask)).resolves.toEqual({ email: 'ops.lead@example.org', fullName: 'Ada Admin' });
  });

  test.each([[''], ['not-an-email'], ['a@b']])('refuses the email %p', async (email) => {
    const { ask } = answers(email, 'Ada Admin');
    await expect(askDetails(ask)).rejects.toThrow(/not an email/);
  });

  test('refuses a blank name', async () => {
    const { ask } = answers('ops@example.org', '   ');
    await expect(askDetails(ask)).rejects.toThrow(/name/);
  });
});

describe('askPassword', () => {
  test('asks twice and returns the password when both match', async () => {
    const { ask, asked } = answers(GOOD, GOOD);
    await expect(askPassword(ask)).resolves.toBe(GOOD);
    expect(asked).toHaveLength(2);
  });

  test.each([[''], ['short'], ['password123'], ['PASSWORD1234']])('refuses %p before asking again', async (weak) => {
    const { ask, asked } = answers(weak, weak);
    await expect(askPassword(ask)).rejects.toThrow(SetupError);
    expect(asked).toHaveLength(1);
  });

  test('refuses two different passwords, without saying either', async () => {
    const { ask } = answers(GOOD, `${GOOD}x`);
    const err = await askPassword(ask).catch((e) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect(err.message).toMatch(/do not match/);
    expect(err.message).not.toContain(GOOD);
  });
});

describe('promptHidden', () => {
  function fakeTerminal(isTTY = true) {
    const input = Object.assign(new EventEmitter(), {
      isTTY, rawMode: [], setRawMode(on) { this.rawMode.push(on); }, setEncoding() {}, resume() {}, pause() {},
    });
    let written = '';
    const output = { write(text) { written += text; } };
    return { input, output, written: () => written };
  }

  test('reads up to Enter, handles backspace, and echoes nothing that was typed', async () => {
    const t = fakeTerminal();
    const typed = promptHidden('pw: ', t);
    t.input.emit('data', 'secrex\u007ft');
    t.input.emit('data', '-value\r');
    await expect(typed).resolves.toBe('secret-value');
    expect(t.written()).toBe('pw: \n');
    expect(t.input.rawMode).toEqual([true, false]);
  });

  test('Ctrl-C cancels', async () => {
    const t = fakeTerminal();
    const typed = promptHidden('pw: ', t);
    t.input.emit('data', 'abc\u0003');
    await expect(typed).rejects.toThrow(/Cancelled/);
  });

  test('a stdin that is not a terminal is refused, so the password is never piped in', async () => {
    await expect(promptHidden('pw: ', fakeTerminal(false))).rejects.toThrow(/terminal/);
  });
});

describe('the settings it needs', () => {
  const key = { type: 'service_account', project_id: 'agentic-lender' };
  const files = { exists: () => true, readFile: () => JSON.stringify(key) };
  const env = { FIREBASE_PROJECT_ID: 'agentic-lender', GOOGLE_APPLICATION_CREDENTIALS: '/keys/key.json' };

  test('no HOSTED_DEMO_PASSWORD, and none returned', () => {
    const settings = validate(env, { needPassword: false, ...files });
    expect(settings).toEqual({ projectId: 'agentic-lender', domain: 'example.com', keyPath: '/keys/key.json' });
  });

  test('still refuses an emulator host and a key for another project', () => {
    expect(() => validate({ ...env, FIREBASE_AUTH_EMULATOR_HOST: 'x' }, { needPassword: false, ...files })).toThrow(/is set/);
    const other = { exists: () => true, readFile: () => JSON.stringify({ ...key, project_id: 'other' }) };
    expect(() => validate(env, { needPassword: false, ...other })).toThrow(/not "agentic-lender"/);
  });
});

describe('runAdmin', () => {
  const NOW = new Date('2026-11-24T12:00:00Z');
  function fakes({ existing = null, profileExists = false } = {}) {
    const calls = { createUser: [], updateUser: [], claims: [], profiles: {} };
    const auth = {
      async getUserByEmail(email) {
        if (existing && existing.email === email) return existing;
        throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
      },
      async createUser(args) { calls.createUser.push(args); return { uid: 'GeneratedUid123' }; },
      async updateUser(uid, args) { calls.updateUser.push({ uid, ...args }); },
      async setCustomUserClaims(uid, claims) { calls.claims.push({ uid, ...claims }); },
    };
    const db = { doc: (p) => ({ async get() { return { exists: profileExists }; }, async set(d) { calls.profiles[p] = d; } }) };
    return { auth, db, calls };
  }
  const args = { email: 'ops@example.org', fullName: 'Ada Admin', password: GOOD, now: NOW };

  test('a new email gets a Firebase-generated uid, the admin claim and a staff profile', async () => {
    const { auth, db, calls } = fakes();
    const r = await runAdmin({ auth, db, ...args });
    expect(calls.createUser).toEqual([{ email: 'ops@example.org', password: GOOD, displayName: 'Ada Admin', emailVerified: true }]);
    expect(calls.claims).toEqual([{ uid: 'GeneratedUid123', role: 'admin' }]);
    expect(calls.profiles).toEqual({
      'users/GeneratedUid123': { uid: 'GeneratedUid123', role: 'admin', fullName: 'Ada Admin', email: 'ops@example.org', createdAt: NOW },
    });
    expect(r).toEqual({ uid: 'GeneratedUid123', email: 'ops@example.org', role: 'admin', auth: 'created', profile: 'created' });
    expect(JSON.stringify(r)).not.toContain(GOOD);
  });

  test('the same email again updates that account only and keeps its profile', async () => {
    const { auth, db, calls } = fakes({ existing: { uid: 'u9', email: 'ops@example.org', customClaims: { role: 'admin' } }, profileExists: true });
    const r = await runAdmin({ auth, db, ...args });
    expect(calls.createUser).toEqual([]);
    expect(calls.updateUser).toEqual([{ uid: 'u9', email: 'ops@example.org', password: GOOD, displayName: 'Ada Admin', emailVerified: true }]);
    expect(calls.claims).toEqual([{ uid: 'u9', role: 'admin' }]);
    expect(calls.profiles).toEqual({});
    expect(r).toMatchObject({ uid: 'u9', auth: 'updated', profile: 'kept' });
  });

  test.each(['borrower', 'broker', 'underwriter'])('refuses an email that belongs to a %s, and changes nothing', async (role) => {
    const { auth, db, calls } = fakes({ existing: { uid: 'u9', email: 'ops@example.org', customClaims: { role } } });
    await expect(runAdmin({ auth, db, ...args })).rejects.toThrow(SetupError);
    expect(calls).toEqual({ createUser: [], updateUser: [], claims: [], profiles: {} });
  });

  test('any other Firebase error is not swallowed', async () => {
    const { db } = fakes();
    const auth = { getUserByEmail: async () => { throw Object.assign(new Error('quota'), { code: 'auth/quota-exceeded' }); } };
    await expect(runAdmin({ auth, db, ...args })).rejects.toThrow('quota');
  });
});
