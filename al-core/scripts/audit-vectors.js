// Builds the shared audit-hash test vectors (test/audit-hash-vectors.json) from the hashes seed.js writes.
// Run `node scripts/audit-vectors.js --write` after the seed's audit records change; test/audit-vectors.test.js
// fails if the file is out of date. al-core's pytest and al-ai's tests load the file and must get the same hashes.

const fs = require('fs');
const path = require('path');
const { build } = require('./seed');

const FILE = path.join(__dirname, '..', 'test', 'audit-hash-vectors.json');

const SPEC = 'hash = SHA-256 (lower-case hex) of json.dumps(record, sort_keys=True, separators=(",", ":")) after removing the record\'s own auditHash field. Timestamps are UTC ISO strings with milliseconds and Z, e.g. 2026-09-18T11:00:00.000Z. Non-ASCII text is escaped as json.dumps does by default (ensure_ascii), so an accented e is hashed as backslash, u, 0, 0, e, 9 and never as the raw character: an implementation that hashes raw UTF-8 fails the non-ascii vector.';

// The seed's records are all ASCII (its JavaScript canonicalJson does not escape), so it cannot make this vector.
// The hash was made by app/audit.py and is fixed here; test/audit-vectors.test.js recomputes it a second way.
// The same record hashed as raw UTF-8 gives 58376d28..., which must not be the answer.
const NON_ASCII_VECTOR = {
  name: 'non-ascii:accents-and-euro-sign',
  record: {
    applicationId: 'non-ascii-example',
    creditMemo: 'Café owner Zoë Ó Súilleabháin, loan EUR 300k (€300,000)',
    decision: 'approved',
    signedOffAt: '2026-10-01T09:00:00.000Z',
    underwriterId: 'underwriter1',
  },
  hash: '43d93d374b636f65c501242af20f871fab6ada70ecea503126aa01a799adc305',
};

function buildVectors() {
  const writes = build();
  const vectors = [];

  for (const w of writes.filter((x) => /^applications\/[^/]+\/audit\/record$/.test(x.path))) {
    const { auditHash, ...record } = w.data;
    vectors.push({ name: `audit-record:${record.applicationId}`, record, hash: auditHash });

    // Each audit record lists the hash of every AI call behind it: the same function, applied to the ai_calls document.
    for (const call of record.aiCalls) {
      const doc = writes.find((x) => x.path === `ai_calls/${call.id}`).data;
      vectors.push({ name: `ai-call:${call.id}`, record: { ...doc, createdAt: doc.createdAt.toISOString() }, hash: call.sha256 });
    }
  }
  vectors.push(NON_ASCII_VECTOR);
  return { spec: SPEC, vectors };
}

module.exports = { buildVectors, FILE };

if (require.main === module && process.argv.includes('--write')) {
  // Pure ASCII on disk (accents as \uXXXX), so a reader that guesses the wrong encoding, such as Python on Windows,
  // still gets the same text and the same hashes.
  const json = JSON.stringify(buildVectors(), null, 2).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  fs.writeFileSync(FILE, `${json}\n`);
  console.log(`wrote ${FILE}`);
}
