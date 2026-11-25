import { COMMITTEE_STEPS, type CommitteeRun, type CommitteeStep, type StepStatus } from '../../services/committeeService';
import type { SceneAgent } from './council/councilScene';

export type CommitteeTab = SceneAgent | 'memo' | 'gate';
export type TabState = 'queued' | 'thinking' | 'done' | 'failed';
export interface TabProgress {
  state: TabState;
  startedAt: Date | null;
  reason: string | null;
}
export interface LiveProgress {
  done: number;
  total: number;
  working: CommitteeStep[];
}
export interface RunProgress {
  // Only while the run goes.
  live: LiveProgress | null;
  // The tabs whose step has something to show: every tab while the run goes, the failed step's on a failed run.
  tabs: Partial<Record<CommitteeTab, TabProgress>>;
}

// The step each tab waits on. The credit memo is the strategist's report.
const STEP_OF_TAB: Record<CommitteeTab, CommitteeStep> = {
  affordability: 'affordability', valuation: 'valuation_agent', strategist: 'strategist', market: 'market',
  memo: 'strategist', gate: 'policy_gate',
};

const STATE_OF: Record<StepStatus, TabState> = { queued: 'queued', running: 'thinking', ok: 'done', failed: 'failed' };

export const STEP_LABELS: Record<CommitteeStep, string> = {
  validate: 'Checking the application', valuation_model: 'Valuation model', market: 'Market & Macro',
  calculations: 'Calculations', affordability: 'Affordability', valuation_agent: 'Valuation', strategist: 'Strategist',
  policy_gate: 'Policy gate',
};

const tabs = Object.keys(STEP_OF_TAB) as CommitteeTab[];

export function runProgress(run: CommitteeRun): RunProgress {
  const { steps } = run;
  if (run.status === 'running' && steps) {
    return {
      live: {
        done: COMMITTEE_STEPS.filter((step) => steps[step].status === 'ok').length,
        total: COMMITTEE_STEPS.length,
        working: COMMITTEE_STEPS.filter((step) => steps[step].status === 'running'),
      },
      tabs: Object.fromEntries(tabs.map((tab) => {
        const step = steps[STEP_OF_TAB[tab]];
        return [tab, { state: STATE_OF[step.status], startedAt: step.startedAt, reason: step.failureReason }];
      })),
    };
  }
  // SCHEMA.md: once the run is not running it is read from its own fields, so a failed run marks its failedStep.
  if (run.status === 'failed') {
    return {
      live: null,
      tabs: Object.fromEntries(tabs.filter((tab) => STEP_OF_TAB[tab] === run.failedStep)
        .map((tab) => [tab, { state: 'failed', startedAt: null, reason: run.failureReason }])),
    };
  }
  return { live: null, tabs: {} };
}
