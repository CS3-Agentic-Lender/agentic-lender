import { describe, expect, it } from 'vitest';
import type { BrokerApplication } from './clientsService';
import { readRiskTier, withRiskTiers, type RiskTier } from './pipelineService';

function application(id: string, updatedAt: Date | null = null): BrokerApplication {
  return {
    id,
    borrowerId: 'borrower-1',
    status: 'Applied',
    loanType: null,
    loanAmountEur: null,
    ltvPct: null,
    updatedAt,
  };
}

describe('reading a risk tier', () => {
  it.each(['A', 'B', 'C', 'D'] as const)('accepts tier %s', (tier) => {
    expect(readRiskTier(tier)).toBe(tier);
  });

  it.each([['Low'], ['Medium'], ['High'], ['a'], ['E'], [''], [1], [null], [undefined]])(
    'does not turn %j into a tier',
    (value) => {
      expect(readRiskTier(value)).toBeNull();
    },
  );
});

describe('attaching risk tiers to applications', () => {
  it('gives each application its own tier and leaves the rest without one', () => {
    const tiers = new Map<string, RiskTier>([
      ['LN-1001', 'B'],
      ['LN-9999', 'D'],
    ]);

    const result = withRiskTiers([application('LN-1001'), application('LN-1002')], tiers);

    expect(result.map(({ id, riskTier }) => [id, riskTier])).toEqual([
      ['LN-1001', 'B'],
      ['LN-1002', null],
    ]);
  });

  it('lists the most recently updated application first', () => {
    const result = withRiskTiers(
      [application('LN-1001', new Date('2026-10-01')), application('LN-1002', new Date('2026-10-05'))],
      new Map(),
    );

    expect(result.map(({ id }) => id)).toEqual(['LN-1002', 'LN-1001']);
  });
});
