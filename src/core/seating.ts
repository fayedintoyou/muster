import type { Person } from './types';

// Seating a raid: everyone free takes at most one seat, in a role they play, so "fills a 10" is honest.
// Someone who plays tank or dps fills one of the two, never both.

export const RAID_SIZES = [10, 20, 40];

/** The usual tanks and healers for each raid size; everyone else is dps. */
export const USUAL_MAKEUP: Record<number, Record<string, number>> = {
  10: { tank: 2, healer: 3 },
  20: { tank: 2, healer: 5 },
  40: { tank: 4, healer: 10 },
};

export function usualMakeup(size: number): Record<string, number> {
  return { ...(USUAL_MAKEUP[size] ?? { tank: 0, healer: 0 }) };
}

/** Seats per role: the tanks and healers asked for, and dps for the rest. */
export function seatsFor(size: number, makeup: Record<string, number>): Record<string, number> {
  const tank = makeup.tank ?? 0;
  const healer = makeup.healer ?? 0;
  return { tank, healer, dps: Math.max(0, size - tank - healer) };
}

export interface Seat {
  id: string;
  role: string;
}

export interface Seating {
  size: number;
  /** Seats per role. */
  want: Record<string, number>;
  /** Seats taken per role. */
  filled: Record<string, number>;
  seated: Seat[];
  /** Seated, though only if needed: the lineup counts on them coming at a push. */
  ifNeeded: string[];
  /** Seated people who play more than one role, and the one this lineup has them in. */
  flex: Seat[];
  /** Free, but their roles' seats are full, or they have no role yet. */
  extra: string[];
}

/**
 * Seats as many of `people` as the raid holds, those available for sure before those free only if needed.
 * It's a matching, so one person moving from dps to tank to make room counts. With `order`, people are
 * placed in that order instead: whoever comes first keeps their seat.
 */
export function seat(
  people: Person[],
  available: ReadonlySet<string>,
  size: number,
  makeup: Record<string, number>,
  order?: string[],
): Seating {
  const want = seatsFor(size, makeup);
  const playable = new Map(people.map((p) => [p.id, p.roles.filter((r) => (want[r] ?? 0) > 0)]));
  const holders: Record<string, string[]> = Object.fromEntries(Object.keys(want).map((r) => [r, []]));
  const roleOf = new Map<string, string>();

  // Kuhn's augmenting paths: seat this person, moving someone already seated to another of their roles
  // if that frees the seat. Anyone seated stays seated.
  const place = (id: string, tried: Set<string>): boolean => {
    for (const role of playable.get(id) ?? []) {
      if (tried.has(role)) continue;
      tried.add(role);
      if (holders[role].length < want[role]) {
        holders[role].push(id);
        roleOf.set(id, role);
        return true;
      }
      for (const [i, other] of holders[role].entries()) {
        if (place(other, tried)) {
          holders[role][i] = id;
          roleOf.set(id, role);
          return true;
        }
      }
    }
    return false;
  };

  // Sure before if-needed; then those with fewer roles, who are harder to place.
  const placing = order ?? [...people]
    .sort(
      (a, b) =>
        Number(available.has(b.id)) - Number(available.has(a.id)) ||
        (playable.get(a.id)?.length ?? 0) - (playable.get(b.id)?.length ?? 0),
    )
    .map((p) => p.id);
  const extra: string[] = [];
  for (const id of placing) if (!place(id, new Set())) extra.push(id);

  const seated = people.filter((p) => roleOf.has(p.id)).map((p) => ({ id: p.id, role: roleOf.get(p.id)! }));
  return {
    size,
    want,
    filled: Object.fromEntries(Object.entries(holders).map(([r, ids]) => [r, ids.length])),
    seated,
    ifNeeded: seated.filter((s) => !available.has(s.id)).map((s) => s.id),
    flex: seated.filter((s) => (playable.get(s.id)?.length ?? 0) > 1),
    extra: people.filter((p) => extra.includes(p.id)).map((p) => p.id),
  };
}
