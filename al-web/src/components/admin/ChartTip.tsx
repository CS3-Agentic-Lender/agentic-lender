import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';

// What a chart's mark explains about itself: the exact figure, its share of the whole, and what it counts.
export interface Tip {
  value: string;
  share?: string;
  counts: string;
}

export type TipAlign = 'start' | 'center' | 'end';

const alignClass: Record<TipAlign, string> = {
  start: 'left-0',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0',
};

// One tooltip open per chart at a time: the mark under a mouse, the focused mark, or the mark a first tap armed.
// On touch there is no hover, so the first tap on a link shows its tooltip and the second follows the link.
export function useChartTips() {
  const base = useId();
  const [active, setActive] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const pointer = useRef<string>('mouse');

  // A tap anywhere but the open tooltip's own mark closes it: on touch the mark is not always focused, so its blur
  // would never come.
  useEffect(() => {
    if (active === null) return;
    const open = `${base}-tip-${active}`;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(`[aria-describedby="${open}"]`)) return;
      setActive(null);
      setArmed(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [active, base]);

  return (index: number, linked: boolean) => {
    const id = `${base}-tip-${index}`;
    const close = () => {
      setActive((current) => (current === index ? null : current));
      setArmed((current) => (current === index ? null : current));
    };

    return {
      tip: { id, shown: active === index, armed: linked && armed === index },
      trigger: {
        'aria-describedby': id,
        onPointerDown: (event: PointerEvent) => {
          pointer.current = event.pointerType;
        },
        onPointerEnter: (event: PointerEvent) => {
          if (event.pointerType === 'mouse') setActive(index);
        },
        onPointerLeave: (event: PointerEvent) => {
          if (event.pointerType === 'mouse') close();
        },
        onFocus: () => setActive(index),
        onBlur: close,
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key === 'Escape') close();
        },
        onClick: (event: MouseEvent) => {
          const touch = pointer.current === 'touch';
          pointer.current = 'mouse';
          if (touch && armed !== index) {
            event.preventDefault();
            setActive(index);
            setArmed(index);
          }
        },
      },
    };
  };
}

// The tooltip itself, placed over its mark so showing it never moves the layout.
export function ChartTip({
  id,
  shown,
  armed,
  tip,
  align = 'start',
}: {
  id: string;
  shown: boolean;
  armed: boolean;
  tip: Tip;
  align?: TipAlign;
}) {
  return (
    <span
      className={`absolute bottom-full z-20 mb-2 block w-max max-w-60 rounded-lg bg-ink px-3 py-2 text-left text-sm leading-snug font-normal text-surface shadow-raised ${alignClass[align]}`}
      hidden={!shown}
      id={id}
      role="tooltip"
    >
      <span className="block font-semibold tabular-nums">{tip.value}.</span>{' '}
      {tip.share ? <span className="block tabular-nums">{tip.share}.</span> : null}{' '}
      <span className="block text-tint">{tip.counts}</span>
      {armed ? <span className="mt-1 block font-semibold"> Tap again to open the list.</span> : null}
    </span>
  );
}
