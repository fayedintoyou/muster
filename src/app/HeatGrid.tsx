import { type CSSProperties, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import type { Grid } from '../core/grid';
import type { Tally } from '../core/best';
import type { Marks } from '../core/types';
import { GridFrame, columnLabel, slotLabel } from './GridFrame';
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

// A small copy of the grid that stays under the tabs once the big one has scrolled away, so tracing someone
// from far down the people list still shows when they're free. Tapping it goes back up to the big grid.
export function HeatGlance({
  grid,
  tallies,
  total,
  outline,
  label,
  target,
}: {
  grid: Grid;
  tallies: Map<string, Tally>;
  total: number;
  outline?: Marks;
  label: string;
  /** The big grid: the glance shows while it's out of view, and a tap scrolls back to it. */
  target: RefObject<HTMLElement | null>;
}) {
  const [shown, setShown] = useState(false);
  const self = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const el = target.current;
    const glance = self.current;
    if (!el || !glance) return;
    // Shown once what's left of the big grid fits under the glance, so it covers that rather than
    // leaving the bottom rows peeking out under the frozen nights. Measured each time: while its tab
    // is hidden, or on a desktop where it never shows, everything measures zero.
    let frame = 0;
    const check = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      const under = glance.offsetTop + glance.offsetHeight;
      setShown(box.height > 0 && under > 0 && box.bottom < under);
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    addEventListener('scroll', later, { passive: true });
    const seen = new ResizeObserver(later);
    seen.observe(el);
    return () => {
      removeEventListener('scroll', later);
      seen.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [target]);
  const rowPx = Math.max(4, Math.min(9, Math.floor(140 / grid.rows.length)));
  return (
    <button
      type="button"
      ref={self}
      className="heat-glance"
      data-shown={shown || undefined}
      tabIndex={shown ? 0 : -1}
      aria-hidden={!shown}
      aria-label={`${label} Back to the grid.`}
      onClick={() => target.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
    >
      <span className="heat-glance-label">{label}</span>
      <span
        className="heat-glance-grid"
        style={{ '--cols': grid.columns.length, '--row': `${rowPx}px` } as CSSProperties}
      >
        {grid.columns.map((_, col) => (
          <span key={`d${col}`} className="heat-glance-day">
            {columnLabel(grid, col).weekday}
          </span>
        ))}
        {grid.cells.flatMap((row, r) =>
          row.map((slot, col) =>
            slot ? (
              <span
                key={slot.key}
                data-outline={outline ? (outline[slot.key] ?? 0) : undefined}
                style={{ background: glow(Math.pow(heatLevel(tallies.get(slot.key), total), 0.85)) }}
              />
            ) : (
              <span key={`x${r}-${col}`} data-empty />
            ),
          ),
        )}
      </span>
    </button>
  );
}
