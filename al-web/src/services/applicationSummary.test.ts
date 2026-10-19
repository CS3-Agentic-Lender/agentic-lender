import { describe, expect, it } from 'vitest';
import { toApplicationSummary } from './clientsService';

describe('stored queue fields in the shared application mapping', () => {
  it.each(['80_or_less', '80_to_90', 'over_90'])('accepts the exact band %s', (ltvBand) => {
    expect(toApplicationSummary('application', { ltvBand }).ltvBand).toBe(ltvBand);
  });

  it.each(['A', 'B', 'C', 'D'])('accepts the exact tier %s', (riskTier) => {
    expect(toApplicationSummary('application', { riskTier }).riskTier).toBe(riskTier);
  });

  it.each([undefined, null, '', 'OVER_90', '>90%', '80_or_less ', 80, {}, ['over_90']])(
    'treats invalid or absent band %j as absent', (ltvBand) => {
      expect(toApplicationSummary('application', { ltvBand }).ltvBand).toBeNull();
    },
  );

  it.each([undefined, null, '', 'a', 'A ', 'Low', 'E', 1, {}, ['A']])(
    'treats invalid or absent tier %j as absent', (riskTier) => {
      expect(toApplicationSummary('application', { riskTier }).riskTier).toBeNull();
    },
  );
});
