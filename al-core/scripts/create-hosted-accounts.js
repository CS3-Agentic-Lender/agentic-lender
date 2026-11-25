// Creates the demo accounts in the HOSTED Firebase project (AL-181): one Auth user each for the two borrowers, the
// two brokers and the underwriter, with the `role` claim the API and the rules read, and a `users/{uid}` profile.
// Never the admin: scripts/create-hosted-admin.js makes that one, with an email that is not in this repo.
//
//   node scripts/create-hosted-accounts.js --dry-run   show what it would do, touch nothing
//   node scripts/create-hosted-accounts.js             do it (asks you to type the project id first)
//
// It needs, in your shell (never in a file in this repo):
//
//   FIREBASE_PROJECT_ID           the hosted project's id. A `demo-` id is refused: that is the emulators' project.
//   GOOGLE_APPLICATION_CREDENTIALS  path to a service account key for THAT project, kept outside this repo.
//   HOSTED_DEMO_PASSWORD          the password every demo account gets (12+ characters). Share it privately, never in git.
//   HOSTED_DEMO_EMAIL_DOMAIN      optional, default example.com. Not test.com: that is a real domain, and the app's
//                                 "resend verification email" would send mail to whoever owns it.
//
// What it will not do: run with an emulator host set, run with a key for another project, run with a key inside this repo,
// or print the password. Running it again is safe: accounts get the password and flags again, and a profile that already
// exists is left alone (so a borrower's choice of broker is not undone).
//
// Alice is created with a verified email and Ben without, as in the emulator seed (scripts/demo-users.js).

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { users, EMAIL_VERIFIED } = require('./demo-users');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIN_PASSWORD_LENGTH = 12;
const DEFAULT_DOMAIN = 'example.com';
const EMULATOR_HOSTS = ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'];
const WEAK_PASSWORDS = ['password123', 'password1234', '123456789012'];

class SetupError extends Error {}

/** The accounts to create, with the email on the chosen domain. The local part is the seed's (alice, ben, bob, ...). */
function accountsFor(domain) {
  // The hosted admin is never a demo account: its email and uid must not be guessable from this public repo, so it is
  // made by scripts/create-hosted-admin.js with an email typed at the prompt.
  return users.filter((u) => u.role !== 'admin').map((u) => {
    const email = `${u.email.split('@')[0]}@${domain}`;
    return {
      uid: u.uid,
      role: u.role,
      email,
      displayName: u.fullName,
      emailVerified: EMAIL_VERIFIED[u.uid],
      profile: { ...u, email },
    };
  });
}

/**
 * Checks the settings and returns them, or throws a SetupError saying what to fix. Takes the environment and the file
 * functions as arguments so the tests can try every refusal without a real key. With dryRun, the password and the
 * credentials are not needed, because nothing is written.
 */
function validate(env, { dryRun = false, needPassword = true, exists = fs.existsSync, readFile = fs.readFileSync } = {}) {
  const projectId = (env.FIREBASE_PROJECT_ID || '').trim();
  if (!projectId) throw new SetupError('FIREBASE_PROJECT_ID is not set. It is the hosted project\'s id, from the Firebase console.');
  if (projectId.startsWith('demo-')) {
    throw new SetupError(`FIREBASE_PROJECT_ID is "${projectId}", a demo project. That is the emulators' project: use scripts/seed.js for it.`);
  }

  const emulator = EMULATOR_HOSTS.filter((name) => env[name]);
  if (emulator.length) {
    throw new SetupError(`${emulator.join(' and ')} is set, so this would write to an emulator, not the hosted project. Unset it and run again.`);
  }

  const domain = (env.HOSTED_DEMO_EMAIL_DOMAIN || DEFAULT_DOMAIN).trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    throw new SetupError(`HOSTED_DEMO_EMAIL_DOMAIN "${domain}" is not a domain name.`);
  }
  if (domain === 'test.com') {
    throw new SetupError('HOSTED_DEMO_EMAIL_DOMAIN test.com is a real domain: the app would email its owner when a demo user resends a verification email. Use example.com or a domain the team owns.');
  }

  if (dryRun) return { projectId, domain };

  // scripts/create-hosted-admin.js asks for its password at the prompt instead (needPassword: false).
  const password = env.HOSTED_DEMO_PASSWORD || '';
  if (needPassword) {
    if (!password) throw new SetupError('HOSTED_DEMO_PASSWORD is not set. Choose one, set it in this shell only, and share it privately.');
    if (!passwordIsStrong(password)) {
      throw new SetupError(`HOSTED_DEMO_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters and not the emulator seed's password.`);
    }
  }

  const keyPath = env.GOOGLE_APPLICATION_CREDENTIALS || '';
  if (!keyPath) throw new SetupError('GOOGLE_APPLICATION_CREDENTIALS is not set. It is the path to the project\'s service account key.');
  const resolved = path.resolve(keyPath);
  const relative = path.relative(REPO_ROOT, resolved);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new SetupError('The service account key is inside this repo. The repo is public: move the key outside it and point GOOGLE_APPLICATION_CREDENTIALS there.');
  }
  if (!exists(resolved)) throw new SetupError(`GOOGLE_APPLICATION_CREDENTIALS points at ${resolved}, which does not exist.`);

  let key;
  try {
    key = JSON.parse(readFile(resolved, 'utf8'));
  } catch {
    throw new SetupError('The service account key is not valid JSON.');
  }
  if (key.type !== 'service_account') throw new SetupError('The key file is not a service account key.');
  if (key.project_id !== projectId) {
    throw new SetupError(`The key is for project "${key.project_id}", not "${projectId}". Use the key from the project you named.`);
  }

  return needPassword ? { projectId, domain, password, keyPath: resolved } : { projectId, domain, keyPath: resolved };
}

/** The demo password policy: 12+ characters and not one of the seed's. */
function passwordIsStrong(password) {
  return password.length >= MIN_PASSWORD_LENGTH && !WEAK_PASSWORDS.includes(password.toLowerCase());
}

/** A SetupError when Firebase says the email belongs to a different user, else null. */
function emailTaken(err, account) {
  if (err.code !== 'auth/email-already-exists') return null;
  return new SetupError(`${account.email} already belongs to another user in this project. Delete that user in the Firebase console, then run again.`);
}

/**
 * Creates or refreshes each account. `auth` and `db` are the Admin SDK's (or stand-ins in the tests). Returns one line per
 * account saying what happened; the password is never in it.
 */
async function run({ auth, db, accounts, password }) {
  const results = [];
  for (const account of accounts) {
    const fields = { email: account.email, password, displayName: account.displayName, emailVerified: account.emailVerified };
    let action;
    try {
      await auth.createUser({ uid: account.uid, ...fields });
      action = 'created';
    } catch (err) {
      if (err.code === 'auth/uid-already-exists') {
        try {
          await auth.updateUser(account.uid, fields);
        } catch (updateErr) {
          throw emailTaken(updateErr, account) || updateErr;
        }
        action = 'updated';
      } else {
        throw emailTaken(err, account) || err;
      }
    }
    await auth.setCustomUserClaims(account.uid, { role: account.role });

    const profile = db.doc(`users/${account.uid}`);
    const existing = await profile.get();
    let profileAction = 'kept';
    if (!existing.exists) {
      await profile.set(account.profile);
      profileAction = 'created';
    }
    results.push({ uid: account.uid, email: account.email, role: account.role, emailVerified: account.emailVerified, auth: action, profile: profileAction });
  }
  return results;
}

function describe(accounts) {
  return accounts.map((a) => `  ${a.role.padEnd(11)} ${a.email.padEnd(30)} ${a.emailVerified ? 'email verified' : 'email NOT verified'}`).join('\n');
}

function confirm(question, expected) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim() === expected); }));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const settings = validate(process.env, { dryRun });
  const accounts = accountsFor(settings.domain);

  console.log(`${dryRun ? 'Dry run: would write' : 'About to write'} to the hosted Firebase project "${settings.projectId}":`);
  console.log(describe(accounts));
  if (dryRun) {
    console.log('\nNothing was written.');
    return;
  }

  if (!(await confirm(`\nType the project id (${settings.projectId}) to go ahead: `, settings.projectId))) {
    throw new SetupError('That is not the project id, so nothing was written.');
  }

  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ projectId: settings.projectId, credential: applicationDefault() });

  const results = await run({ auth: getAuth(), db: getFirestore(), accounts, password: settings.password });
  console.log('');
  for (const r of results) console.log(`${r.role.padEnd(11)} ${r.email.padEnd(30)} auth ${r.auth}, profile ${r.profile}`);
  console.log('\nDone. Share the password privately: it is not printed here and must never go in git, Slack or the docs.');
}

module.exports = { accountsFor, validate, run, confirm, passwordIsStrong, SetupError, MIN_PASSWORD_LENGTH };

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof SetupError ? `\nStopped: ${err.message}` : err);
    process.exit(1);
  });
}
