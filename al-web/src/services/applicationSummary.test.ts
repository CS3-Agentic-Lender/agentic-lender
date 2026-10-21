import { describe, expect, it } from 'vitest';
import { toApplicationSummary } from './clientsService';

describe('stored queue fields in the shared application mapping', () => {
  it.each([undefined, null])('keeps absent fields %j eligible for fallback', (value) => {
    expect(toApplicationSummary('application', { ltvBand: value, riskTier: value })).toMatchObject({
      ltvBand: null, riskTier: null,
    });
  });

  it.each(['80_or_less', '80_to_90', 'over_90'])('accepts the exact band %s', (ltvBand) => {
    expect(toApplicationSummary('application', { ltvBand }).ltvBand).toBe(ltvBand);
  });

  it.each(['A', 'B', 'C', 'D'])('accepts the exact tier %s', (riskTier) => {
    expect(toApplicationSummary('application', { riskTier }).riskTier).toBe(riskTier);
  });

  it.each(['', 'OVER_90', '>90%', '80_or_less ', 80, {}, ['over_90']])(
    'keeps invalid stored band %j distinct from absent', (ltvBand) => {
      expect(toApplicationSummary('application', { ltvBand }).ltvBand).toBe('invalid');
    },
  );

  it.each(['', 'a', 'A ', 'Low', 'E', 1, {}, ['A']])(
    'keeps invalid stored tier %j distinct from absent', (riskTier) => {
      expect(toApplicationSummary('application', { riskTier }).riskTier).toBe('invalid');
    },
  );
});
