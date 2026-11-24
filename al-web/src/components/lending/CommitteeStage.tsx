import { useEffect, useMemo, useRef, useState } from 'react';
import { runDuration, type CommitteeRun } from '../../services/committeeService';
import { agentLabels } from './AgentVote';
import { canDraw3d, startWhenNearAndIdle } from './council/canDraw3d';
import type { CouncilData, CouncilHandle, SceneAgent } from './council/councilScene';

interface CommitteeStageProps {
  run: CommitteeRun;
  selected: SceneAgent | null;
  onPick(agent: SceneAgent): void;
}

// The committee as a 3D council over the stored run. Three.js is loaded only when the stage is close to the
// screen and the browser is idle, so the rest of the loan file does not pay for it. The stage keeps its size from
// the start, so nothing around it moves when the scene appears.
export function CommitteeStage({ run, selected, onPick }: CommitteeStageProps) {
  const [supported] = useState(canDraw3d);
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CouncilHandle | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const { votes } = run.consensus;
  const data = useMemo<CouncilData>(() => ({
    votes: { affordability: votes.affordability, valuation: votes.valuation, strategist: votes.strategist },
    effective: run.effectiveRecommendation,
    running: run.status === 'running',
    names: agentLabels,
  }), [votes.affordability, votes.valuation, votes.strategist, run.effectiveRecommendation, run.status]);

  useEffect(() => {
    const host = hostRef.current;
    if (!supported || !host) return;
    let cancelled = false;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const cancelStart = startWhenNearAndIdle(host, () => {
      import('./council/councilScene')
        .then(({ createCouncilScene }) => {
          if (cancelled) return;
          handleRef.current = createCouncilScene(host, data, { onPick: (agent) => pickRef.current(agent), reduceMotion, onContextLost: () => setFailed(true) });
          handleRef.current.focus(selectedRef.current);
        })
        .catch(() => { if (!cancelled) setFailed(true); });
    });
    return () => {
      cancelled = true;
      cancelStart();
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [supported, data]);

  useEffect(() => { handleRef.current?.focus(selected); }, [selected]);

  if (!supported || failed) return null;

  const effective = run.effectiveRecommendation;
  const matching = Object.values(votes).filter((vote) => vote !== null && vote === effective).length;
  const gate = run.policyGate;
  const facts = [
    effective ? `${matching} of 3 votes match it` : null,
    gate === null ? null : gate.changed ? 'policy gate changed it' : gate.changed === false ? 'policy gate left it as is' : null,
    runDuration(run) ? `ran ${runDuration(run)}` : null,
    run.trigger === 'rerun' ? 're-run' : null,
  ].filter(Boolean);

  return (
    <div
      aria-hidden="true"
      className="council-stage relative h-[460px] overflow-hidden rounded-xl bg-night sm:h-[500px]"
    >
      <div className="absolute inset-0" ref={hostRef} />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(110%_85%_at_50%_38%,color-mix(in_srgb,var(--color-vote-approve)_14%,transparent)_0%,transparent_45%,rgb(0_0_0/0.45)_100%)]" />
      <div className="pointer-events-none absolute bottom-4 left-5 z-[2]">
        <p className="font-mono text-xs font-medium tracking-[0.14em] text-tint/70 uppercase">
          AI committee · {run.status === 'running' ? 'running' : run.status === 'failed' ? 'run failed' : 'run complete'}
        </p>
        <p className="mt-0.5 text-3xl font-semibold tracking-tight text-brass-light [text-shadow:0_0_24px_color-mix(in_srgb,var(--color-brass)_40%,transparent)]">
          {effective ?? 'Not stored yet'}
        </p>
        {facts.length > 0 ? <p className="mt-1 text-[15px] text-tint/80">{facts.join(' · ')}</p> : null}
      </div>
      <p className="pointer-events-none absolute right-4 bottom-4 z-[2] rounded-lg bg-night/70 px-3 py-1 text-[15px] text-tint/80 max-sm:hidden">
        Drag to turn it · click an agent to see what it said
      </p>
    </div>
  );
}
