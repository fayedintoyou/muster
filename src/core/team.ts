import type { Raid } from './raid';
import { parseSlotKey } from './slots';
import { type Result, validateRaidSize } from './validate';

// A raid team: people the organizer picked from everyone who answered the poll, with the raid's size and
// make-up. Best times for a team reads only its members' answers, and a team locks in its own raid.

export interface Team {
  id: string;
  name: string;
  /** Person ids, in the order they were added. */
  members: string[];
  size: number;
  makeup: Record<string, number>;
  /** Team only: only its members can sign up for its raids and events. Otherwise the guild fills any seats left. */
  closed: boolean;
  /** The team's locked-in raid, or null while it's still finding one. */
  raid: Raid | null;
}

export const TEAM_LIMITS = { name: 40, teams: 12 } as const;

/** Name, members (only people in the poll), size, make-up and team only; the raid is set on its own. */
export function validateTeam(
  input: unknown,
  personIds: ReadonlySet<string>,
): Result<Pick<Team, 'name' | 'members' | 'size' | 'makeup' | 'closed'>> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Missing the team’s details.' };
  const raw = input as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim().slice(0, TEAM_LIMITS.name) : '';
  if (!name) return { ok: false, error: 'Give the team a name.' };
  const given = Array.isArray(raw.members) ? raw.members : [];
  const members = [...new Set(given.filter((id): id is string => typeof id === 'string' && personIds.has(id)))];
  const raid = validateRaidSize(raw.size, raw.makeup);
  if (!raid.ok) return raid;
  return { ok: true, value: { name, members, ...raid.value, closed: raw.closed === true } };
}

/** Two raids that overlap: on the same night (or date) at overlapping times. */
export function raidsClash(a: Pick<Raid, 'start' | 'minutes'>, b: Pick<Raid, 'start' | 'minutes'>): boolean {
  const pa = parseSlotKey(a.start);
  const pb = parseSlotKey(b.start);
  if (!pa || !pb || pa.day !== pb.day) return false;
  return pa.minute < pb.minute + b.minutes && pb.minute < pa.minute + a.minutes;
}

/** For each team, the members also on another team whose raid clashes with this one's. */
export function teamClashes(teams: Team[]): Map<string, { person: string; team: Team }[]> {
  const out = new Map<string, { person: string; team: Team }[]>();
  for (const t of teams) {
    const list: { person: string; team: Team }[] = [];
    for (const other of teams) {
      if (other.id === t.id || !t.raid || !other.raid || !raidsClash(t.raid, other.raid)) continue;
      for (const person of t.members) if (other.members.includes(person)) list.push({ person, team: other });
    }
    out.set(t.id, list);
  }
  return out;
}
