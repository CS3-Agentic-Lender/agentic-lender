// Seeds the local Firebase emulators (project demo-al) with the data in al-core/SCHEMA.md.
//
//   node scripts/seed.js            write to the running emulators
//   node scripts/seed.js --dry-run  print what would be written, touch nothing
//
// Then export it so everyone starts from the same state:
//   firebase emulators:export ./seed-data --project demo-al --force

const crypto = require('crypto');

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const PROJECT_ID = 'demo-al';
const DEMO_PASSWORD = 'password123'; // betterleaks:allow — fake password, local emulator only, never real auth
const DRY_RUN = process.argv.includes('--dry-run');

// Exactly the strings al-ai matches on (API design doc, section 9).
const STATUS = {
  DRAFT: 'Draft',
  APPLIED: 'Applied',
  AI_DELIBERATED: 'AI Deliberated',
  UNDERWRITER_APPROVED: 'Underwriter Approved',
  DECLINED: 'Declined',
  FUNDED: 'Funded',
  CLOSED: 'Closed',
};

// ---------- helpers ----------

const at = (iso) => new Date(iso);

const round1 = (n) => Math.round(n * 10) / 10;

// Monthly repayment on an amortising loan.
function monthlyRepaymentEur(principalEur, aprPct, termYears) {
  const r = aprPct / 100 / 12;
  const n = termYears * 12;
  return Math.round((principalEur * r) / (1 - Math.pow(1 + r, -n)));
}

// Same text as Python's json.dumps(record, sort_keys=True, separators=(",", ":"))
// for records made of plain strings, integers, arrays and objects (no floats, no non-ASCII).
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new Error(`audit records hold integers only, got ${value}`);
  }
  return JSON.stringify(value);
}

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// ---------- users ----------

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
    uid: 'broker1', role: 'broker', fullName: 'Bob Murphy', email: 'bob@test.com',
    phone: '+353871234511', addressLine1: '1 South Mall', county: 'Cork', eircode: 'T12 W8KD',
    createdAt: at('2026-09-01T09:00:00Z'),
  },
  {
    uid: 'broker2', role: 'broker', fullName: 'Ciara Kelly', email: 'ciara@test.com',
    phone: '+353871234512', addressLine1: '22 Patrick Street', county: 'Cork', eircode: 'T12 AB34',
    createdAt: at('2026-09-01T09:00:00Z'),
  },
  {
    uid: 'underwriter1', role: 'underwriter', fullName: 'Uma Nolan', email: 'uma@test.com',
    phone: '+353871234521', addressLine1: '5 Grand Parade', county: 'Cork', eircode: 'T12 YH60',
    createdAt: at('2026-09-01T09:00:00Z'),
  },
];

// ---------- applications ----------

// One property per application; each gets an indicative valuation.
const baseProperty = {
  county: 'Cork', propertyType: 'semi_detached', bedrooms: 3, floorAreaSqm: 98, berRating: 'C2',
};

function valuation(estimatedValueEur) {
  const contributions = { floor_area: 31200, county: 18500, bedrooms: 9800, property_type: -4600, ber: -1300 };
  const baselineEur = estimatedValueEur - Object.values(contributions).reduce((a, b) => a + b, 0);
  return { baselineEur, contributions, estimatedValueEur };
}

// Builds the shared fields for an application at a given stage.
function application(spec) {
  const {
    id, borrowerId, brokerId, status, loanType = 'mortgage', grossIncomeEur, monthlyDebtsEur,
    depositEur, firstTimeBuyer, loanAmountEur, termYears, askingPriceEur, estimatedValueEur,
    aprPct = 4.0, createdAt, submittedAt, updatedAt,
  } = spec;

  const doc = {
    borrowerId, brokerId, status, loanType, grossIncomeEur, monthlyDebtsEur, loanAmountEur, termYears,
    property: { ...baseProperty, askingPriceEur },
    createdAt: at(createdAt), updatedAt: at(updatedAt),
  };
  if (loanType === 'mortgage') Object.assign(doc, { depositEur, firstTimeBuyer });
  if (submittedAt) doc.submittedAt = at(submittedAt);

  // Results exist once the AI review has run.
  const reviewed = ![STATUS.DRAFT, STATUS.APPLIED].includes(status);
  let review = null;
  if (reviewed) {
    const repayment = monthlyRepaymentEur(loanAmountEur, aprPct, termYears);
    const incomeMonthly = Math.round(grossIncomeEur / 12);
    Object.assign(doc, {
      aiRunStatus: 'complete',
      estimatedValueEur,
      ltvPct: round1((loanAmountEur / estimatedValueEur) * 100),
      dtiPct: round1(((monthlyDebtsEur + repayment) / incomeMonthly) * 100),
      aprPct,
      approvalLikelihoodPct: spec.approvalLikelihoodPct,
    });
    review = {
      riskTier: spec.riskTier,
      dtiBreakdown: {
        incomeMonthlyEur: incomeMonthly,
        existingDebtsMonthlyEur: monthlyDebtsEur,
        newRepaymentMonthlyEur: repayment,
      },
      valuationDetail: valuation(estimatedValueEur),
      updatedAt: at(updatedAt),
    };
  }
  return { id, doc, review, spec };
}

const applications = [
  application({
    id: 'app-draft', borrowerId: 'borrower2', brokerId: 'broker2', status: STATUS.DRAFT,
    grossIncomeEur: 58000, monthlyDebtsEur: 250, depositEur: 30000, firstTimeBuyer: true,
    loanAmountEur: 230000, termYears: 30, askingPriceEur: 260000,
    createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:20:00Z',
  }),
  application({
    id: 'app-applied', borrowerId: 'borrower1', brokerId: 'broker1', status: STATUS.APPLIED,
    grossIncomeEur: 75000, monthlyDebtsEur: 300, depositEur: 35000, firstTimeBuyer: true,
    loanAmountEur: 270000, termYears: 30, askingPriceEur: 315000,
    createdAt: '2026-10-02T10:00:00Z', submittedAt: '2026-10-03T09:00:00Z', updatedAt: '2026-10-03T09:00:00Z',
  }),
  application({
    id: 'app-deliberated', borrowerId: 'borrower1', brokerId: 'broker1', status: STATUS.AI_DELIBERATED,
    grossIncomeEur: 75000, monthlyDebtsEur: 300, depositEur: 40000, firstTimeBuyer: true,
    loanAmountEur: 265000, termYears: 30, askingPriceEur: 310000, estimatedValueEur: 306000,
    approvalLikelihoodPct: 78, riskTier: 'B',
    createdAt: '2026-09-28T10:00:00Z', submittedAt: '2026-09-29T09:00:00Z', updatedAt: '2026-09-29T09:06:00Z',
  }),
  application({
    id: 'app-approved', borrowerId: 'borrower2', brokerId: 'broker2', status: STATUS.UNDERWRITER_APPROVED,
    loanType: 'heloc', grossIncomeEur: 92000, monthlyDebtsEur: 1100,
    loanAmountEur: 60000, termYears: 15, askingPriceEur: 420000, estimatedValueEur: 415000,
    approvalLikelihoodPct: 84, riskTier: 'A',
    decision: { outcome: 'approved', underwriterId: 'underwriter1', decidedAt: '2026-09-30T14:00:00Z', reason: 'Low LTV and DTI within limits' },
    createdAt: '2026-09-25T10:00:00Z', submittedAt: '2026-09-26T09:00:00Z', updatedAt: '2026-09-30T14:00:00Z',
  }),
  application({
    id: 'app-declined', borrowerId: 'borrower2', brokerId: 'broker2', status: STATUS.DECLINED,
    grossIncomeEur: 41000, monthlyDebtsEur: 650, depositEur: 15000, firstTimeBuyer: true,
    loanAmountEur: 245000, termYears: 35, askingPriceEur: 270000, estimatedValueEur: 258000,
    approvalLikelihoodPct: 22, riskTier: 'D',
    decision: { outcome: 'declined', underwriterId: 'underwriter1', decidedAt: '2026-09-24T15:00:00Z', reason: 'Loan above income limit and LTV over 90%' },
    createdAt: '2026-09-20T10:00:00Z', submittedAt: '2026-09-21T09:00:00Z', updatedAt: '2026-09-24T15:00:00Z',
  }),
  application({
    id: 'app-funded', borrowerId: 'borrower1', brokerId: 'broker1', status: STATUS.FUNDED,
    grossIncomeEur: 88000, monthlyDebtsEur: 200, depositEur: 60000, firstTimeBuyer: false,
    loanAmountEur: 300000, termYears: 30, askingPriceEur: 365000, estimatedValueEur: 366000,
    approvalLikelihoodPct: 91, riskTier: 'A', funded: true,
    decision: { outcome: 'approved', underwriterId: 'underwriter1', decidedAt: '2026-09-18T11:00:00Z', reason: 'Strong affordability' },
    createdAt: '2026-09-10T10:00:00Z', submittedAt: '2026-09-11T09:00:00Z', updatedAt: '2026-09-18T11:30:00Z',
  }),
  application({
    id: 'app-closed', borrowerId: 'borrower2', brokerId: 'broker2', status: STATUS.CLOSED,
    grossIncomeEur: 70000, monthlyDebtsEur: 150, depositEur: 50000, firstTimeBuyer: false,
    loanAmountEur: 240000, termYears: 25, askingPriceEur: 300000, estimatedValueEur: 302000,
    approvalLikelihoodPct: 88, riskTier: 'B', funded: true,
    decision: { outcome: 'approved', underwriterId: 'underwriter1', decidedAt: '2026-09-08T11:00:00Z', reason: 'Within lending rules' },
    createdAt: '2026-09-01T10:00:00Z', submittedAt: '2026-09-02T09:00:00Z', updatedAt: '2026-09-15T10:00:00Z',
  }),
];

// ---------- AI runs and calls ----------

const AGENTS = [
  { agent: 'affordability', provider: 'ollama', model: 'qwen3.5:9b' },
  { agent: 'valuation', provider: 'gemini', model: 'gemini-flash' },
  { agent: 'market', provider: 'groq', model: 'llama-3.3-70b' },
  { agent: 'strategist', provider: 'mistral', model: 'mistral-small' },
];

function aiRun(app) {
  const { spec } = app;
  const runId = `run-${app.id}`;
  const recommendation = spec.approvalLikelihoodPct >= 70 ? 'approve' : spec.approvalLikelihoodPct >= 40 ? 'conditional' : 'decline';
  const creditMemo = `Seeded credit memo for ${app.id}: risk tier ${spec.riskTier}, recommendation ${recommendation}.`;
  const startedAt = at(spec.submittedAt);
  const finishedAt = new Date(startedAt.getTime() + 6 * 60 * 1000);

  const calls = AGENTS.map((a, i) => ({
    id: `call-${app.id}-${a.agent}`,
    doc: {
      runId, applicationId: app.id, brokerId: app.doc.brokerId, ...a,
      output: `Seeded ${a.agent} output for ${app.id}.`,
      latencyMs: 1200 + i * 450,
      createdAt: new Date(startedAt.getTime() + (i + 1) * 60 * 1000),
    },
  }));

  const run = {
    applicationId: app.id, brokerId: app.doc.brokerId, status: 'complete', trigger: 'submit',
    startedAt, finishedAt, recommendation, approvalLikelihoodPct: spec.approvalLikelihoodPct, creditMemo,
  };
  return { runId, run, calls, creditMemo };
}

// Hash of one ai_calls document, with timestamps as ISO strings so it is reproducible.
function callHash(callDoc) {
  const plain = { ...callDoc, createdAt: callDoc.createdAt.toISOString() };
  return sha256(canonicalJson(plain));
}

// ---------- messages ----------

const messages = {
  'app-applied': [
    { senderId: 'borrower1', senderRole: 'borrower', text: 'Hi Bob, I have submitted my application. Is there anything else you need?', sentAt: '2026-10-03T09:05:00Z', read: true },
    { senderId: 'broker1', senderRole: 'broker', text: 'Thanks Alice, all good for now. The AI review will run shortly.', sentAt: '2026-10-03T10:00:00Z', read: false },
  ],
  'app-deliberated': [
    { senderId: 'broker1', senderRole: 'broker', text: 'The AI review is done. An underwriter will look at it next.', sentAt: '2026-09-29T11:00:00Z', read: true },
  ],
  'app-declined': [
    { senderId: 'underwriter1', senderRole: 'underwriter', text: 'Sorry Ben, we cannot approve this loan amount on your income. Your broker can talk through options.', sentAt: '2026-09-24T15:05:00Z', read: true },
  ],
};

// ---------- build everything ----------

function build() {
  const writes = []; // { path, data }
  for (const u of users) writes.push({ path: `users/${u.uid}`, data: { ...u } });

  for (const app of applications) {
    const { spec } = app;
    const doc = { ...app.doc };

    if (spec.decision) {
      doc.decision = { ...spec.decision, decidedAt: at(spec.decision.decidedAt) };
      doc.feeStatus = 'paid';
      doc.feeIntentId = `pi_seed_${app.id.replace(/-/g, '_')}`;
    }
    if (app.review) writes.push({ path: `applications/${app.id}/review/underwriting`, data: app.review });

    if (app.review) {
      const { runId, run, calls, creditMemo } = aiRun(app);
      writes.push({ path: `ai_runs/${runId}`, data: run });
      for (const c of calls) writes.push({ path: `ai_calls/${c.id}`, data: c.doc });

      // Loan note and audit record exist once the loan is minted (Funded, and Closed after Funded).
      if (spec.funded) {
        const record = {
          aiCalls: calls.map((c) => ({ id: c.id, sha256: callHash(c.doc) })),
          applicationId: app.id,
          creditMemo,
          decision: spec.decision.outcome,
          riskTier: spec.riskTier,
          signedOffAt: spec.decision.decidedAt,
          underwriterId: spec.decision.underwriterId,
        };
        const auditHash = sha256(canonicalJson(record));
        writes.push({ path: `applications/${app.id}/audit/record`, data: { ...record, auditHash } });
        doc.loanNote = {
          tokenId: String(applications.indexOf(app) + 1),
          contractAddress: '0x0000000000000000000000000000000000000000',
          txHash: `0x${sha256(`tx-${app.id}`)}`,
          auditHash,
          mintedAt: new Date(at(spec.decision.decidedAt).getTime() + 30 * 60 * 1000),
        };
      }
    }

    for (const [i, m] of (messages[app.id] || []).entries()) {
      writes.push({ path: `applications/${app.id}/messages/msg-${i + 1}`, data: { ...m, sentAt: at(m.sentAt) } });
    }

    writes.push({ path: `applications/${app.id}`, data: doc });
  }
  return writes;
}

// ---------- write to the emulators ----------

async function seed() {
  const writes = build();

  if (DRY_RUN) {
    const counts = {};
    for (const w of writes) {
      const parts = w.path.split('/');
      const collection = parts.filter((_, i) => i % 2 === 0).join('/');
      counts[collection] = (counts[collection] || 0) + 1;
    }
    console.log(`Dry run: ${users.length} Auth users and ${writes.length} Firestore documents`);
    console.table(counts);
    return;
  }

  if (!PROJECT_ID.startsWith('demo-')) throw new Error('Refusing to seed a non-demo project');

  const { initializeApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth();
  const db = getFirestore();

  for (const u of users) {
    try {
      await auth.createUser({ uid: u.uid, email: u.email, password: DEMO_PASSWORD, displayName: u.fullName });
    } catch (err) {
      if (err.code !== 'auth/uid-already-exists') throw err;
      await auth.updateUser(u.uid, { email: u.email, password: DEMO_PASSWORD, displayName: u.fullName });
    }
    await auth.setCustomUserClaims(u.uid, { role: u.role });
  }

  const batch = db.batch();
  for (const w of writes) batch.set(db.doc(w.path), w.data);
  await batch.commit();

  console.log(`Seed complete: ${users.length} users, ${applications.length} applications, ${writes.length} documents`);
}

seed().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
