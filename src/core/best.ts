import { type Seating, seat } from './seating';
import type { Grid } from './grid';
import type { Person } from './types';

// Who is free when, and the best windows of a given length: the part when2meet leaves to squinting.

export interface Tally {
  /** Available. */
  yes: string[];
  /** If needed. */
  maybe: string[];
}

export function tallySlots(grid: Grid, people: Person[]): Map<string, Tally> {
  const out = new Map<string, Tally>();
  for (const key of grid.byKey.keys()) out.set(key, { yes: [], maybe: [] });
  for (const p of people) {
    for (const [key, mark] of Object.entries(p.marks)) {
      const t = out.get(key);
      if (!t) continue;
      (mark === 2 ? t.yes : t.maybe).push(p.id);
    }
  }
  return out;
}

export interface Candidate {
  col: number;
  /** Index, within the column, of the earliest start that gives these people. */
  first: number;
  /** Latest start (same column) that gives exactly the same people: any start in between works. */
  last: number;
  /** Slots in the window. */
  span: number;
  /** Free for the whole window, available or if needed. */
  attend: string[];
  /** Of `attend`, those available throughout without needing "if needed". */
  yes: string[];
  /** Not free throughout, but free for at least half of the earliest window. */
  partly: { id: string; slots: number }[];
  missing: string[];
  roles: Record<string, number>;
  /** With a raid size: who takes which seat. */
  seating?: Seating;
}

export interface BestOptions {
  /** Window length in minutes. */
  length: number;
  people: Person[];
  /** People every window must include. */
  required?: ReadonlySet<string>;
  roles?: string[];
  /** How many windows to return. */
  limit?: number;
  /** The raid's size and its tanks and healers: windows are then ranked by how full a raid they seat. */
  raid?: { size: number; makeup: Record<string, number> };
}

export interface BestResult {
  candidates: Candidate[];
  span: number;
  /** The window was cut down to the poll's whole column. */
  clamped: boolean;
  /** Required people never overlap for the whole window. */
  requiredUnmet: boolean;
}

// With a raid size, the most seats filled comes first, then the fewest of them only if needed.
const seatedSure = (c: Candidate) => (c.seating ? c.seating.seated.length - c.seating.ifNeeded.length : 0);
const better = (a: Candidate, b: Candidate) =>
  (b.seating?.seated.length ?? 0) - (a.seating?.seated.length ?? 0) ||
  seatedSure(b) - seatedSure(a) ||
  b.attend.length - a.attend.length ||
  b.yes.length - a.yes.length ||
  b.last - b.first - (a.last - a.first) ||
  a.col - b.col ||
  a.first - b.first;

export function bestWindows(grid: Grid, opts: BestOptions): BestResult {
  const limit = opts.limit ?? 5;
  const required = opts.required ?? new Set<string>();
  const columnLength = Math.max(0, ...grid.columns.map((c) => c.slots.length));
  const wanted = Math.max(1, Math.ceil(opts.length / grid.slotMinutes));
  const span = Math.min(wanted, columnLength);
  const all: Candidate[] = [];
  let sawRequiredMiss = false;

  grid.columns.forEach((column, col) => {
    const n = column.slots.length;
    if (n < span || span === 0) return;
    // Per person, prefix counts of slots they're free (≥ if needed) and available.
    const free: number[][] = [];
    const avail: number[][] = [];
    for (const p of opts.people) {
      const f = [0], a = [0];
      for (let k = 0; k < n; k++) {
        const mark = p.marks[column.slots[k].key];
        f.push(f[k] + (mark ? 1 : 0));
        a.push(a[k] + (mark === 2 ? 1 : 0));
      }
      free.push(f);
      avail.push(a);
    }

    let run: Candidate | null = null;
    let runSignature = '';
    const close = () => {
      if (run && run.attend.length > 0) all.push(run);
      run = null;
      runSignature = '';
    };

    for (let i = 0; i + span <= n; i++) {
      const attend: string[] = [];
      const yes: string[] = [];
      opts.people.forEach((p, pi) => {
        if (free[pi][i + span] - free[pi][i] === span) {
          attend.push(p.id);
          if (avail[pi][i + span] - avail[pi][i] === span) yes.push(p.id);
        }
      });
      if (required.size > 0 && ![...required].every((id) => attend.includes(id))) {
        sawRequiredMiss = true;
        close();
        continue;
      }
      const signature = attend.join(',') + '|' + yes.join(',');
      if (run && signature === runSignature) {
        (run as Candidate).last = i;
        continue;
      }
      close();
      const missing: string[] = [];
      const partly: { id: string; slots: number }[] = [];
      opts.people.forEach((p, pi) => {
        if (attend.includes(p.id)) return;
        missing.push(p.id);
        const covered = free[pi][i + span] - free[pi][i];
        if (covered * 2 >= span) partly.push({ id: p.id, slots: covered });
      });
      const roles: Record<string, number> = {};
      for (const role of opts.roles ?? []) roles[role] = 0;
      for (const p of opts.people) {
        if (!attend.includes(p.id)) continue;
        for (const role of p.roles) if (role in roles) roles[role]++;
      }
      const seating = opts.raid
        ? seat(
            opts.people.filter((p) => attend.includes(p.id)),
            new Set(yes),
            opts.raid.size,
            opts.raid.makeup,
          )
        : undefined;
      run = { col, first: i, last: i, span, attend, yes, partly, missing, roles, seating };
      runSignature = signature;
    }
    close();
  });

  all.sort(better);

  // The best window of each night first, so the list offers different nights; then more windows,
  // apart from those already chosen, if there are fewer nights than places.
  const picked: Candidate[] = [];
  const seenColumns = new Set<number>();
  for (const c of all) {
    if (picked.length >= limit) break;
    if (seenColumns.has(c.col)) continue;
    seenColumns.add(c.col);
    picked.push(c);
  }
  for (const c of all) {
    if (picked.length >= limit) break;
    if (picked.includes(c)) continue;
    const clashes = picked.some(
      (p) => p.col === c.col && c.first < p.last + p.span && p.first < c.first + c.span,
    );
    if (!clashes) picked.push(c);
  }
  picked.sort(better);

  return {
    candidates: picked,
    span,
    clamped: span < wanted,
    requiredUnmet: required.size > 0 && all.length === 0 && sawRequiredMiss,
  };
}
