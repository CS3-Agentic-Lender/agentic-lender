// Checks on the documents scripts/seed.js would write. Pure functions: no emulator needed.

const fs = require('fs');
const path = require('path');
const { build, policyBreaches, policyGate, approvalLikelihood, APPROVAL_LIKELIHOODS, valuation, PRICE_REVIEW_GAP } = require('../scripts/seed');

const manifestThreshold = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'al-ai', 'models', 'valuation', 'manifest.json'), 'utf8'),
).threshold;

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

describe('loan term', () => {
  test.each(applications.map((a) => [a.path, a.data]))('%s has a term of 5 to 35 years, the range the API accepts', (_path, app) => {
    expect(Number.isInteger(app.termYears)).toBe(true);
    expect(app.termYears).toBeGreaterThanOrEqual(5);
    expect(app.termYears).toBeLessThanOrEqual(35);
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
      const heloc = applications.find((a) => a.path === `applications/${w.path.split('/')[1]}`).data.loanType === 'heloc';
      if (breaches.length) expect(effective).not.toBe('Approve');
      if (original === 'Decline') expect(effective).toBe('Decline');
      // One condition for each breach, and every HELOC also carries the surveyor condition.
      if (effective !== 'Decline') expect(conditions.length).toBe(breaches.length + (heloc ? 1 : 0));
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
  const RECOMMENDATIONS = ['Approve', 'Conditionally Approve', 'Decline'];
  const VOTERS = ['affordability', 'valuation', 'strategist'];
  const AFFORDABILITY_RATINGS = ['strong', 'adequate', 'weak', 'unaffordable'];
  const VALUATION_RATINGS = ['strong', 'adequate', 'weak', 'unsupported'];
  const runDocs = runs.map((r) => [r.path, r.data]);

  test('a run record carries no percentage and no single old-style recommendation', () => {
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      expect(r.data).not.toHaveProperty('approvalLikelihoodPct');
      expect(r.data).not.toHaveProperty('recommendation');
    }
  });

  test.each(runDocs)('%s has exactly the documented fields', (_path, run) => {
    expect(Object.keys(run).sort()).toEqual([
      'agents', 'applicationId', 'brokerId', 'consensus', 'creditMemo', 'effectiveRecommendation', 'failedStep', 'failureReason',
      'finishedAt', 'originalRecommendation', 'policyGate', 'rerunOf', 'startedAt', 'status', 'trigger',
    ]);
    expect(run.status).toBe('complete');
    expect(typeof run.creditMemo).toBe('string');
    expect(run.creditMemo.trim()).not.toBe(''); // the audit record refuses a run without a credit memo
    expect([run.rerunOf, run.failedStep, run.failureReason]).toEqual([null, null, null]);
  });

  test.each(runDocs)('%s holds every agent, with a vote for the three voters and none for Market & Macro', (_path, run) => {
    expect(Object.keys(run.agents).sort()).toEqual(['affordability', 'market', 'strategist', 'valuation']);
    for (const [name, a] of Object.entries(run.agents)) {
      expect(Object.keys(a).sort()).toEqual(['concerns', 'conditions', 'model', 'promptVersion', 'provider', 'rating', 'recommendation', 'report']);
      expect(a.provider && a.model && a.promptVersion && a.report).toBeTruthy();
      if (VOTERS.includes(name)) expect(RECOMMENDATIONS).toContain(a.recommendation);
    }
    expect([run.agents.market.recommendation, run.agents.market.rating, run.agents.market.concerns, run.agents.market.conditions]).toEqual([null, null, null, null]);
    expect(AFFORDABILITY_RATINGS).toContain(run.agents.affordability.rating);
    expect(VALUATION_RATINGS).toContain(run.agents.valuation.rating);
    expect([run.agents.strategist.rating, run.agents.strategist.concerns]).toEqual([null, null]); // the strategist's reply has neither
  });

  test.each(runDocs)('%s: the consensus is the three votes side by side, and the recommendations are the strategist and the gate ones', (_path, run) => {
    const votes = Object.fromEntries(VOTERS.map((n) => [n, run.agents[n].recommendation]));
    expect(run.consensus.votes).toEqual(votes);
    expect(run.consensus.disagreement).toBe(new Set(Object.values(votes)).size > 1);
    expect(run.originalRecommendation).toBe(run.agents.strategist.recommendation);
    expect(run.originalRecommendation).toBe(run.policyGate.original);
    expect(run.effectiveRecommendation).toBe(run.policyGate.effective);
  });

  test('one seeded run has the agents disagreeing, and the others agree, so the console has both to show', () => {
    const flags = runs.map((r) => r.data.consensus.disagreement);
    expect(flags).toContain(true);
    expect(flags).toContain(false);
  });
});

describe('audit records (AL-283)', () => {
  const fs = require('fs');
  const path = require('path');
  const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-hash-vectors.json'), 'utf8')).vectors;
  const records = writes.filter((w) => /^applications\/[^/]+\/audit\/record$/.test(w.path));

  test('there is an audit record for each funded application', () => {
    expect(records.length).toBeGreaterThan(0);
  });

  test.each(records.map((r) => [r.data.applicationId, r.data]))('%s: the record states the loan as whole cents and months', (id, record) => {
    const app = applications.find((a) => a.path === `applications/${id}`).data;
    expect(record.loanType).toBe(app.loanType);
    expect(record.principalCents).toBe(app.loanAmountEur * 100);
    expect(record.termMonths).toBe(app.termYears * 12);
    expect(Number.isInteger(record.principalCents) && Number.isInteger(record.termMonths)).toBe(true);
  });

  test.each(records.map((r) => [r.data.applicationId, r.data]))('%s: the loan note, the record and the shared vector hold the same hash', (id, record) => {
    const app = applications.find((a) => a.path === `applications/${id}`).data;
    const vector = vectors.find((v) => v.name === `audit-record:${id}`);
    expect(vector).toBeDefined();
    expect(app.loanNote.auditHash).toBe(record.auditHash);
    expect(vector.hash).toBe(record.auditHash);
  });
});

describe('valuationDetail and the HELOC gate (AL-287)', () => {
  const reviews = writes.filter((w) => /^applications\/[^/]+\/review\/underwriting$/.test(w.path));
  const applicationOf = (reviewPath) => applications.find((a) => a.path === reviewPath.replace('/review/underwriting', '')).data;
  const KEYS = ['askingPriceGap', 'baselineEur', 'contributions', 'displayEstimateEur', 'estimatedValueEur', 'modelVersion', 'priceNeedsReview', 'supportWarnings'];
  const FEATURES = ['county', 'property_type', 'bedrooms', 'floor_area', 'ber', 'eircode_area'];
  const SURVEYOR = "Requires an independent surveyor's valuation (HELOC)";

  test('there are reviewed applications to check', () => {
    expect(reviews.length).toBeGreaterThan(0);
  });

  test.each(reviews.map((r) => [r.path.split('/')[1], r.data]))('%s: valuationDetail has exactly the agreed keys', (_id, review) => {
    expect(Object.keys(review.valuationDetail).sort()).toEqual(KEYS);
  });

  test.each(reviews.map((r) => [r.path.split('/')[1], r.data]))('%s: contributions are the six inputs, biggest first, and add up to the estimate', (_id, review) => {
    const v = review.valuationDetail;
    expect(Array.isArray(v.contributions)).toBe(true);
    expect(v.contributions.map((c) => c.feature).sort()).toEqual([...FEATURES].sort());
    for (const piece of v.contributions) expect(Object.keys(piece).sort()).toEqual(['eur', 'feature', 'value']);
    const sizes = v.contributions.map((c) => Math.abs(c.eur));
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(v.baselineEur + v.contributions.reduce((sum, c) => sum + c.eur, 0)).toBeCloseTo(v.estimatedValueEur, 2);
  });

  test.each(reviews.map((r) => [r.path, r.data]))('%s: the estimate, the display estimate and the application agree', (path, review) => {
    const v = review.valuationDetail;
    expect(v.estimatedValueEur).toBe(applicationOf(path).estimatedValueEur);
    expect(v.displayEstimateEur).toBe(Math.round(v.estimatedValueEur / 1000) * 1000);
  });

  test.each(reviews.map((r) => [r.path, r.data]))('%s: the price gap and flag exist for a purchase and are null for a HELOC', (path, review) => {
    const v = review.valuationDetail;
    const app = applicationOf(path);
    if (app.loanType === 'heloc') {
      expect(v.askingPriceGap).toBeNull();
      expect(v.priceNeedsReview).toBeNull();
    } else {
      expect(v.askingPriceGap).toBeCloseTo(app.property.askingPriceEur / v.estimatedValueEur - 1, 3);
      expect(v.priceNeedsReview).toBe(v.askingPriceGap > manifestThreshold);
    }
  });

  test("the review threshold is the model's own, from the manifest al-ai reads, and not v1's 43.3%", () => {
    expect(PRICE_REVIEW_GAP).toBe(manifestThreshold);
    expect(manifestThreshold).toBeCloseTo(0.3567, 4);
    expect(valuation({ estimatedValueEur: 400000, askingPriceEur: 400000 * 1.4, property: {} }).priceNeedsReview).toBe(true); // 40% over: flagged by v2, not by v1
    expect(valuation({ estimatedValueEur: 400000, askingPriceEur: 400000 * 1.35, property: {} }).priceNeedsReview).toBe(false);
    expect(valuation({ estimatedValueEur: 400000, askingPriceEur: null, property: {} }).priceNeedsReview).toBeNull();
  });

  test('every HELOC carries the surveyor condition, so an Approve on one is a Conditionally Approve', () => {
    const helocs = reviews.filter((r) => applicationOf(r.path).loanType === 'heloc');
    expect(helocs.length).toBeGreaterThan(0);
    for (const r of helocs) {
      const gate = r.data.policyGate;
      expect(gate.conditions).toContain(SURVEYOR);
      if (gate.original === 'Approve') expect(gate.effective).toBe('Conditionally Approve');
      if (gate.original !== 'Decline') expect(gate.changed).toBe(true);
    }
  });

  test('a purchase never gets the surveyor condition', () => {
    for (const r of reviews.filter((x) => applicationOf(x.path).loanType === 'mortgage')) {
      expect(r.data.policyGate.conditions).not.toContain(SURVEYOR);
    }
  });

  test('the run record keeps the same policy gate result as the review document', () => {
    for (const r of reviews) {
      const run = writes.find((w) => w.path === `ai_runs/run-${r.path.split('/')[1]}`);
      expect(run).toBeDefined();
      expect(run.data.policyGate).toEqual(r.data.policyGate);
    }
  });
});
