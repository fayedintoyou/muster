import { type KeyboardEvent, type MouseEvent, type PointerEvent, useRef, useState } from 'react';
import type { Grid, GridSlot } from '../core/grid';
import type { Mark, Marks } from '../core/types';
import { GridFrame, columnLabel, rowLabel, slotLabel } from './GridFrame';

// Your own answers. Press and drag to fill a rectangle of slots (starting on a slot already in the
// current mark clears instead), tap one slot, or tap a night or a time to fill that whole column or row.
// While a finger is on the grid it paints rather than scrolls; the times down the side still scroll, and
// holding a drag near the top or bottom of the screen scrolls the page so a tall grid paints in one go.

const MARK_NAME: Record<number, string> = { 0: 'not free', 1: 'if needed', 2: 'available' };

interface Drag {
  id: number;
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  value: Mark | 0;
}

export function PaintGrid({
  grid,
  marks,
  tool,
  onChange,
  demo = false,
}: {
  grid: Grid;
  marks: Marks;
  tool: Mark;
  onChange: (marks: Marks) => void;
  /** Nothing marked yet: the first night shows a drag lighting a few windows, as a hint. */
  demo?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const [focusKey, setFocusKey] = useState(() => grid.columns[0]?.slots[0]?.key ?? '');
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef(0);

  const cellElements = () => Array.from(wrap.current?.querySelectorAll<HTMLElement>('[data-key]') ?? []);

  const bounds = (d: Drag) => ({
    rA: Math.min(d.r0, d.r1),
    rB: Math.max(d.r0, d.r1),
    cA: Math.min(d.c0, d.c1),
    cB: Math.max(d.c0, d.c1),
  });

  const showPreview = () => {
    const d = drag.current;
    if (!d) return;
    const { rA, rB, cA, cB } = bounds(d);
    for (const el of cellElements()) {
      const r = Number(el.dataset.r);
      const c = Number(el.dataset.c);
      if (r >= rA && r <= rB && c >= cA && c <= cB) el.dataset.preview = String(d.value);
      else delete el.dataset.preview;
    }
  };

  const clearPreview = () => {
    for (const el of cellElements()) delete el.dataset.preview;
  };

  const apply = (slots: GridSlot[], value: Mark | 0) => {
    const next = { ...marksRef.current };
    for (const s of slots) {
      if (value) next[s.key] = value;
      else delete next[s.key];
    }
    onChange(next);
  };

  const stopScrolling = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    pointer.current = null;
  };

  const commit = () => {
    const d = drag.current;
    drag.current = null;
    stopScrolling();
    clearPreview();
    if (!d) return;
    const { rA, rB, cA, cB } = bounds(d);
    const slots: GridSlot[] = [];
    for (let r = rA; r <= rB; r++) {
      for (let c = cA; c <= cB; c++) {
        const s = grid.cells[r][c];
        if (s) slots.push(s);
      }
    }
    apply(slots, d.value);
  };

  const cellAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-key]');
    return el && wrap.current?.contains(el) ? el : null;
  };

  const follow = (x: number, y: number) => {
    const d = drag.current;
    const el = d && cellAt(x, y);
    if (!d || !el) return;
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    if (r !== d.r1 || c !== d.c1) {
      d.r1 = r;
      d.c1 = c;
      showPreview();
    }
  };

  // Near the top (under the sticky tabs) or the bottom of the window, scroll a little each frame,
  // faster the closer the finger is to the edge, and keep the rectangle under it.
  const edgeScroll = () => {
    const p = pointer.current;
    if (!drag.current || !p) {
      frame.current = 0;
      return;
    }
    const top = 88;
    const bottom = window.innerHeight - 56;
    const dy = p.y < top ? -Math.ceil((top - p.y) / 5) : p.y > bottom ? Math.ceil((p.y - bottom) / 5) : 0;
    if (dy !== 0) {
      const before = window.scrollY;
      window.scrollBy(0, dy);
      if (window.scrollY !== before) follow(p.x, p.y);
    }
    frame.current = requestAnimationFrame(edgeScroll);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
    if (!el) return;
    e.preventDefault();
    wrap.current?.setPointerCapture(e.pointerId);
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    const current = marksRef.current[el.dataset.key!] ?? 0;
    drag.current = { id: e.pointerId, r0: r, c0: c, r1: r, c1: c, value: current === tool ? 0 : tool };
    setFocusKey(el.dataset.key!);
    showPreview();
    pointer.current = { x: e.clientX, y: e.clientY };
    if (!frame.current) frame.current = requestAnimationFrame(edgeScroll);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    pointer.current = { x: e.clientX, y: e.clientY };
    follow(e.clientX, e.clientY);
  };

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) commit();
  };

  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    stopScrolling();
    clearPreview();
  };

  // Keyboard and screen readers: arrows move between slots; Enter or Space toggles one (a click with
  // detail 0, which a mouse or finger never sends: those paint through the pointer handlers above).
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.detail !== 0) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
    if (!el) return;
    const slot = grid.byKey.get(el.dataset.key!);
    if (!slot) return;
    apply([slot], (marksRef.current[slot.key] ?? 0) === tool ? 0 : tool);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
    if (!el) return;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    let r = Number(el.dataset.r);
    let c = Number(el.dataset.c);
    for (;;) {
      r += move[0];
      c += move[1];
      if (r < 0 || c < 0 || r >= grid.rows.length || c >= grid.columns.length) return;
      const s = grid.cells[r][c];
      if (s) {
        setFocusKey(s.key);
        wrap.current?.querySelector<HTMLElement>(`[data-key="${s.key}"]`)?.focus();
        return;
      }
    }
  };

  const toggleAll = (slots: GridSlot[]) => {
    const full = slots.every((s) => marksRef.current[s.key] === tool);
    apply(slots, full ? 0 : tool);
  };

  const toolName = MARK_NAME[tool];
  // After the poll's maker changes its nights or times, the remembered slot may be gone.
  const tabKey = grid.byKey.has(focusKey) ? focusKey : (grid.columns[0]?.slots[0]?.key ?? '');

  return (
    <div
      ref={wrap}
      className="paint-wrap"
      data-demo={demo || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <GridFrame
        grid={grid}
        className="paint"
        onColumn={(col) => toggleAll(grid.columns[col].slots)}
        onRow={(row) => toggleAll(grid.cells[row].filter((s): s is GridSlot => s !== null))}
        columnTitle={(col) => `Mark all of ${columnLabel(grid, col).weekday} as ${toolName}`}
        rowTitle={(row) => `Mark ${rowLabel(grid, row).text} on every night as ${toolName}`}
        renderCell={(slot) => {
          const mark = marks[slot.key] ?? 0;
          return (
            <button
              type="button"
              className="cell"
              data-key={slot.key}
              data-r={slot.row}
              data-c={slot.col}
              data-mark={mark}
              tabIndex={slot.key === tabKey ? 0 : -1}
              aria-pressed={mark > 0}
              aria-label={`${slotLabel(grid, slot)}: ${MARK_NAME[mark]}`}
            />
          );
        }}
      />
    </div>
  );
}
