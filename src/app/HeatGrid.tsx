import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import type { Grid } from '../core/grid';
import type { Tally } from '../core/best';
import type { Marks } from '../core/types';
import { GridFrame, slotLabel } from './GridFrame';
import { glow } from './glow';

// Everyone's answers as lit panes: a slot glows warmer the more people are free (if needed counts as
// half), and a slot where everyone counted is free glows brightest. Hover or tap a pane to see who.
// The nights stay pinned under the tabs as the page scrolls past a tall grid. A grid too wide for the
// screen scrolls sideways inside its own frame instead, so it holds the nights and times there.

export function heatLevel(t: Tally | undefined, total: number): number {
  if (!t || total === 0) return 0;
  return (t.yes.length + t.maybe.length * 0.5) / total;
}

export function HeatGrid({
  grid,
  tallies,
  total,
  selected,
  onSelect,
  onHover,
  outline,
}: {
  grid: Grid;
  tallies: Map<string, Tally>;
  total: number;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onHover: (key: string | null) => void;
  /** One person's answers to trace over the panes. */
  outline?: Marks;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWide((el.firstElementChild?.scrollWidth ?? 0) > el.clientWidth + 1);
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    return () => seen.disconnect();
  }, [grid]);
  return (
    <div ref={wrap} className="heat-wrap" data-wide={wide || undefined} onPointerLeave={() => onHover(null)}>
      <GridFrame
        grid={grid}
        className="heat"
        renderCell={(slot) => {
          const t = tallies.get(slot.key);
          const free = t ? t.yes.length + t.maybe.length : 0;
          const level = heatLevel(t, total);
          const everyone = total > 0 && free === total;
          return (
            <button
              type="button"
              className="cell"
              data-key={slot.key}
              data-everyone={everyone || undefined}
              data-selected={selected === slot.key || undefined}
              data-outline={outline ? (outline[slot.key] ?? 0) : undefined}
              style={{ '--heat': level.toFixed(3), '--pane': glow(Math.pow(level, 0.85)) } as CSSProperties}
              aria-label={`${slotLabel(grid, slot)}: ${free} of ${total} free`}
              aria-pressed={selected === slot.key}
              onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(slot.key)}
              onClick={() => onSelect(selected === slot.key ? null : slot.key)}
            />
          );
        }}
      />
    </div>
  );
}
