// The DTI breakdown on each reviewed application (AL-65): the seed's port of al-ai's affordability module must give
// al-ai's own numbers, and every stored breakdown must add up from the application it belongs to. No emulator needed.

const { assess, dtiBreakdown, build, riskTier } = require('../scripts/seed');
const reference = require('./dti-reference-cases.json');

const FIELDS = [
  'incomeMonthlyEur', 'takeHomeMonthlyEur', 'existingDebtsMonthlyEur', 'livingCostsMonthlyEur',
  'newRepaymentMonthlyEur', 'stressedRepaymentMonthlyEur',
  'benchmarkRatePct', 'stressMarginPct', 'stressedRatePct', 'rateDate',
  'dtiPct', 'stressedDtiPct', 'surplusMonthlyEur', 'stressedSurplusMonthlyEur',
  'dtiBand', 'surplusBand',
];

describe("the seed's port of al-ai's affordability module", () => {
  test.each(reference.cases.map((c) => [c.name, c]))('%s: every figure matches al-ai', (_name, c) => {
    const got = assess(c.inputs);
    for (const key of ['repayment', 'stressedRepayment', 'dti', 'stressedDti', 'surplus', 'stressedSurplus']) {
      expect(got[key]).toBeCloseTo(c.expected[key], 8);
    }
    expect(got.dtiBand).toBe(c.expected.dtiBand);
    expect(got.surplusBand).toBe(c.expected.surplusBand);
  });

  // The figures al-ai's own tests assert for these two cases (tests/test_affordability.py), to the cent.
  test('the reference repayments are the ones al-ai asserts', () => {
    const [single, joint] = reference.cases.map((c) => assess(c.inputs));
    expect([single.repayment, single.stressedRepayment].map((v) => v.toFixed(2))).toEqual(['1145.80', '1438.92']);
    expect([joint.repayment, joint.stressedRepayment].map((v) => v.toFixed(2))).toEqual(['1425.16', '1739.61']);
  });

  test('the stressed rate is the benchmark plus two points', () => {
    const c = reference.cases[0].inputs;
    expect(assess(c).stressedRepayment).toBeGreaterThan(assess(c).repayment);
    expect(assess({ ...c, benchmarkRatePct: 0 }).repayment).toBeCloseTo(c.loanEur / (c.termYears * 12), 8);
  });

  test('the bands use the stressed figures and switch at the right edges', () => {
    // DTI: up to 40% comfortable, up to 50% caution. Surplus: 500 or more comfortable, 0 or more caution.
    // The edges are tested a cent either side, so floating point can't decide a test.
    const base = { loanEur: 100000, termYears: 25, benchmarkRatePct: 4, grossAnnualIncomeEur: 120000, takeHomeMonthlyEur: 7000, livingCostsMonthlyEur: 1000 };
    const stressed = assess({ ...base, existingDebtsMonthlyEur: 0 }).stressedRepayment;
    const dtiBandAt = (pct) => assess({ ...base, existingDebtsMonthlyEur: (pct / 100) * 10000 - stressed }).dtiBand; // gross is 10,000 a month
    expect([dtiBandAt(39.99), dtiBandAt(40.01), dtiBandAt(49.99), dtiBandAt(50.01)]).toEqual(['Comfortable', 'Caution', 'Caution', 'Adverse']);

    const flat = { ...base, grossAnnualIncomeEur: 1e9, existingDebtsMonthlyEur: 0 };
    const surplusBandAt = (target) => assess({ ...flat, livingCostsMonthlyEur: flat.takeHomeMonthlyEur - stressed - target }).surplusBand;
    expect([surplusBandAt(500.01), surplusBandAt(499.99), surplusBandAt(0.01), surplusBandAt(-0.01)]).toEqual(['Comfortable', 'Caution', 'Caution', 'Adverse']);
  });
});

describe('the breakdown on each reviewed application', () => {
  const writes = build();
  const reviews = writes.filter((w) => /^applications\/[^/]+\/review\/underwriting$/.test(w.path));
  const application = (id) => writes.find((w) => w.path === `applications/${id}`).data;

  test('there is a review for every application the AI has run on', () => {
    expect(reviews.length).toBeGreaterThanOrEqual(5);
  });

  test.each(reviews.map((w) => [w.data.applicationId, w.data]))('%s has exactly the documented fields', (_id, review) => {
    expect(Object.keys(review.dtiBreakdown).sort()).toEqual([...FIELDS].sort());
  });

  test.each(reviews.map((w) => [w.data.applicationId, w.data]))('%s adds up from the application it belongs to', (id, review) => {
    const app = application(id);
    const b = review.dtiBreakdown;
    const { breakdown } = dtiBreakdown(app, b.benchmarkRatePct, b.rateDate);
    expect(b).toEqual(breakdown);

    // The inputs are the ones on the application; the stored figures are the module's, to the cent.
    expect(b.takeHomeMonthlyEur).toBe(app.monthlyTakeHomeEur);
    expect(b.livingCostsMonthlyEur).toBe(app.monthlyLivingCostsEur);
    expect(b.existingDebtsMonthlyEur).toBe(app.monthlyDebtsEur);
    expect(b.incomeMonthlyEur).toBeCloseTo(app.grossIncomeEur / 12, 2);
    expect(b.surplusMonthlyEur).toBeCloseTo(b.takeHomeMonthlyEur - b.livingCostsMonthlyEur - b.existingDebtsMonthlyEur - b.newRepaymentMonthlyEur, 1);
    expect(b.stressedSurplusMonthlyEur).toBeCloseTo(b.takeHomeMonthlyEur - b.livingCostsMonthlyEur - b.existingDebtsMonthlyEur - b.stressedRepaymentMonthlyEur, 1);
    expect(b.dtiPct).toBeCloseTo(((b.existingDebtsMonthlyEur + b.newRepaymentMonthlyEur) / b.incomeMonthlyEur) * 100, 1);
    expect(b.stressedRatePct).toBe(b.benchmarkRatePct + b.stressMarginPct);

    // The application's own DTI is the benchmark one, and the risk tier was worked out from these bands.
    expect(app.dtiPct).toBeCloseTo(b.dtiPct, 1);
    expect(app.aprPct).toBe(b.benchmarkRatePct);
    expect(review.riskTier).toBe(app.riskTier);
    const findings = { stressedDti: b.dtiBand, surplus: b.surplusBand };
    expect(riskTier({ ...app, askingPriceEur: app.property.askingPriceEur }, findings)).toBe(app.riskTier);
  });

  test('every seeded application, even a Draft, holds take-home pay and living costs', () => {
    for (const w of writes.filter((x) => /^applications\/[^/]+$/.test(x.path))) {
      expect(w.data.monthlyTakeHomeEur).toBeGreaterThan(0);
      expect(w.data.monthlyLivingCostsEur).toBeGreaterThan(0);
    }
  });
});
