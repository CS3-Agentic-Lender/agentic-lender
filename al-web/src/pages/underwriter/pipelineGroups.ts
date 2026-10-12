import { APPLICATION_STATUSES } from '../../services/clientsService';
import {
  RISK_TIERS,
  type PipelineApplication,
  type RiskTierState,
} from '../../services/pipelineService';
import { isApplicationStatus } from '../../utils/statusTone';

export type GroupBy = 'ltvBand' | 'riskTier' | 'status';

export const GROUP_BY_OPTIONS: ReadonlyArray<{ value: GroupBy; label: string }> = [
  { value: 'ltvBand', label: 'LTV band' },
  { value: 'riskTier', label: 'Risk tier' },
  { value: 'status', label: 'Status' },
];

export const LTV_BANDS = ['<=80%', '>80% to 90%', '>90%'] as const;
export const NO_LTV = 'No LTV yet';
export const NO_RISK_TIER = 'No risk tier yet';
export const RISK_TIER_PENDING = 'Checking risk tiers';
export const RISK_TIER_UNAVAILABLE = 'Risk tier unavailable';
export const UNRECOGNISED_STATUS = 'Unrecognised status';
export const ALL_STATUSES = 'all';

export interface PipelineGroup {
  key: string;
  label: string;
  applications: PipelineApplication[];
}

// LTV is read as a whole-number percentage: 80 means 80%. Each upper bound belongs to its band.
// A value that is not a usable LTV (missing, not finite, negative) is not put in a band.
export function ltvBand(ltvPct: number | null) {
  if (ltvPct === null || !Number.isFinite(ltvPct) || ltvPct < 0) {
    return NO_LTV;
  }

  if (ltvPct <= 80) {
    return LTV_BANDS[0];
  }

  return ltvPct <= 90 ? LTV_BANDS[1] : LTV_BANDS[2];
}

export function filterByStatus(applications: readonly PipelineApplication[], status: string) {
  return status === ALL_STATUSES
    ? [...applications]
    : applications.filter((application) => application.status === status);
}

interface Grouping {
  // Every possible group, in the order the queue shows them.
  groups: ReadonlyArray<{ key: string; label: string }>;
  keyOf(application: PipelineApplication): string;
}

function groupingFor(groupBy: GroupBy, riskTierState: RiskTierState): Grouping {
  if (groupBy === 'ltvBand') {
    return {
      groups: [...LTV_BANDS, NO_LTV].map((band) => ({ key: band, label: band })),
      keyOf: (application) => ltvBand(application.ltvPct),
    };
  }

  if (groupBy === 'status') {
    return {
      groups: [...APPLICATION_STATUSES, UNRECOGNISED_STATUS].map((status) => ({ key: status, label: status })),
      keyOf: (application) =>
        isApplicationStatus(application.status) ? application.status : UNRECOGNISED_STATUS,
    };
  }

  // Until tier data has been read there is nothing to split on, and no tier is guessed.
  if (riskTierState !== 'available') {
    const label = riskTierState === 'pending' ? RISK_TIER_PENDING : RISK_TIER_UNAVAILABLE;

    return { groups: [{ key: label, label }], keyOf: () => label };
  }

  return {
    groups: [
      ...RISK_TIERS.map((tier) => ({ key: tier, label: `Tier ${tier}` })),
      { key: NO_RISK_TIER, label: NO_RISK_TIER },
    ],
    keyOf: (application) => application.riskTier ?? NO_RISK_TIER,
  };
}

// Groups keep a fixed order and the order of the applications given; empty groups are left out.
export function groupApplications(
  applications: readonly PipelineApplication[],
  groupBy: GroupBy,
  riskTierState: RiskTierState = 'available',
): PipelineGroup[] {
  const { groups, keyOf } = groupingFor(groupBy, riskTierState);
  const byKey = new Map<string, PipelineApplication[]>();

  for (const application of applications) {
    const key = keyOf(application);
    byKey.set(key, [...(byKey.get(key) ?? []), application]);
  }

  return groups.flatMap(({ key, label }) => {
    const members = byKey.get(key);
    return members ? [{ key, label, applications: members }] : [];
  });
}
