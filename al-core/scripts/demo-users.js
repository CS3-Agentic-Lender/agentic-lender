// The demo accounts: who they are and which have a verified email. Used by scripts/seed.js (the emulators) and
// scripts/create-hosted-accounts.js (the hosted Firebase project), so the two never drift apart.
//
// Nothing here touches a database or the environment, so it is safe to require from anywhere.

const at = (iso) => new Date(iso);

const users = [
  {
    uid: 'borrower1', role: 'borrower', fullName: 'Alice Byrne', email: 'alice@test.com',
    phone: '+353871234501', addressLine1: '12 Lough Road', county: 'Cork', eircode: 'T12 X5R2',
    brokerId: 'broker1', createdAt: at('2026-09-20T09:00:00Z'),
  },
  {
    uid: 'borrower2', role: 'borrower', fullName: 'Ben Walsh', email: 'ben@test.com',
    phone: '+353871234502', addressLine1: 'Apartment 4', addressLine2: '7 Shandon Street',
    county: 'Cork', eircode: 'T23 K9P1', brokerId: 'broker2', createdAt: at('2026-09-21T09:00:00Z'),
  },
  {
    uid: 'broker1', role: 'broker', fullName: 'Bob Murphy', email: 'bob@test.com', firm: 'Murphy Mortgages',
    phone: '+353871234511', addressLine1: '1 South Mall', county: 'Cork', eircode: 'T12 W8KD',
    createdAt: at('2026-09-01T09:00:00Z'),
  },
  {
    uid: 'broker2', role: 'broker', fullName: 'Ciara Kelly', email: 'ciara@test.com', firm: 'Kelly Financial',
    phone: '+353871234512', addressLine1: '22 Patrick Street', county: 'Cork', eircode: 'T12 AB34',
    createdAt: at('2026-09-01T09:00:00Z'),
  },
  {
    uid: 'underwriter1', role: 'underwriter', fullName: 'Uma Nolan', email: 'uma@test.com',
    phone: '+353871234521', addressLine1: '5 Grand Parade', county: 'Cork', eircode: 'T12 YH60',
    createdAt: at('2026-09-01T09:00:00Z'),
  },
  {
    // The emulators' admin (AL-338). Admins are made only by script: the staff API never creates, changes or deletes
    // one. create-hosted-accounts.js skips it; the hosted admin comes from create-hosted-admin.js with an email kept
    // out of this repo. A staff profile has no address, county or Eircode.
    uid: 'admin1', role: 'admin', fullName: 'Ada Admin', email: 'admin@test.com', phone: '+353871234531',
    createdAt: at('2026-09-01T09:00:00Z'),
  },
];

// Auth-only flag (not copied into the Firestore users documents). The iOS app shows a "check your
// inbox" banner to any password account that is not verified: Alice's demo is clean, Ben's shows it.
const EMAIL_VERIFIED = { borrower1: true, borrower2: false, broker1: true, broker2: true, underwriter1: true, admin1: true };

module.exports = { users, EMAIL_VERIFIED };
