// Creates or refreshes ONE admin account in the HOSTED Firebase project (AL-338): the `admin` role claim, a verified
// email and a staff `users/{uid}` profile. The repo is public, so the hosted admin's email is never in it: you type it
// at the prompt (it lives only in Bitwarden), and Firebase picks the uid, so neither can be guessed from here.
//
//   node scripts/create-hosted-admin.js --dry-run   check the settings, touch nothing
//   node scripts/create-hosted-admin.js             asks for the project id, the email, the name, then the password twice
//
// It needs, in your shell (never in a file in this repo):
//
//   FIREBASE_PROJECT_ID             the hosted project's id
//   GOOGLE_APPLICATION_CREDENTIALS  path to a service account key for THAT project, kept outside this repo
//
// The password is typed at a hidden prompt, never taken from the command line or the environment, and never printed.
// Running it again with the same email is safe: that account gets the password, the flag and the claim again, and a
// profile that already exists is left alone. It touches no other account, and refuses an email that belongs to a
// borrower, broker or underwriter.

const readline = require('readline');
const {
  validate, confirm, passwordIsStrong, SetupError, MIN_PASSWORD_LENGTH,
} = require('./create-hosted-accounts');

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** One visible line from the terminal. */
function promptVisible(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

/** Reads one line from the terminal without echoing it. Refuses a stdin that is not a terminal, so it is never piped. */
function promptHidden(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    if (!input.isTTY) {
      reject(new SetupError('Run this in a terminal: the password is typed at the prompt, never piped in.'));
      return;
    }
    output.write(question);
    let typed = '';
    const finish = (settle) => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      settle();
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish(() => resolve(typed));
        if (ch === '\u0003') return finish(() => reject(new SetupError('Cancelled. Nothing was written.')));
        if (ch === '\u007f' || ch === '\b') typed = typed.slice(0, -1);
        else typed += ch;
      }
      return undefined;
    };
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    input.on('data', onData);
  });
}

/** The admin's email and name through `ask` (visible), checked. */
async function askDetails(ask) {
  const email = (await ask('Admin email (from Bitwarden): ')).trim().toLowerCase();
  if (!EMAIL.test(email)) throw new SetupError('That is not an email address. Nothing was written.');
  const fullName = (await ask('Admin full name: ')).trim();
  if (!fullName || fullName.length > 100) throw new SetupError('The name must be 1 to 100 characters. Nothing was written.');
  return { email, fullName };
}

/** Asks twice through `ask` (hidden) and returns the password, or throws a SetupError naming the problem, never the password. */
async function askPassword(ask) {
  const first = await ask('Admin password (hidden): ');
  if (!passwordIsStrong(first)) {
    throw new SetupError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters and not the emulator seed's password.`);
  }
  const second = await ask('The same password again: ');
  if (second !== first) throw new SetupError('The two passwords do not match. Nothing was written.');
  return first;
}

/**
 * Creates the admin, or refreshes the one that already has this email. `auth` and `db` are the Admin SDK's (or stand-ins
 * in the tests); `now` is the profile's createdAt. Returns what happened, never the password.
 */
async function runAdmin({ auth, db, email, fullName, password, now = new Date() }) {
  const fields = { email, password, displayName: fullName, emailVerified: true };
  let user = null;
  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
  }

  let action;
  let uid;
  if (user) {
    const role = (user.customClaims || {}).role;
    if (role && role !== 'admin') {
      throw new SetupError(`${email} is a ${role} account. Use another email: this script never turns a borrower or staff account into an admin.`);
    }
    uid = user.uid;
    await auth.updateUser(uid, fields);
    action = 'updated';
  } else {
    uid = (await auth.createUser(fields)).uid; // no uid given: Firebase generates one
    action = 'created';
  }
  await auth.setCustomUserClaims(uid, { role: 'admin' });

  // A staff profile: no address, county or Eircode, and no phone (it is not needed to manage staff).
  const profile = db.doc(`users/${uid}`);
  let profileAction = 'kept';
  if (!(await profile.get()).exists) {
    await profile.set({ uid, role: 'admin', fullName, email, createdAt: now });
    profileAction = 'created';
  }
  return { uid, email, role: 'admin', auth: action, profile: profileAction };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const settings = validate(process.env, { dryRun, needPassword: false });

  console.log(`${dryRun ? 'Dry run: would write' : 'About to write'} one admin account to the hosted Firebase project "${settings.projectId}".`);
  console.log('You will type its email (from Bitwarden), its name and its password. No other account is touched.');
  if (dryRun) {
    console.log('\nNothing was written.');
    return;
  }

  if (!(await confirm(`\nType the project id (${settings.projectId}) to go ahead: `, settings.projectId))) {
    throw new SetupError('That is not the project id, so nothing was written.');
  }
  const { email, fullName } = await askDetails(promptVisible);
  const password = await askPassword((question) => promptHidden(question));

  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ projectId: settings.projectId, credential: applicationDefault() });

  const r = await runAdmin({ auth: getAuth(), db: getFirestore(), email, fullName, password });
  console.log(`\nuid ${r.uid}, ${r.email}: auth ${r.auth}, claim role=admin set, profile ${r.profile}`);
}

module.exports = { askDetails, askPassword, promptHidden, runAdmin };

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof SetupError ? `\nStopped: ${err.message}` : err);
    process.exit(1);
  });
}
