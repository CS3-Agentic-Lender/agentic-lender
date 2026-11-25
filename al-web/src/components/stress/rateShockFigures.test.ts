import { describe, expect, it } from 'vitest';
import { crossesDtiLimit, summariseShock, worstFirst } from './rateShockFigures';
import { bandCounts, shockFixture, shockedApplication } from './rateShockFixture';

describe('the rate shock summary', () => {
  it('works out the four tiles from the answer alone', () => {
    expect(summariseShock(shockFixture())).toEqual({
      count: 4,
      atStoredRate: 3,
      atCurrentRate: 1,
      crossedLimit: 1,
      movedIntoCaution: 1,
      movedIntoAdverse: 1,
      averageDtiChangePts: 6,
      surplusChangeEur: -1150,
    });
  });

  it('takes the count and the moves from the totals al-ai sent, not from the rows', () => {
    const result = shockFixture();
    result.totals = { ...result.totals, count: 7, movedIntoCaution: 3, movedIntoAdverse: 2 };

    expect(summariseShock(result)).toMatchObject({ count: 7, movedIntoCaution: 3, movedIntoAdverse: 2 });
  });

  it('reads an empty answer as no change', () => {
    const empty = {
      shockBps: 200,
      applications: [],
      totals: { count: 0, before: bandCounts(0, 0, 0), after: bandCounts(0, 0, 0), movedIntoCaution: 0, movedIntoAdverse: 0 },
      skipped: [],
    };

    expect(summariseShock(empty)).toMatchObject({ count: 0, crossedLimit: 0, averageDtiChangePts: 0, surplusChangeEur: 0 });
  });

  it('counts a crossing only from at most 40% to above it', () => {
    const at40 = shockedApplication(
      'LN-1',
      { band: 'Comfortable', dtiPct: 40, surplusEur: 900 },
      { band: 'Caution', dtiPct: 40.1, surplusEur: 800 },
    );
    const stays40 = shockedApplication(
      'LN-2',
      { band: 'Comfortable', dtiPct: 39, surplusEur: 900 },
      { band: 'Comfortable', dtiPct: 40, surplusEur: 800 },
    );
    const alreadyOver = shockedApplication(
      'LN-3',
      { band: 'Caution', dtiPct: 41, surplusEur: 900 },
      { band: 'Caution', dtiPct: 45, surplusEur: 800 },
    );

    expect([at40, stays40, alreadyOver].map(crossesDtiLimit)).toEqual([true, false, false]);
  });

  it('puts the worst band first, then the highest debt to income', () => {
    expect(worstFirst(shockFixture().applications).map((application) => application.applicationId)).toEqual([
      'LN-1004',
      'LN-1003',
      'LN-1002',
      'LN-1001',
    ]);
  });
});
