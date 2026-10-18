// The LTV band and risk tier rules agreed on AL-64, and the seed data's coverage of them.
// Pure functions: no emulator needed.

const { purchasePriceLtvPct, ltvBand, riskTier, build, checkCoverage } = require('../scripts/seed');

// A first-time buyer's mortgage at 80% LTV and 3.6x income, with nothing flagged: tier A.
const base = {
  loanType: 'mortgage', firstTimeBuyer: true, grossIncomeEur: 75000,
  loanAmountEur: 270000, askingPriceEur: 337500,
};
const clean = { stressedDti: 'Pass', surplus: 'Pass' };

describe('purchase-price LTV', () => {
  test('a mortgage is the loan over the asking price', () =>
    expect(purchasePriceLtvPct(base)).toBe(80));
  test('a HELOC adds the existing mortgage (combined LTV)', () =>
    expect(purchasePriceLtvPct({ loanType: 'heloc', loanAmountEur: 60000, existingMortgageBalanceEur: 180000, askingPriceEur: 400000 })).toBe(60));
});

describe('LTV band', () => {
  test.each([
    [50, '80_or_less'], [80, '80_or_less'], [80.1, '80_to_90'], [90, '80_to_90'], [90.1, 'over_90'],
  ])('%s%% is %s', (pct, band) => expect(ltvBand(pct)).toBe(band));
});

describe('risk tier', () => {
  test('no concerns is A', () => expect(riskTier(base, clean)).toBe('A'));

  test.each([
    ['stressed DTI in Caution', {}, { stressedDti: 'Caution' }],
    ['surplus in Caution', {}, { surplus: 'Caution' }],
    ['LTV over 80%', { askingPriceEur: 320000 }, {}],
    ['price needs review', {}, { priceNeedsReview: true }],
    ['low model support', {}, { lowModelSupport: true }],
  ])('one concern (%s) is B', (_, app, findings) =>
    expect(riskTier({ ...base, ...app }, { ...clean, ...findings })).toBe('B'));

  test('price needs review and low model support together are one concern', () =>
    expect(riskTier(base, { ...clean, priceNeedsReview: true, lowModelSupport: true })).toBe('B'));

  test('two concerns is C', () =>
    expect(riskTier(base, { stressedDti: 'Caution', surplus: 'Caution' })).toBe('C'));

  test('four concerns is still C, not D', () =>
    expect(riskTier({ ...base, askingPriceEur: 320000 }, { stressedDti: 'Caution', surplus: 'Caution', priceNeedsReview: true })).toBe('C'));

  test.each([
    ['an Adverse stressed DTI', base, { ...clean, stressedDti: 'Adverse' }],
    ['an Adverse surplus', base, { ...clean, surplus: 'Adverse' }],
    ['LTV over 90%', { ...base, askingPriceEur: 295000 }, clean],
    ['a first-time buyer over 4x income', { ...base, loanAmountEur: 300001, askingPriceEur: 400000 }, clean],
    ['a second-time buyer over 3.5x income', { ...base, firstTimeBuyer: false, loanAmountEur: 262501, askingPriceEur: 400000 }, clean],
  ])('%s is D', (_, app, findings) => expect(riskTier(app, findings)).toBe('D'));

  test('exactly at the caps is not a breach', () => {
    expect(riskTier({ ...base, loanAmountEur: 300000, askingPriceEur: 400000 }, clean)).toBe('A');
    expect(riskTier({ ...base, firstTimeBuyer: false, loanAmountEur: 262500, askingPriceEur: 400000 }, clean)).toBe('A');
    expect(riskTier({ ...base, askingPriceEur: 300000 }, clean)).toBe('B'); // 90% exactly: a concern, not D
  });

  test('a HELOC uses the 3.5x cap', () =>
    expect(riskTier({ loanType: 'heloc', grossIncomeEur: 20000, loanAmountEur: 70001, existingMortgageBalanceEur: 0, askingPriceEur: 400000 }, clean)).toBe('D'));
});

describe('seed data', () => {
  const apps = build().filter((w) => /^applications\/[^/]+$/.test(w.path)).map((w) => w.data);

  test('has every status, LTV band and risk tier', () => expect(() => checkCoverage(build())).not.toThrow());

  test('the coverage check names what is missing', () =>
    expect(() => checkCoverage([])).toThrow(/status Draft.*LTV band 80_or_less.*risk tier A/));

  test('reviewed applications carry a band and tier; Draft and Applied have neither yet', () => {
    for (const a of apps) {
      const reviewed = !['Draft', 'Applied'].includes(a.status);
      expect([a.status, a.ltvBand !== undefined, a.riskTier !== undefined]).toEqual([a.status, reviewed, reviewed]);
    }
  });

  test('each band matches the application it is on', () => {
    for (const a of apps.filter((x) => x.ltvBand)) {
      expect(a.ltvBand).toBe(ltvBand(purchasePriceLtvPct({ ...a, askingPriceEur: a.property.askingPriceEur })));
    }
  });
});
