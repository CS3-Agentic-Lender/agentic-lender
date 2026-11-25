import { AFFORDABILITY_BANDS, type RateShockResult, type ShockedApplication } from '../../services/stressService';

// The debt-to-income limits the committee's bands use (al-ai/app/affordability.py): up to 40% is
// Comfortable, up to 50% is Caution. The charts draw them as lines; nothing here re-bands an application.
export const DTI_COMFORTABLE_MAX_PCT = 40;
export const DTI_CAUTION_MAX_PCT = 50;

// An application crosses the limit when the rise takes it from at most 40% to above it.
export function crossesDtiLimit(application: ShockedApplication) {
  return application.before.dtiPct <= DTI_COMFORTABLE_MAX_PCT && application.after.dtiPct > DTI_COMFORTABLE_MAX_PCT;
}

// Worst first: Adverse before Caution before Comfortable after the shock, then the highest debt to income.
export function worstFirst(applications: ShockedApplication[]) {
  return [...applications].sort(
    (a, b) =>
      AFFORDABILITY_BANDS.indexOf(b.after.band) - AFFORDABILITY_BANDS.indexOf(a.after.band) ||
      b.after.dtiPct - a.after.dtiPct,
  );
}

export function surplusChangeEur(application: ShockedApplication) {
  return application.after.surplusEur - application.before.surplusEur;
}

export interface ShockSummary {
  count: number;
  atStoredRate: number;
  atCurrentRate: number;
  crossedLimit: number;
  movedIntoCaution: number;
  movedIntoAdverse: number;
  // Percentage points, the mean over the measured applications.
  averageDtiChangePts: number;
  // Euro a month, all measured applications added together.
  surplusChangeEur: number;
}

// The four summary tiles, read only from al-ai's answer: no repayment or band is worked out here.
export function summariseShock(result: RateShockResult): ShockSummary {
  const { applications, totals } = result;
  const atCurrentRate = applications.filter((application) => application.rateSource === 'current').length;
  const dtiChange = applications.reduce((sum, application) => sum + application.after.dtiPct - application.before.dtiPct, 0);

  return {
    count: totals.count,
    atStoredRate: applications.length - atCurrentRate,
    atCurrentRate,
    crossedLimit: applications.filter(crossesDtiLimit).length,
    movedIntoCaution: totals.movedIntoCaution,
    movedIntoAdverse: totals.movedIntoAdverse,
    averageDtiChangePts: applications.length === 0 ? 0 : dtiChange / applications.length,
    surplusChangeEur: applications.reduce((sum, application) => sum + surplusChangeEur(application), 0),
  };
}
