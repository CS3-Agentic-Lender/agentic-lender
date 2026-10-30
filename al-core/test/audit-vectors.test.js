// The shared audit-hash vectors must match what seed.js writes, so al-core's and al-ai's tests can trust them.
// No emulator needed.

const crypto = require('crypto');
const fs = require('fs');
const { buildVectors, FILE } = require('../scripts/audit-vectors');

// Python's json.dumps sorts keys with no spaces and escapes every non-ASCII character as \uXXXX in lower-case hex.
// Hashing that way here, without app/audit.py, shows the non-ascii vector's fixed hash is right.
const sorted = (v) => {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]));
  return v;
};
const escapeNonAscii = (text) => text.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

test('test/audit-hash-vectors.json is up to date with the seed (run: node scripts/audit-vectors.js --write)', () => {
  expect(JSON.parse(fs.readFileSync(FILE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(buildVectors())));
});

test('the vectors hold at least one audit record and one AI call', () => {
  const names = buildVectors().vectors.map((v) => v.name);
  expect(names.some((n) => n.startsWith('audit-record:'))).toBe(true);
  expect(names.some((n) => n.startsWith('ai-call:'))).toBe(true);
});

test('the non-ascii vector has non-ASCII text, and its hash is the escaped form, not raw UTF-8', () => {
  const vector = buildVectors().vectors.find((v) => v.name.startsWith('non-ascii:'));
  expect(vector).toBeDefined();
  const text = JSON.stringify(sorted(vector.record));
  expect(/[^\x00-\x7f]/.test(text)).toBe(true);
  expect(sha256(escapeNonAscii(text))).toBe(vector.hash);
  expect(sha256(text)).not.toBe(vector.hash);
});
