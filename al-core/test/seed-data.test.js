// Checks on the documents scripts/seed.js would write. Pure functions: no emulator needed.

const { build, policyBreaches, policyGate, approvalLikelihood, APPROVAL_LIKELIHOODS } = require('../scripts/seed');

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

// ---- the borrower card fields and the policy gate result (AL-278) ----

const reviewed = applications.filter((a) => a.data.riskTier);
const reviewDocs = writes.filter((w) => /^applications\/[^/]+\/review\/underwriting$/.test(w.path));
const runs = writes.filter((w) => /^ai_runs\//.test(w.path));

describe('approvalLikelihood and purchaseLtvPct', () => {
  test('no seeded document still carries approvalLikelihoodPct', () => {
    for (const w of writes) expect(w.data).not.toHaveProperty('approvalLikelihoodPct');
  });

  test.each(reviewed.map((a) => [a.path, a.data]))('%s has a label the app knows, and none before the AI review', (_path, app) => {
    expect(['Low', 'Medium', 'High']).toContain(app.approvalLikelihood);
  });

  test('an application that has not been through the AI review has no label (the app shows Unknown)', () => {
    for (const a of applications.filter((a) => !a.data.riskTier)) expect(a.data).not.toHaveProperty('approvalLikelihood');
  });

  test('a purchase carries purchaseLtvPct, loan over asking price, to one decimal place', () => {
    for (const { data } of reviewed.filter((a) => a.data.loanType === 'mortgage')) {
      expect(data.purchaseLtvPct).toBeCloseTo((data.loanAmountEur / data.property.askingPriceEur) * 100, 1);
    }
  });

  test('a HELOC has no purchaseLtvPct, because it has no asking price; its card reads ltvPct', () => {
    const helocs = reviewed.filter((a) => a.data.loanType === 'heloc');
    expect(helocs.length).toBeGreaterThan(0);
    for (const { data } of helocs) {
      expect(data).not.toHaveProperty('purchaseLtvPct');
      expect(typeof data.ltvPct).toBe('number');
    }
  });

  describe('the rule order', () => {
    const clean = { loanType: 'mortgage', firstTimeBuyer: true, grossIncomeEur: 80000, loanAmountEur: 240000, askingPriceEur: 400000 };
    const ok = { stressedDti: 'Comfortable', surplus: 'Comfortable' };
    test('nothing of concern is High', () => expect(approvalLikelihood(clean, ok)).toBe('High'));
    test('a caution band is Medium', () => {
      expect(approvalLikelihood(clean, { ...ok, stressedDti: 'Caution' })).toBe('Medium');
      expect(approvalLikelihood(clean, { ...ok, surplus: 'Caution' })).toBe('Medium');
    });
    test('a limit breach is Medium', () => expect(approvalLikelihood({ ...clean, loanAmountEur: 330000 }, ok)).toBe('Medium'));
    test('an adverse band is Low, even with a caution band or a breach too', () => {
      expect(approvalLikelihood(clean, { ...ok, surplus: 'Adverse' })).toBe('Low');
      expect(approvalLikelihood({ ...clean, loanAmountEur: 330000 }, { stressedDti: 'Adverse', surplus: 'Caution' })).toBe('Low');
    });
    test('the label values are the four the app reads', () => expect(APPROVAL_LIKELIHOODS).toEqual(['Unknown', 'Low', 'Medium', 'High']));
  });
});

describe('policyGate on review/underwriting', () => {
  test('every reviewed application has the gate result, in the shape the gate returns', () => {
    expect(reviewDocs.length).toBe(reviewed.length);
    for (const w of reviewDocs) {
      expect(Object.keys(w.data.policyGate).sort()).toEqual(['breaches', 'changed', 'conditions', 'effective', 'original']);
      expect(['Approve', 'Conditionally Approve', 'Decline']).toContain(w.data.policyGate.original);
      expect(['Approve', 'Conditionally Approve', 'Decline']).toContain(w.data.policyGate.effective);
    }
  });

  test('a breach never makes the recommendation more favourable, and every breach has a condition unless declined', () => {
    for (const w of reviewDocs) {
      const { original, effective, conditions, breaches } = w.data.policyGate;
      if (breaches.length) expect(effective).not.toBe('Approve');
      if (original === 'Decline') expect(effective).toBe('Decline');
      if (effective !== 'Decline') expect(conditions.length).toBe(breaches.length);
    }
  });

  test('the seeded declined application breaks both purchase limits, as its decision reason says', () => {
    const w = reviewDocs.find((r) => r.path.includes('app-declined'));
    expect(w.data.policyGate.breaches).toEqual(['LTI_CAP', 'LTV_CAP']);
    expect(w.data.policyGate.effective).toBe('Decline');
  });

  test('a purchase over an income or price limit is risk tier D', () => {
    for (const w of reviewDocs) {
      const appId = w.path.split('/')[1];
      const app = applications.find((a) => a.path === `applications/${appId}`).data;
      if (w.data.policyGate.breaches.some((rule) => rule === 'LTI_CAP' || rule === 'LTV_CAP')) expect(app.riskTier).toBe('D');
    }
  });

  test('the gate rules: exactly on a limit is fine and just over is a breach', () => {
    const purchase = { loanType: 'mortgage', firstTimeBuyer: true, grossIncomeEur: 60000, askingPriceEur: 1000000 };
    expect(policyBreaches({ ...purchase, loanAmountEur: 240000 })).toEqual([]);
    expect(policyBreaches({ ...purchase, loanAmountEur: 240001 })).toEqual(['LTI_CAP']);
    const heloc = { loanType: 'heloc', grossIncomeEur: 80000, askingPriceEur: 1000000 };
    expect(policyBreaches({ ...heloc, existingMortgageBalanceEur: 240000, loanAmountEur: 40000 })).toEqual([]);
    expect(policyBreaches({ ...heloc, existingMortgageBalanceEur: 250000, loanAmountEur: 40000 })).toEqual(['LTI_CAP']);
    expect(policyBreaches({ ...heloc, grossIncomeEur: 1e6, existingMortgageBalanceEur: 100000, loanAmountEur: 700001 })).toEqual(['CLTV_CAP']);
  });

  test('the gate: Approve with a breach is Conditionally Approve, a Decline stays a Decline', () => {
    expect(policyGate('approve', ['LTI_CAP'])).toEqual({
      original: 'Approve', effective: 'Conditionally Approve', conditions: ['Requires lender exception review (LTI_CAP)'], breaches: ['LTI_CAP'], changed: true,
    });
    expect(policyGate('decline', ['LTV_CAP'])).toMatchObject({ effective: 'Decline', conditions: [], changed: false });
    expect(policyGate('approve', [])).toMatchObject({ effective: 'Approve', changed: false });
  });
});

describe('ai_runs', () => {
  test('a run record carries the recommendation and no percentage', () => {
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      expect(['approve', 'conditional', 'decline']).toContain(r.data.recommendation);
      expect(r.data).not.toHaveProperty('approvalLikelihoodPct');
    }
  });
});
