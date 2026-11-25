import type { CSSProperties } from 'react';
import type { Grid } from '../core/grid';
import type { Tally } from '../core/best';
import type { Marks } from '../core/types';
import { GridFrame, slotLabel } from './GridFrame';
import { glow } from './glow';

// Everyone's answers as lit panes: a slot glows warmer the more people are free (if needed counts as
// half), and a slot where everyone counted is free glows brightest. Hover or tap a pane to see who.

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
  return (
    <div className="heat-wrap" onPointerLeave={() => onHover(null)}>
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
