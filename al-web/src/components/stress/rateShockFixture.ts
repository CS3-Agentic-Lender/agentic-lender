import type { AffordabilityBand, BandCounts, RateShockResult, ShockedApplication } from '../../services/stressService';

// Test data only: a rate shock answer as stressService hands it to the page.

export function shockedApplication(
  applicationId: string,
  before: { band: AffordabilityBand; dtiPct: number; surplusEur: number },
  after: { band: AffordabilityBand; dtiPct: number; surplusEur: number },
  rateSource: ShockedApplication['rateSource'] = 'stored',
): ShockedApplication {
  return {
    applicationId,
    rateSource,
    benchmarkRatePct: 4,
    shockedRatePct: 6,
    before: { ...before, repaymentEur: 1432.25 },
    after: { ...after, repaymentEur: 1798.65 },
    movedInto: before.band === after.band ? null : (after.band as 'Caution' | 'Adverse'),
  };
}

export function bandCounts(comfortable: number, caution: number, adverse: number): BandCounts {
  const total = comfortable + caution + adverse;
  const share = (count: number) => (total ? Math.round((1000 * count) / total) / 10 : 0);
  return {
    Comfortable: { count: comfortable, sharePct: share(comfortable) },
    Caution: { count: caution, sharePct: share(caution) },
    Adverse: { count: adverse, sharePct: share(adverse) },
  };
}

// Four applications, listed best first on purpose so the page has to reorder them:
//   LN-1001 stays Comfortable (30 -> 34%), LN-1002 crosses 40% into Caution (38 -> 44%),
//   LN-1003 goes Caution -> Adverse at today's ECB rate (46 -> 53%), LN-1004 was already Adverse (54 -> 61%).
// DTI changes 4 + 6 + 7 + 7 = 24 points, so 6.0 on average; surplus changes -200 -300 -350 -300 = -1,150 a month.
export function shockFixture(shockBps = 200): RateShockResult {
  return {
    shockBps,
    applications: [
      shockedApplication(
        'LN-1001',
        { band: 'Comfortable', dtiPct: 30, surplusEur: 1500 },
        { band: 'Comfortable', dtiPct: 34, surplusEur: 1300 },
      ),
      shockedApplication(
        'LN-1002',
        { band: 'Comfortable', dtiPct: 38, surplusEur: 900 },
        { band: 'Caution', dtiPct: 44, surplusEur: 600 },
      ),
      shockedApplication(
        'LN-1003',
        { band: 'Caution', dtiPct: 46, surplusEur: 300 },
        { band: 'Adverse', dtiPct: 53, surplusEur: -50 },
        'current',
      ),
      shockedApplication(
        'LN-1004',
        { band: 'Adverse', dtiPct: 54, surplusEur: -100 },
        { band: 'Adverse', dtiPct: 61, surplusEur: -400 },
      ),
    ],
    totals: {
      count: 4,
      before: bandCounts(2, 1, 1),
      after: bandCounts(1, 1, 2),
      movedIntoCaution: 1,
      movedIntoAdverse: 1,
    },
    skipped: [{ applicationId: 'LN-1009', reason: 'a figure on the application is not a number' }],
  };
}
