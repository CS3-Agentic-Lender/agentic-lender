// Checks on the documents scripts/seed.js would write. Pure functions: no emulator needed.

const { build } = require('../scripts/seed');

// The eight property types the valuation model accepts.
const PROPERTY_TYPES = ['Detached', 'Semi-D', 'Terrace', 'End of Terrace', 'Bungalow', 'Apartment', 'Duplex', 'Townhouse'];

const writes = build();
const applications = writes.filter((w) => /^applications\/[^/]+$/.test(w.path));
const userByUid = new Map(writes.filter((w) => /^users\/[^/]+$/.test(w.path)).map((w) => [w.path.split('/')[1], w.data]));

test('the seed writes applications and users to check', () => {
  expect(applications.length).toBeGreaterThan(0);
  expect(userByUid.size).toBeGreaterThan(0);
});

describe('borrowerName', () => {
  test.each(applications.map((a) => [a.path, a.data]))("%s carries its borrower's full name", (_path, app) => {
    const borrower = userByUid.get(app.borrowerId);
    expect(borrower).toBeDefined();
    expect(app.borrowerName).toBe(borrower.fullName);
    expect(app.borrowerName).not.toBe('');
  });
});

describe('property type', () => {
  test.each(applications.map((a) => [a.path, a.data]))("%s uses one of the valuation model's property types", (_path, app) => {
    expect(PROPERTY_TYPES).toContain(app.property.propertyType);
  });
});
