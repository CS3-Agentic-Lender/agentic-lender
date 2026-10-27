// The shared audit-hash vectors must match what seed.js writes, so al-core's and al-ai's tests can trust them.
// No emulator needed.

const fs = require('fs');
const { buildVectors, FILE } = require('../scripts/audit-vectors');

test('test/audit-hash-vectors.json is up to date with the seed (run: node scripts/audit-vectors.js --write)', () => {
  expect(JSON.parse(fs.readFileSync(FILE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(buildVectors())));
});

test('the vectors hold at least one audit record and one AI call', () => {
  const names = buildVectors().vectors.map((v) => v.name);
  expect(names.some((n) => n.startsWith('audit-record:'))).toBe(true);
  expect(names.some((n) => n.startsWith('ai-call:'))).toBe(true);
});
