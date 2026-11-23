interface StatusTimelineProps {
  status: string;
}

type StageState = 'done' | 'current' | 'next' | 'stopped' | 'skipped';

// What each stored status says about the four stages of a loan. A stage is done once the
// status it produces has been reached; the stage after that is the one in hand.
const STAGES = ['Application', 'AI committee', 'Underwriter decision', 'Funding'];

const stagesDone: Record<string, number> = {
  Draft: 0,
  Applied: 1,
  'AI Deliberated': 2,
  'Underwriter Approved': 3,
  Funded: 4,
  Closed: 4,
};

const captions: Record<StageState, string> = {
  done: 'Done',
  current: 'In hand',
  next: 'Next',
  stopped: 'Stopped here',
  skipped: 'Not reached',
};

function stageStates(status: string): StageState[] | null {
  if (status === 'Declined') {
    // A decline is the underwriter's decision, so the file stops at that stage.
    return ['done', 'done', 'stopped', 'skipped'];
  }

  const done = stagesDone[status];

  if (done === undefined) {
    return null;
  }

  return STAGES.map((_, index) => (index < done ? 'done' : index === done ? 'current' : 'next'));
}

const markerClasses: Record<StageState, string> = {
  done: 'border-pine bg-pine text-surface',
  current: 'border-pine bg-surface text-pine ring-4 ring-tint',
  next: 'border-line bg-surface text-muted',
  stopped: 'border-error bg-danger-soft text-error',
  skipped: 'border-line bg-surface text-muted',
};

function Marker({ state }: { state: StageState }) {
  return (
    <span
      aria-hidden="true"
      className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 ${markerClasses[state]}`}
    >
      {state === 'done' ? (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 14 14">
          <path d="M3 7.4 5.8 10 11 4.4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        </svg>
      ) : state === 'stopped' ? (
        <svg className="h-3 w-3" fill="none" viewBox="0 0 12 12">
          <path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      ) : state === 'current' ? (
        <span className="h-2.5 w-2.5 rounded-full bg-pine" />
      ) : null}
    </span>
  );
}

// Where the application is in its life, read from the stored status alone. A status outside
// the agreed list draws nothing: the badge still writes it out.
export function StatusTimeline({ status }: StatusTimelineProps) {
  const states = stageStates(status);

  if (states === null) {
    return null;
  }

  return (
    <ol aria-label="Application progress" className="flex flex-col sm:flex-row">
      {STAGES.map((stage, index) => {
        const state = states[index];
        const reachedNext = index < STAGES.length - 1 && states[index + 1] !== 'next' && states[index + 1] !== 'skipped';

        return (
          <li
            aria-current={state === 'current' ? 'step' : undefined}
            className="relative flex gap-3 pb-5 last:pb-0 sm:block sm:flex-1 sm:pb-0 sm:last:flex-none"
            key={stage}
          >
            {index < STAGES.length - 1 ? (
              <span
                aria-hidden="true"
                className={`absolute top-7 bottom-0 left-[13px] w-0.5 sm:top-[13px] sm:right-0 sm:bottom-auto sm:left-7 sm:h-0.5 sm:w-auto ${reachedNext ? 'bg-pine' : 'bg-line'}`}
              />
            ) : null}
            <Marker state={state} />
            <div className="sm:mt-3 sm:pr-6">
              <p className="font-semibold leading-6">{stage}</p>
              <p className={`text-sm ${state === 'stopped' ? 'font-medium text-error' : 'text-muted'}`}>
                {captions[state]}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
