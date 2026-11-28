import { type Result } from './validate';

// Groups for a raid night: the seated split into parties of five, by hand. An organizer places people,
// can save a night's layout as the raid's template and lay it over another night. Nothing here picks
// groups for them: the guild splits by hand first, and maybe muster learns from that later.
//
// Stored groups are only ever read through `arrange`, which keeps them honest with tonight's seats:
// someone benched or out since drops out of their group, and anyone seated but in no group is unplaced.

/** Each group's people by id, group 1 first. */
export type Groups = string[][];

export const GROUP_SIZE = 5;

/** 8 groups for a 40, 4 for a 20, 2 for a 10; a raid of any size gets as many as its seated fill. */
export function groupCount(size: number, seated: number): number {
  return Math.max(1, Math.ceil((size > 0 ? size : seated) / GROUP_SIZE));
}

/**
 * Stored groups (or a template) laid over who's seated tonight: only the seated, each once, at most five
 * to a group, `count` groups. Laying a template over another night is the same thing: people missing that
 * night are left out, and new people are left unplaced.
 */
export function arrange(stored: Groups | undefined, seated: string[], count: number): { groups: Groups; unplaced: string[] } {
  const here = new Set(seated);
  const placed = new Set<string>();
  const groups: Groups = [];
  for (let i = 0; i < count; i++) {
    const group: string[] = [];
    for (const id of stored?.[i] ?? []) {
      if (!here.has(id) || placed.has(id) || group.length >= GROUP_SIZE) continue;
      group.push(id);
      placed.add(id);
    }
    groups.push(group);
  }
  return { groups, unplaced: seated.filter((id) => !placed.has(id)) };
}

/** Into a group (by index), out of every group (null), or swapped with someone else. */
export type GroupMove = { group: number | null } | { swap: string };

export function validateGroupMove(input: unknown, count: number): Result<GroupMove> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Missing the move.' };
  const raw = input as Record<string, unknown>;
  if (typeof raw.swap === 'string') return { ok: true, value: { swap: raw.swap } };
  if (raw.group === null) return { ok: true, value: { group: null } };
  if (Number.isInteger(raw.group) && (raw.group as number) >= 0 && (raw.group as number) < count) {
    return { ok: true, value: { group: raw.group as number } };
  }
  return { ok: false, error: 'Pick a group.' };
}

function find(groups: Groups, id: string): [number, number] | null {
  for (const [g, group] of groups.entries()) {
    const i = group.indexOf(id);
    if (i >= 0) return [g, i];
  }
  return null;
}

/** One move on arranged groups. A full group takes no one more; swap with someone in it instead. */
export function moveInGroups(groups: Groups, id: string, move: GroupMove): Result<Groups> {
  const next = groups.map((g) => [...g]);
  const from = find(next, id);
  if ('swap' in move) {
    if (move.swap === id) return { ok: true, value: next };
    const to = find(next, move.swap);
    // Either may be unplaced: then the other takes their place, and they're unplaced instead.
    if (from) next[from[0]][from[1]] = move.swap;
    if (to) next[to[0]][to[1]] = id;
    return { ok: true, value: next };
  }
  if (move.group === null) {
    if (from) next[from[0]].splice(from[1], 1);
    return { ok: true, value: next };
  }
  if (from?.[0] === move.group) return { ok: true, value: next };
  if (next[move.group].length >= GROUP_SIZE) return { ok: false, error: 'That group is full. Swap someone out instead.' };
  if (from) next[from[0]].splice(from[1], 1);
  next[move.group].push(id);
  return { ok: true, value: next };
}

// What a group's classes bring to it, kept light: totems and auras reach only their own group, and a
// priest in each group is a habit for group heals and fortitude.
const HINTS: [cls: string, hint: string][] = [
  ['shaman', 'totems'],
  ['paladin', 'aura'],
  ['priest', 'priest'],
];

/** "totems", "priest": the group-only things these classes bring, in a fixed order. */
export function groupHints(classes: string[]): string[] {
  return HINTS.filter(([cls]) => classes.includes(cls)).map(([, hint]) => hint);
}
