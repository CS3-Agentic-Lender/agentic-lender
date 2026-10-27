// Builds the shared audit-hash test vectors (test/audit-hash-vectors.json) from the hashes seed.js writes.
// Run `node scripts/audit-vectors.js --write` after the seed's audit records change; test/audit-vectors.test.js
// fails if the file is out of date. al-core's pytest and al-ai's tests load the file and must get the same hashes.

const fs = require('fs');
const path = require('path');
const { build } = require('./seed');

const FILE = path.join(__dirname, '..', 'test', 'audit-hash-vectors.json');

const SPEC = 'hash = SHA-256 (lower-case hex) of json.dumps(record, sort_keys=True, separators=(",", ":")) after removing the record\'s own auditHash field. Timestamps are UTC ISO strings with milliseconds and Z, e.g. 2026-09-18T11:00:00.000Z. Non-ASCII text is escaped as json.dumps does by default.';

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
  return { spec: SPEC, vectors };
}

module.exports = { buildVectors, FILE };

if (require.main === module && process.argv.includes('--write')) {
  fs.writeFileSync(FILE, `${JSON.stringify(buildVectors(), null, 2)}\n`);
  console.log(`wrote ${FILE}`);
}
