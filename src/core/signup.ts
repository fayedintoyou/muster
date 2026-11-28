import type { Alt, Person, PollSettings } from './types';
import type { Raid } from './raid';
import { parseSlotKey } from './slots';
import { type Seating, seat } from './seating';
import { LIMITS, type Result } from './validate';
import { type Absence, awayOn } from './absence';
import { rolesFor, specsFor } from './classes';
import { parseDate, weekdayOf } from './time';

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
  /** On one of their alts this night, by the alt's id. */
  as?: string;
  /** Another spec this night than the character's usual ones. */
  specs?: string[];
}

/** What someone says for a night. For `as` and `specs`, undefined keeps what they said before; null goes back to usual. */
export interface SignupChange {
  status: SignupStatus;
  late?: number;
  as?: string | null;
  specs?: string[] | null;
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

/**
 * The shape of a sign-up. Whether the alt and specs are this person's own is checked against them with
 * `checkPlaying`.
 */
export function validateSignup(input: unknown): Result<SignupChange | null> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Missing the sign-up.' };
  const raw = input as Record<string, unknown>;
  if (raw.status === null) return { ok: true, value: null };
  if (!STATUSES.includes(raw.status as SignupStatus)) return { ok: false, error: 'Sign up as in, late, tentative or out.' };
  const status = raw.status as SignupStatus;
  const value: SignupChange = { status };
  if (status === 'late') {
    const late = Number(raw.late);
    if (!LATE_STEPS.includes(late)) return { ok: false, error: 'Pick how late you’ll be.' };
    value.late = late;
  }
  if (raw.as !== undefined) {
    if (raw.as !== null && (typeof raw.as !== 'string' || !/^[a-z0-9]{4,8}$/.test(raw.as))) return { ok: false, error: 'Unknown alt.' };
    value.as = raw.as;
  }
  if (raw.specs !== undefined) {
    if (raw.specs !== null && (!Array.isArray(raw.specs) || !raw.specs.every((x) => typeof x === 'string'))) {
      return { ok: false, error: 'Unknown spec.' };
    }
    value.specs = raw.specs === null || (raw.specs as string[]).length === 0 ? null : (raw.specs as string[]);
  }
  return { ok: true, value };
}

/** Coming or not, from what they said: a later change keeps their place unless they'd dropped out. */
export function nextSignup(before: Signup | undefined, change: SignupChange, now: number): Signup {
  const coming = (s: SignupStatus) => s === 'in' || s === 'late';
  const keepPlace = before && coming(before.status) && coming(change.status);
  const out: Signup = { status: change.status, at: keepPlace ? before.at : now };
  if (change.late !== undefined) out.late = change.late;
  const as = change.as === undefined ? before?.as : change.as;
  // Another character's specs don't carry over to this one.
  const specs = change.specs === undefined && change.as === undefined ? before?.specs : change.specs;
  if (as) out.as = as;
  if (specs) out.specs = specs;
  return out;
}

/** Checks that the alt is theirs and the specs are its class's. */
export function checkPlaying(person: Pick<Person, 'cls' | 'alts'>, change: SignupChange, before: Signup | undefined): Result<SignupChange> {
  const as = change.as === undefined ? before?.as : change.as;
  const alt = as ? person.alts.find((a) => a.id === as) : undefined;
  if (as && !alt) {
    if (change.as !== undefined) return { ok: false, error: 'That alt isn’t one of yours any more.' };
    // An alt removed since signing up on it: anything else said for the night is on the main.
    change = { ...change, as: null };
  }
  if (!change.specs) return { ok: true, value: change };
  const cls = alt?.cls ?? person.cls;
  const known = specsFor(cls);
  const specs = [...new Set(change.specs.map((x) => x.toLocaleLowerCase('en-US')))];
  if (!known.length) return { ok: false, error: 'Specs are for a class with specs.' };
  if (specs.length > LIMITS.specs || specs.some((x) => !known.includes(x))) return { ok: false, error: `Pick a ${cls} spec.` };
  return { ok: true, value: { ...change, specs: known.filter((x) => specs.includes(x)) } };
}

/** Who someone plays on a night: their main or an alt, in its usual specs or the night's. */
export interface Playing {
  name: string;
  cls: string;
  specs: string[];
  roles: string[];
  /** Set when it's an alt. */
  alt?: Alt;
  /** Specs other than the character's usual ones. */
  changed: boolean;
}

export function playing(person: Person, signup: Pick<Signup, 'as' | 'specs'> | undefined, pollRoles: string[]): Playing {
  const alt = signup?.as ? person.alts.find((a) => a.id === signup.as) : undefined;
  const base = alt ?? person;
  // A night's specs from before a class change are dropped: they'd be another class's.
  const night = signup?.specs?.filter((x) => specsFor(base.cls).includes(x)) ?? [];
  const specs = night.length ? night : base.specs;
  const changed = night.length > 0 && specs.join() !== base.specs.join();
  return {
    name: base.name,
    cls: base.cls,
    specs,
    roles: changed ? rolesFor(base.cls, specs).filter((r) => pollRoles.includes(r)) : base.roles,
    alt,
    changed,
  };
}

export type Usually = 'free' | 'if needed' | 'busy';

/** What someone's poll answers say about this raid's time: free for all of it, only at a push, or not. */
export function usuallyFree(
  person: Pick<Person, 'marks'>,
  raid: Pick<Raid, 'start' | 'minutes'>,
  slot: number,
  mode: PollSettings['mode'] = 'dates',
): Usually {
  const start = parseSlotKey(raid.start);
  if (!start) return 'busy';
  // A one-off event on a date, in a poll of weekdays: what they marked for that weekday.
  const date = mode === 'weekly' ? parseDate(start.day) : null;
  const day = date ? `w${weekdayOf(date)}` : start.day;
  let push = false;
  for (let m = start.minute; m < start.minute + raid.minutes; m += slot) {
    const mark = person.marks[`${day}/${m}`];
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

/** Who's seated first and how many a raid holds: a team, or a one-off event's. */
export interface Seats {
  members: string[];
  size: number;
  makeup: Record<string, number>;
  /** Team only: no one else is seated or counted. */
  closed?: boolean;
}

/**
 * Who's seated for one night. Seated first: anyone an organizer seated, then the team's members who are
 * coming (in the usual order, so the harder to place go first), then everyone else coming, first come
 * first served. Benched people wait on standby. Each is placed as who they're playing that night.
 *
 * Someone with a dated absence over the night counts as away, not unanswered, unless they've answered for
 * it anyway: an answer for the night wins, so coming back early is one tap.
 */
export function roster(
  people: Person[],
  event: EventSignups | undefined,
  raid: Pick<Raid, 'start' | 'minutes'>,
  team: Seats | null,
  poll: Pick<PollSettings, 'size' | 'makeup' | 'slot' | 'roles' | 'mode'>,
  absences?: { night: string; of: Record<string, readonly Absence[]> },
): Roster {
  const signups = event?.people ?? {};
  const moves = event?.moves ?? {};
  const members = new Set(team?.members ?? []);
  const byId = new Map(
    people
      .filter((p) => !team?.closed || members.has(p.id))
      .map((p) => {
        const now = playing(p, signups[p.id], poll.roles);
        return [p.id, { ...p, cls: now.cls, specs: now.specs, roles: now.roles }];
      }),
  );
  const answered = (status: SignupStatus[]) =>
    Object.entries(signups)
      .filter(([id, s]) => byId.has(id) && status.includes(s.status))
      .sort((a, b) => a[1].at - b[1].at)
      .map(([id]) => id);
  const coming = answered(['in', 'late']);
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
    unanswered: pool
      .filter((id) => byId.has(id) && !away.has(id))
      .map((id) => ({ id, usually: usuallyFree(byId.get(id)!, raid, poll.slot, poll.mode) })),
    away: [...away].map(([id, a]) => ({ id, note: a.note })),
  };
}
