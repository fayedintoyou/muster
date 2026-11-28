import type { Person, PollSettings } from './types';
import type { Raid } from './raid';
import { parseSlotKey } from './slots';
import { type Seating, seat } from './seating';
import { type Result } from './validate';
import { type Absence, awayOn } from './absence';

// Sign-ups: each night of a locked-in raid is an event people answer in, late, tentative or out. Being
// free (the poll), signing up (here) and turning up are different things, so these sit beside the poll's
// answers and never change them.
//
// Seats go to the raid's own team first, then to anyone else in the guild in the order they signed up;
// whoever doesn't fit waits on standby. An organizer can seat or bench anyone, either way.

export const STATUSES = ['in', 'late', 'tentative', 'out'] as const;
export type SignupStatus = (typeof STATUSES)[number];

export interface Signup {
  status: SignupStatus;
  /** For late: minutes after the start they expect to arrive. */
  late?: number;
  /** When they first signed up, or last changed from out to coming: first come, first seated. */
  at: number;
}

/** An organizer's call on one person for one night. */
export type Move = 'seat' | 'bench';

export interface EventSignups {
  people: Record<string, Signup>;
  moves: Record<string, Move>;
}

/** The raid an event belongs to: a team's id, or 'raid' for the poll's own. */
export const POLL_RAID = 'raid';

/** One night of one raid, such as 'k3m9xq/2026-12-10' or 'raid/2026-12-10'. */
export function eventKey(owner: string, night: string): string {
  return `${owner}/${night}`;
}

export const LATE_STEPS = [15, 30, 45, 60, 90];

export function validateSignup(input: unknown): Result<Pick<Signup, 'status' | 'late'> | null> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Missing the sign-up.' };
  const raw = input as Record<string, unknown>;
  if (raw.status === null) return { ok: true, value: null };
  if (!STATUSES.includes(raw.status as SignupStatus)) return { ok: false, error: 'Sign up as in, late, tentative or out.' };
  const status = raw.status as SignupStatus;
  if (status !== 'late') return { ok: true, value: { status } };
  const late = Number(raw.late);
  if (!LATE_STEPS.includes(late)) return { ok: false, error: 'Pick how late you’ll be.' };
  return { ok: true, value: { status, late } };
}

/** Coming or not, from what they said: a later change keeps their place unless they'd dropped out. */
export function nextSignup(before: Signup | undefined, change: Pick<Signup, 'status' | 'late'>, now: number): Signup {
  const coming = (s: SignupStatus) => s === 'in' || s === 'late';
  const keepPlace = before && coming(before.status) && coming(change.status);
  return { ...change, at: keepPlace ? before.at : now };
}

export type Usually = 'free' | 'if needed' | 'busy';

/** What someone's poll answers say about this raid's time: free for all of it, only at a push, or not. */
export function usuallyFree(person: Pick<Person, 'marks'>, raid: Pick<Raid, 'start' | 'minutes'>, slot: number): Usually {
  const start = parseSlotKey(raid.start);
  if (!start) return 'busy';
  let push = false;
  for (let m = start.minute; m < start.minute + raid.minutes; m += slot) {
    const mark = person.marks[`${start.day}/${m}`];
    if (!mark) return 'busy';
    if (mark === 1) push = true;
  }
  return push ? 'if needed' : 'free';
}

export interface Roster {
  seating: Seating;
  /** Coming, but not seated: in the order they'd be seated next. */
  standby: string[];
  tentative: string[];
  out: string[];
  /** The raid's people who haven't answered for this night, with what the poll says. */
  unanswered: { id: string; usually: Usually }[];
  /** The raid's people with a dated absence over this night and no answer for it: out, without asking. */
  away: { id: string; note: string }[];
}

/**
 * Who's seated for one night. Seated first: anyone an organizer seated, then the team's members who are
 * coming (in the usual order, so the harder to place go first), then everyone else coming, first come
 * first served. Benched people wait on standby.
 *
 * Someone with a dated absence over the night counts as away, not unanswered, unless they've answered for
 * it anyway: an answer for the night wins, so coming back early is one tap.
 */
export function roster(
  people: Person[],
  event: EventSignups | undefined,
  raid: Pick<Raid, 'start' | 'minutes'>,
  team: { members: string[]; size: number; makeup: Record<string, number> } | null,
  poll: Pick<PollSettings, 'size' | 'makeup' | 'slot'>,
  absences?: { night: string; of: Record<string, readonly Absence[]> },
): Roster {
  const signups = event?.people ?? {};
  const moves = event?.moves ?? {};
  const byId = new Map(people.map((p) => [p.id, p]));
  const answered = (status: SignupStatus[]) =>
    Object.entries(signups)
      .filter(([id, s]) => byId.has(id) && status.includes(s.status))
      .sort((a, b) => a[1].at - b[1].at)
      .map(([id]) => id);
  const coming = answered(['in', 'late']);
  const members = new Set(team?.members ?? []);
  const benched = coming.filter((id) => moves[id] === 'bench');
  const order = [
    ...coming.filter((id) => moves[id] === 'seat'),
    ...coming.filter((id) => moves[id] !== 'seat' && moves[id] !== 'bench' && members.has(id)),
    ...coming.filter((id) => moves[id] !== 'seat' && moves[id] !== 'bench' && !members.has(id)),
  ];
  const size = team ? team.size : poll.size;
  const makeup = team ? team.makeup : poll.makeup;
  const placing = order.map((id) => byId.get(id)!);
  const seating: Seating = size
    ? seat(placing, new Set(coming), size, makeup, order)
    : // A raid of no set size seats everyone coming, in the first role they play.
      {
        size: placing.length,
        want: {},
        filled: {},
        seated: placing.map((p) => ({ id: p.id, role: p.roles[0] ?? '' })),
        ifNeeded: [],
        flex: [],
        extra: [],
      };
  const pool = (team ? team.members : people.map((p) => p.id)).filter((id) => byId.has(id) && !signups[id]);
  const away = new Map<string, Absence>();
  for (const id of pool) {
    const absence = absences && awayOn(absences.of[id], absences.night);
    if (absence) away.set(id, absence);
  }
  return {
    seating,
    standby: [...seating.extra, ...benched],
    tentative: answered(['tentative']),
    out: answered(['out']),
    unanswered: pool.filter((id) => !away.has(id)).map((id) => ({ id, usually: usuallyFree(byId.get(id)!, raid, poll.slot) })),
    away: [...away].map(([id, a]) => ({ id, note: a.note })),
  };
}
