import { useEffect, useRef, useState } from 'react';
import { canDraw3d } from './council/canDraw3d';
import type { ChainHandle } from './council/chainScene';

interface ChainStageProps {
  tokenId: string;
  auditHashShort: string;
  networkLabel: string;
}

// The loan note's place on the blockchain as a 3D illustration. Three.js loads only when the card is close
// to the screen. Without WebGL the stage is left out; the card's text carries the same facts.
export function ChainStage({ tokenId, auditHashShort, networkLabel }: ChainStageProps) {
  const [supported] = useState(canDraw3d);
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!supported || !host) return;
    let cancelled = false;
    let handle: ChainHandle | null = null;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const near = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      near.disconnect();
      import('./council/chainScene')
        .then(({ createChainScene }) => {
          if (!cancelled) handle = createChainScene(host, { tokenId, auditHashShort }, { reduceMotion });
        })
        .catch(() => { if (!cancelled) setFailed(true); });
    }, { rootMargin: '200px' });
    near.observe(host);
    return () => {
      cancelled = true;
      near.disconnect();
      handle?.dispose();
    };
  }, [supported, tokenId, auditHashShort]);

  if (!supported || failed) return null;

  return (
    <div aria-hidden="true" className="council-stage relative h-80 overflow-hidden rounded-xl bg-night sm:h-96">
      <div className="absolute inset-0" ref={hostRef} />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(110%_85%_at_50%_40%,color-mix(in_srgb,var(--color-brass)_10%,transparent)_0%,transparent_45%,rgb(0_0_0/0.45)_100%)]" />
      <div className="pointer-events-none absolute bottom-4 left-5 z-[2]">
        <p className="font-mono text-xs font-medium tracking-[0.14em] text-tint/70 uppercase">On the blockchain · {networkLabel}</p>
        <p className="mt-0.5 text-2xl font-semibold tracking-tight text-brass-light">Loan note #{tokenId}</p>
        <p className="mt-1 text-[15px] text-tint/80">Illustration: the two bright blocks are this loan’s records</p>
      </div>
      <p className="pointer-events-none absolute right-4 bottom-4 z-[2] rounded-lg bg-night/70 px-3 py-1 text-[15px] text-tint/80 max-sm:hidden">
        Drag to turn it
      </p>
    </div>
  );
}
