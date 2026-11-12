import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import {
  isDocumentId,
  loanFileRiskTier,
  readStressTest,
  toLoanFileApplication,
  toLoanFileReview,
} from './loanFileService';

const seeded = {
  borrowerId: 'borrower-1',
  borrowerName: 'Alice Byrne',
  brokerId: 'broker-1',
  status: 'AI Deliberated',
  loanType: 'mortgage',
  grossIncomeEur: 75000,
  monthlyDebtsEur: 300,
  loanAmountEur: 265000,
  termYears: 30,
  aprPct: 4,
  dtiPct: 33.4,
  ltvPct: 86.6,
  ltvBand: '80_to_90',
  riskTier: 'B',
  property: {
    county: 'Cork',
    propertyType: 'Semi-D',
    bedrooms: 3,
    floorAreaSqm: 98,
    berRating: 'C2',
    askingPriceEur: 310000,
  },
  createdAt: Timestamp.fromDate(new Date('2026-09-28T10:00:00Z')),
  submittedAt: Timestamp.fromDate(new Date('2026-09-29T09:00:00Z')),
  updatedAt: Timestamp.fromDate(new Date('2026-09-29T09:06:00Z')),
};

describe('loan file application parser', () => {
  it('reads the stored HELOC estimate without deriving it from other figures', () => {
    expect(toLoanFileApplication('heloc', { estimatedValueEur: 400000 }).estimatedValueEur).toBe(400000);
    expect(toLoanFileApplication('heloc', { estimatedValueEur: 0 }).estimatedValueEur).toBe(0);
  });
  it('reads every seeded field with its unit', () => {
    const application = toLoanFileApplication('LN-1001', seeded);

    expect(application).toMatchObject({
      id: 'LN-1001',
      borrowerId: 'borrower-1',
      borrowerName: 'Alice Byrne',
      brokerId: 'broker-1',
      status: 'AI Deliberated',
      loanType: 'mortgage',
      grossIncomeAnnualEur: 75000,
      monthlyDebtsEur: 300,
      loanAmountEur: 265000,
      termYears: 30,
      aprPct: 4,
      dtiPct: 33.4,
      ltvPct: 86.6,
      ltvBand: '80_to_90',
      riskTier: 'B',
      property: {
        county: 'Cork',
        propertyType: 'Semi-D',
        bedrooms: 3,
        floorAreaSqm: 98,
        berRating: 'C2',
        askingPriceEur: 310000,
        addressLine1: null,
        eircode: null,
      },
      submittedAt: new Date('2026-09-29T09:00:00Z'),
      updatedAt: new Date('2026-09-29T09:06:00Z'),
      decision: null,
    });
  });

  it('leaves every missing field null, never 0', () => {
    const application = toLoanFileApplication('LN-1002', { status: 'Draft' });

    expect(application).toMatchObject({
      borrowerId: null,
      borrowerName: null,
      grossIncomeAnnualEur: null,
      monthlyDebtsEur: null,
      monthlyTakeHomeEur: null,
      monthlyLivingCostsEur: null,
      loanAmountEur: null,
      estimatedValueEur: null,
      termYears: null,
      aprPct: null,
      dtiPct: null,
      ltvPct: null,
      applicants: null,
      decision: null,
      property: {
        county: null,
        bedrooms: null,
        floorAreaSqm: null,
        askingPriceEur: null,
      },
    });
  });

  it.each([
    ['a string', '75000'],
    ['a negative number', -1],
    ['not finite', Number.POSITIVE_INFINITY],
    ['not a number', Number.NaN],
    ['a map', { amount: 1 }],
  ])('treats a figure that is %s as unavailable', (_case, value) => {
    const application = toLoanFileApplication('LN-1003', {
      grossIncomeEur: value,
      monthlyDebtsEur: value,
      dtiPct: value,
      aprPct: value,
      loanAmountEur: value,
      estimatedValueEur: value,
      ltvPct: value,
      property: { bedrooms: value, askingPriceEur: value },
    });

    expect(application.grossIncomeAnnualEur).toBeNull();
    expect(application.monthlyDebtsEur).toBeNull();
    expect(application.dtiPct).toBeNull();
    expect(application.aprPct).toBeNull();
    expect(application.loanAmountEur).toBeNull();
    expect(application.estimatedValueEur).toBeNull();
    expect(application.ltvPct).toBeNull();
    expect(application.property.bedrooms).toBeNull();
    expect(application.property.askingPriceEur).toBeNull();
  });

  it('keeps a real zero, such as a studio with 0 bedrooms or no existing debts', () => {
    const application = toLoanFileApplication('LN-1004', { monthlyDebtsEur: 0, property: { bedrooms: 0 } });

    expect(application.monthlyDebtsEur).toBe(0);
    expect(application.property.bedrooms).toBe(0);
  });

  it('ignores a property that is not a map', () => {
    expect(toLoanFileApplication('LN-1005', { property: 'Cork' }).property.county).toBeNull();
    expect(toLoanFileApplication('LN-1005', { property: ['Cork'] }).property.county).toBeNull();
  });

  it('accepts only single or joint applicants', () => {
    expect(toLoanFileApplication('a', { applicants: 'joint' }).applicants).toBe('joint');
    expect(toLoanFileApplication('a', { applicants: 'Joint' }).applicants).toBeNull();
  });

  it('reads a decision and marks an unknown outcome invalid', () => {
    const decidedAt = Timestamp.fromDate(new Date('2026-10-01T12:00:00Z'));

    expect(toLoanFileApplication('a', { decision: { outcome: 'approved', decidedAt } }).decision).toEqual({
      outcome: 'approved',
      decidedAt: new Date('2026-10-01T12:00:00Z'),
    });
    expect(toLoanFileApplication('a', { decision: { outcome: 'maybe' } }).decision).toEqual({
      outcome: 'invalid',
      decidedAt: null,
    });
  });
});

describe('loan file review parser', () => {
  it('reads the effective policy recommendation and filters non-string list entries', () => {
    expect(toLoanFileReview({ policyGate: {
      original: 'Approve', effective: 'Conditionally Approve',
      conditions: ['Requires lender exception review (LTV)', null, 12],
      breaches: [false, 'LTV'], changed: true,
    } })).toMatchObject({ policyGate: {
      original: 'Approve', effective: 'Conditionally Approve',
      conditions: ['Requires lender exception review (LTV)'], breaches: ['LTV'],
    } });
  });

  it('treats unknown recommendations as null without falling back to the original', () => {
    expect(toLoanFileReview({ policyGate: { original: 'Approve', effective: 'approved' } })).toMatchObject({
      policyGate: { original: 'Approve', effective: null, conditions: [], breaches: [] },
    });
    expect(toLoanFileReview({ policyGate: { original: 'unknown', effective: 'Decline' } })).toMatchObject({
      policyGate: { original: null, effective: 'Decline' },
    });
  });

  it.each([undefined, null, [], 'Approve', 42])('treats a missing or malformed gate as null (%j)', (policyGate) => {
    expect(toLoanFileReview({ policyGate })).toMatchObject({ policyGate: null });
  });

  it('reads the monthly DTI breakdown and the review tier', () => {
    expect(
      toLoanFileReview({
        riskTier: 'C',
        dtiBreakdown: { incomeMonthlyEur: 6250, existingDebtsMonthlyEur: 300, newRepaymentMonthlyEur: 1265.13 },
      }),
    ).toMatchObject({
      state: 'available',
      riskTier: 'C',
      dtiBreakdown: { incomeMonthlyEur: 6250, existingDebtsMonthlyEur: 300, newRepaymentMonthlyEur: 1265.13 },
    });
  });

  it('leaves a missing or invalid breakdown figure null', () => {
    expect(toLoanFileReview({ riskTier: 'E', dtiBreakdown: { incomeMonthlyEur: '6250' } })).toMatchObject({
      riskTier: null,
      dtiBreakdown: { incomeMonthlyEur: null, existingDebtsMonthlyEur: null, newRepaymentMonthlyEur: null },
    });
  });

  it('reads take-home pay and living costs from the breakdown', () => {
    expect(
      toLoanFileReview({ dtiBreakdown: { takeHomeMonthlyEur: 4900, livingCostsMonthlyEur: 1800 } }),
    ).toMatchObject({ dtiBreakdown: { takeHomeMonthlyEur: 4900, livingCostsMonthlyEur: 1800 } });
  });

  it('has no stressed figures while none are stored', () => {
    expect(readStressTest({})).toEqual({
      stressMarginPct: null,
      benchmarkRatePct: null,
      stressedRatePct: null,
      rateDate: null,
      stressedRepaymentMonthlyEur: null,
      stressedDtiPct: null,
      surplusMonthlyEur: null,
      stressedSurplusMonthlyEur: null,
      dtiBand: null,
      surplusBand: null,
    });
  });

  // The shape al-core seeds for app-funded (SCHEMA.md, dtiBreakdown): every figure flat in one map.
  it('reads the stressed figures flat from the DTI breakdown', () => {
    expect(
      readStressTest({
        dtiBreakdown: {
          incomeMonthlyEur: 7333.33,
          newRepaymentMonthlyEur: 1384.5,
          stressedRepaymentMonthlyEur: 1738.7,
          benchmarkRatePct: 4,
          stressMarginPct: 2,
          stressedRatePct: 6,
          rateDate: '2026-09',
          dtiPct: 21.61,
          stressedDtiPct: 26.44,
          surplusMonthlyEur: 1515.5,
          stressedSurplusMonthlyEur: 1161.3,
          dtiBand: 'Comfortable',
          surplusBand: 'Comfortable',
        },
      }),
    ).toEqual({
      stressMarginPct: 2,
      benchmarkRatePct: 4,
      stressedRatePct: 6,
      rateDate: '2026-09',
      stressedRepaymentMonthlyEur: 1738.7,
      stressedDtiPct: 26.44,
      surplusMonthlyEur: 1515.5,
      stressedSurplusMonthlyEur: 1161.3,
      dtiBand: 'Comfortable',
      surplusBand: 'Comfortable',
    });
  });

  it('keeps a negative surplus and rejects unknown bands and malformed months', () => {
    expect(
      readStressTest({
        dtiBreakdown: { stressedSurplusMonthlyEur: -120, dtiBand: 'Pass', surplusBand: 'Adverse', rateDate: '2026-13' },
      }),
    ).toMatchObject({ stressedSurplusMonthlyEur: -120, dtiBand: null, surplusBand: 'Adverse', rateDate: null });
  });

  it('ignores the old nested stressTest map', () => {
    expect(readStressTest({ stressTest: { stressedDtiPct: 38.1, stressMarginPct: 3 } })).toMatchObject({
      stressedDtiPct: null,
      stressMarginPct: null,
    });
  });
});

describe('valuation detail parser', () => {
  const detail = {
    baselineEur: 250000,
    contributions: [
      { feature: 'ber', value: 'C2', eur: -1300 },
      { feature: 'county', value: 'Cork', eur: 18500 },
      { feature: 'property_type', value: 'Semi-D', eur: -4600 },
      { feature: 'floor_area', value: 98, eur: 31200 },
      { feature: 'bedrooms', value: 3, eur: 9800 },
      { feature: 'eircode_area', value: 'T12', eur: 6400 },
    ],
    estimatedValueEur: 310000,
    supportWarnings: ['Few comparable homes.', 'The Eircode area was not seen during training.'],
  };

  it('keeps signed effects and sorts by magnitude', () => {
    expect(toLoanFileReview({ valuationDetail: detail })).toMatchObject({
      valuation: {
        state: 'available',
        estimatedValueEur: 310000,
        supportWarnings: detail.supportWarnings,
        breakdown: {
          state: 'available',
          baselineEur: 250000,
          contributions: [
            { feature: 'floor_area', value: 98, eur: 31200 },
            { feature: 'county', value: 'Cork', eur: 18500 },
            { feature: 'bedrooms', value: 3, eur: 9800 },
            { feature: 'eircode_area', value: 'T12', eur: 6400 },
            { feature: 'property_type', value: 'Semi-D', eur: -4600 },
            { feature: 'ber', value: 'C2', eur: -1300 },
          ],
          discrepancyEur: 0,
        },
      },
    });
  });

  it('keeps unknown keys, zero effects and stored order for tied magnitudes', () => {
    expect(toLoanFileReview({ valuationDetail: {
      baselineEur: 0,
      contributions: [
        { feature: 'unknown_feature', value: 'stored input', eur: -20 },
        { feature: 'county', value: 'Cork', eur: 20 },
        { feature: 'ber', value: null, eur: 0 },
      ],
      estimatedValueEur: 0,
    } })).toMatchObject({ valuation: {
      state: 'available',
      breakdown: {
        state: 'available',
        contributions: [
          { feature: 'unknown_feature', value: 'stored input', eur: -20 },
          { feature: 'county', value: 'Cork', eur: 20 },
          { feature: 'ber', value: null, eur: 0 },
        ],
        discrepancyEur: 0,
      },
    } });
  });

  it.each([undefined, null, [], 'missing', {}])('marks a missing or unusable map as missing (%j)', (valuationDetail) => {
    expect(toLoanFileReview({ valuationDetail })).toMatchObject({ valuation: { state: 'missing' } });
  });

  it.each([undefined, null, '250000', Number.NaN, Number.POSITIVE_INFINITY])(
    'requires a finite numeric baseline (%s)',
    (baselineEur) => {
      expect(toLoanFileReview({ valuationDetail: { ...detail, baselineEur } })).toMatchObject({
        valuation: { state: 'available', estimatedValueEur: 310000, supportWarnings: detail.supportWarnings, breakdown: { state: 'unavailable' } },
      });
    },
  );

  it.each([undefined, null, {}, [], 'county', { county: 18500 }])('requires a nonempty contributions list, rejecting the old map shape (%j)', (contributions) => {
    expect(toLoanFileReview({ valuationDetail: { ...detail, contributions } })).toMatchObject({
      valuation: { state: 'available', estimatedValueEur: 310000, supportWarnings: detail.supportWarnings, breakdown: { state: 'unavailable' } },
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '10', null, {}])(
    'rejects the whole breakdown when one contribution is unusable (%s)',
    (eur) => {
      expect(toLoanFileReview({ valuationDetail: { ...detail, contributions: [...detail.contributions, { feature: 'unknown', eur }] } })).toMatchObject({
        valuation: { state: 'available', estimatedValueEur: 310000, supportWarnings: detail.supportWarnings, breakdown: { state: 'unavailable' } },
      });
    },
  );

  it.each([undefined, null, '', '  ', 12])('rejects a missing or unusable feature (%j)', (feature) => {
    expect(toLoanFileReview({ valuationDetail: { ...detail, contributions: [...detail.contributions, { feature, eur: 1 }] } })).toMatchObject({
      valuation: { state: 'available', estimatedValueEur: 310000, supportWarnings: detail.supportWarnings, breakdown: { state: 'unavailable' } },
    });
  });

  it.each([null, [], 'county', 12])('rejects a malformed contribution item (%j)', (piece) => {
    expect(toLoanFileReview({ valuationDetail: { ...detail, contributions: [piece] } })).toMatchObject({
      valuation: { state: 'available', breakdown: { state: 'unavailable' } },
    });
  });

  it.each([undefined, null, {}, [], true, Number.NaN, Number.POSITIVE_INFINITY])('hides an unusable input value without discarding its effect (%j)', (value) => {
    expect(toLoanFileReview({ valuationDetail: { baselineEur: 100, estimatedValueEur: 120, contributions: [{ feature: 'county', value, eur: 20 }] } })).toMatchObject({
      valuation: { state: 'available', breakdown: { state: 'available', contributions: [{ feature: 'county', value: null, eur: 20 }], discrepancyEur: 0 } },
    });
  });

  it('keeps the estimate and warnings when both breakdown fields are null', () => {
    expect(toLoanFileReview({ valuationDetail: { ...detail, baselineEur: null, contributions: null } })).toMatchObject({
      valuation: { state: 'available', estimatedValueEur: 310000, supportWarnings: detail.supportWarnings, breakdown: { state: 'unavailable' } },
    });
  });

  it('keeps warnings alone, preserving their words and order while skipping unusable entries', () => {
    const supportWarnings = [' Few comparable homes. ', null, '', 42, '  ', {}, 'Unseen Eircode area.'];
    expect(toLoanFileReview({ valuationDetail: { supportWarnings } })).toMatchObject({
      valuation: { state: 'available', estimatedValueEur: null, supportWarnings: [' Few comparable homes. ', 'Unseen Eircode area.'], breakdown: { state: 'unavailable' } },
    });
  });

  it.each([undefined, null, [], 'A warning', {}, [null, '', '  ', 42]])('ignores unusable warnings (%j)', (supportWarnings) => {
    expect(toLoanFileReview({ valuationDetail: { ...detail, supportWarnings } })).toMatchObject({
      valuation: { state: 'available', supportWarnings: [] },
    });
    expect(toLoanFileReview({ valuationDetail: { supportWarnings } })).toMatchObject({ valuation: { state: 'missing' } });
  });

  it('reports the discrepancy without changing the stored estimate or contributions', () => {
    expect(toLoanFileReview({ valuationDetail: { ...detail, estimatedValueEur: 310500 } })).toMatchObject({
      valuation: { state: 'available', estimatedValueEur: 310500, breakdown: { baselineEur: 250000, discrepancyEur: 500, contributions: [...detail.contributions].sort((a, b) => Math.abs(b.eur) - Math.abs(a.eur)) } },
    });
  });

  it.each([undefined, null, '303600', Number.NaN, Number.POSITIVE_INFINITY])(
    'leaves the estimate and discrepancy null when the estimate is unusable (%s)',
    (estimatedValueEur) => {
      expect(toLoanFileReview({ valuationDetail: { ...detail, estimatedValueEur } })).toMatchObject({
        valuation: { state: 'available', estimatedValueEur: null, breakdown: { state: 'available', discrepancyEur: null } },
      });
    },
  );

  it('reads the collateral fields, keeping a negative gap, even when the breakdown is unavailable', () => {
    expect(toLoanFileReview({
      valuationDetail: {
        estimatedValueEur: 343968.2,
        displayEstimateEur: 344000,
        askingPriceGap: -0.0525,
        priceNeedsReview: false,
        modelVersion: 'v2',
        baselineEur: null,
        contributions: null,
      },
    })).toMatchObject({
      valuation: {
        state: 'available',
        displayEstimateEur: 344000,
        askingPriceGap: -0.0525,
        priceNeedsReview: false,
        modelVersion: 'v2',
        breakdown: { state: 'unavailable' },
      },
    });
  });

  it('leaves unusable collateral fields null, as a HELOC stores them', () => {
    expect(toLoanFileReview({
      valuationDetail: {
        ...detail,
        displayEstimateEur: 344000.5,
        askingPriceGap: null,
        priceNeedsReview: 'yes',
        modelVersion: '  ',
      },
    })).toMatchObject({
      valuation: { displayEstimateEur: null, askingPriceGap: null, priceNeedsReview: null, modelVersion: null },
    });
  });

  it('reads the purchase-price LTV from the application', () => {
    expect(toLoanFileApplication('a', { purchaseLtvPct: 79.5 }).purchaseLtvPct).toBe(79.5);
    expect(toLoanFileApplication('a', { purchaseLtvPct: -1 }).purchaseLtvPct).toBeNull();
    expect(toLoanFileApplication('a', {}).purchaseLtvPct).toBeNull();
  });
});

describe('loan file risk tier', () => {
  const review = toLoanFileReview({ riskTier: 'A' });

  it('prefers a stored tier, even an invalid one, over the review', () => {
    expect(loanFileRiskTier(toLoanFileApplication('a', { riskTier: 'D' }), review)).toBe('D');
    expect(loanFileRiskTier(toLoanFileApplication('a', { riskTier: 'Z' }), review)).toBe('invalid');
  });

  it('uses the review tier only when no tier is stored', () => {
    expect(loanFileRiskTier(toLoanFileApplication('a', {}), review)).toBe('A');
    expect(loanFileRiskTier(toLoanFileApplication('a', {}), { state: 'pending' })).toBeNull();
  });
});

describe('document ID check', () => {
  it.each(['LN-1001', 'app-deliberated', 'a.b'])('accepts %s', (value) => {
    expect(isDocumentId(value)).toBe(true);
  });

  it.each([undefined, '', '.', '..', 'a/review/underwriting', '__name__'])('rejects %j', (value) => {
    expect(isDocumentId(value)).toBe(false);
  });
});
