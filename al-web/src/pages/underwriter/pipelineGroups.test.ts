import { describe, expect, it } from 'vitest';
import type { PipelineApplication, RiskTier } from '../../services/pipelineService';
import {
  ALL_STATUSES,
  filterByStatus,
  groupApplications,
  ltvBand,
  type PipelineGroup,
} from './pipelineGroups';

function application(
  id: string,
  status: string,
  ltvPct: number | null,
  riskTier: RiskTier | null,
): PipelineApplication {
  return {
    id,
    borrowerId: 'borrower-1',
    status,
    loanType: 'mortgage',
    loanAmountEur: 230000,
    ltvPct,
    riskTier,
    updatedAt: null,
  };
}

const sample = [
  application('LN-1001', 'Applied', 72, 'A'),
  application('LN-1002', 'Applied', 80, 'B'),
  application('LN-1003', 'AI Deliberated', 85.5, 'B'),
  application('LN-1004', 'Underwriter Approved', 90, 'A'),
  application('LN-1005', 'Declined', 94, 'D'),
  application('LN-1006', 'Draft', null, null),
  application('LN-1007', 'Funded', 78, null),
];

function counts(groups: PipelineGroup[]) {
  return groups.map((group) => [group.label, group.applications.length]);
}

describe('LTV bands', () => {
  it.each([
    [0, '<=80%'],
    [80, '<=80%'],
    [80.1, '>80% to 90%'],
    [90, '>80% to 90%'],
    [90.1, '>90%'],
    [120, '>90%'],
    [null, 'No LTV yet'],
  ] as const)('puts an LTV of %s in the %s band', (ltvPct, band) => {
    expect(ltvBand(ltvPct)).toBe(band);
  });
});

describe('grouping the pipeline', () => {
  it('groups by LTV band and counts each band', () => {
    expect(counts(groupApplications(sample, 'ltvBand'))).toEqual([
      ['<=80%', 3],
      ['>80% to 90%', 2],
      ['>90%', 1],
      ['No LTV yet', 1],
    ]);
  });

  it('groups by risk tier and counts each tier', () => {
    expect(counts(groupApplications(sample, 'riskTier'))).toEqual([
      ['Tier A', 2],
      ['Tier B', 2],
      ['Tier D', 1],
      ['No risk tier yet', 2],
    ]);
  });

  it('groups by status in lifecycle order and counts each status', () => {
    expect(counts(groupApplications(sample, 'status'))).toEqual([
      ['Draft', 1],
      ['Applied', 2],
      ['AI Deliberated', 1],
      ['Underwriter Approved', 1],
      ['Declined', 1],
      ['Funded', 1],
    ]);
  });

  it('puts every application in exactly one group, whichever category is chosen', () => {
    for (const groupBy of ['ltvBand', 'riskTier', 'status'] as const) {
      const ids = groupApplications(sample, groupBy).flatMap((group) => group.applications.map(({ id }) => id));

      expect(ids.sort()).toEqual(sample.map(({ id }) => id));
    }
  });

  it('keeps the applications inside a group in the order they were given', () => {
    const [, applied] = groupApplications(sample, 'status');

    expect(applied.applications.map(({ id }) => id)).toEqual(['LN-1001', 'LN-1002']);
  });

  it('does not derive a tier from the LTV when the tier is missing', () => {
    const groups = groupApplications([application('LN-1008', 'Applied', 95, null)], 'riskTier');

    expect(counts(groups)).toEqual([['No risk tier yet', 1]]);
  });

  it('makes one unavailable group when tier data cannot be read', () => {
    expect(counts(groupApplications(sample, 'riskTier', false))).toEqual([['Risk tier unavailable', 7]]);
  });

  it('keeps a status outside the agreed list in its own group instead of renaming it', () => {
    const groups = groupApplications(
      [application('LN-1009', 'Unknown', 70, null), application('LN-1010', 'Closed', 70, null)],
      'status',
    );

    expect(counts(groups)).toEqual([
      ['Closed', 1],
      ['Unrecognised status', 1],
    ]);
    expect(groups[1].applications[0].status).toBe('Unknown');
  });

  it('returns no groups for an empty list', () => {
    expect(groupApplications([], 'ltvBand')).toEqual([]);
  });
});

describe('filtering the pipeline by status', () => {
  it('returns every application when no status is chosen', () => {
    expect(filterByStatus(sample, ALL_STATUSES)).toHaveLength(7);
  });

  it('keeps only the chosen status, so the groups count the filtered list', () => {
    const applied = filterByStatus(sample, 'Applied');

    expect(applied.map(({ id }) => id)).toEqual(['LN-1001', 'LN-1002']);
    expect(counts(groupApplications(applied, 'ltvBand'))).toEqual([['<=80%', 2]]);
  });
});
