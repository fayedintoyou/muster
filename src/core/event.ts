import type { Mode, PollSettings } from './types';
import type { Raid, RaidNight } from './raid';
import { raidNights } from './raid';
import type { Team } from './team';
import { POLL_RAID, type Seats } from './signup';
import { DAY_MINUTES, MINUTE, type YMD, addDays, compareDates, dateKey, localTime, parseDate, today, weekdayOf, zonedInstant } from './time';
import { LIMITS, type Result, cleanLine, validateRaidSize } from './validate';

// One-off events, such as a pug night or an attunement run: one night, with its own name, size and
// sign-ups. An event can be for a team, which is seated first (and, team only, alone), or for the guild.
//
// Every raid that has nights to sign up for, whether the poll's own, a team's or an event, is a `RaidOf`,
// so sign-ups, rosters and Discord posts treat them all the same way.

export interface OneOff {
  /** Six characters, like a team's: it's the event's owner in sign-ups and on its Discord buttons. */
  id: string;
  name: string;
  /** When it starts. */
  at: number;
  minutes: number;
  size: number;
  makeup: Record<string, number>;
  /** The team it's for, or null for the guild. */
  team: string | null;
  note: string;
  /** Called off: kept so its post and sign-ups can say so. */
  off: boolean;
  /** Goes up with every change, so calendars know to update. */
  version: number;
}

export const EVENT_LIMITS = { name: 40, note: 200, events: 30 } as const;

/** How far ahead an event can be. */
const AHEAD = 366 * DAY_MINUTES * MINUTE;

const fail = (error: string): Result<never> => ({ ok: false, error });

export function validateEvent(
  input: unknown,
  teamIds: ReadonlySet<string>,
  now = Date.now(),
  /** When it starts now, for a change: an event under way can still get a new note or be called off. */
  was?: number,
): Result<Pick<OneOff, 'name' | 'at' | 'minutes' | 'size' | 'makeup' | 'team' | 'note' | 'off'>> {
  if (!input || typeof input !== 'object') return fail('Missing the event’s details.');
  const raw = input as Record<string, unknown>;
  const name = cleanLine(raw.name, EVENT_LIMITS.name);
  if (!name) return fail('Give the event a name.');
  const at = Number(raw.at);
  if (!Number.isInteger(at) || at % MINUTE !== 0) return fail('Pick when it starts.');
  if (at !== was && at < now - 60 * MINUTE) return fail('That time has already passed.');
  if (at > now + AHEAD) return fail('Events can be up to a year ahead.');
  const minutes = Number(raw.minutes);
  if (!Number.isInteger(minutes) || minutes % 15 !== 0 || minutes < LIMITS.minLength || minutes > LIMITS.maxLength) {
    return fail('An event runs between 15 minutes and 12 hours.');
  }
  const size = validateRaidSize(raw.size, raw.makeup);
  if (!size.ok) return size;
  const team = raw.team === null || raw.team === undefined || raw.team === '' ? null : String(raw.team);
  if (team !== null && !teamIds.has(team)) return fail('That team doesn’t exist any more.');
  return {
    ok: true,
    value: { name, at, minutes, ...size.value, team, note: cleanLine(raw.note, EVENT_LIMITS.note), off: raw.off === true },
  };
}

/** A raid with nights to sign up for: the poll's own, a team's, or a one-off event. */
export interface RaidOf {
  /** 'raid', a team's id or an event's id: the first half of its event keys. */
  owner: string;
  kind: 'raid' | 'team' | 'event';
  /** The poll's title, the team's name or the event's. */
  name: string;
  /** For an event, its one night as a raid on that date, called off when it's off. */
  raid: Raid;
  mode: Mode;
  /** Who's seated first and how many: a team's, or an event's. Null for the poll's own raid. */
  seats: (Seats & { id: string; name: string }) | null;
  team: Team | null;
  event: OneOff | null;
}

/** An event's one night, as a raid on that date in the poll's zone. */
export function eventRaid(o: OneOff, tz: string): Raid {
  const t = localTime(o.at, tz);
  const night = dateKey(t);
  return { start: `${night}/${t.minutes}`, minutes: o.minutes, skips: o.off ? [night] : [], version: o.version };
}

/** Every raid with nights: the poll's own, then each team's, then the events, soonest first. */
export function raidsOf(
  state: { poll: Pick<PollSettings, 'title' | 'mode' | 'tz'>; raid: Raid | null; teams: Team[]; events: OneOff[] },
  personIds: string[],
): RaidOf[] {
  const out: RaidOf[] = [];
  const { poll } = state;
  if (state.raid) out.push({ owner: POLL_RAID, kind: 'raid', name: poll.title, raid: state.raid, mode: poll.mode, seats: null, team: null, event: null });
  for (const t of state.teams) {
    if (!t.raid) continue;
    out.push({ owner: t.id, kind: 'team', name: t.name, raid: t.raid, mode: poll.mode, seats: t, team: t, event: null });
  }
  for (const o of [...state.events].sort((a, b) => a.at - b.at)) {
    const team = o.team ? (state.teams.find((t) => t.id === o.team) ?? null) : null;
    out.push({
      owner: o.id,
      kind: 'event',
      name: o.name,
      raid: eventRaid(o, poll.tz),
      mode: 'dates',
      // The guild's own event seats everyone alike, first come.
      seats: { id: o.id, name: o.name, members: team ? team.members : personIds, size: o.size, makeup: o.makeup, closed: team?.closed ?? false },
      team,
      event: o,
    });
  }
  return out;
}

/** A raid's coming nights, from any still under way, called-off ones included. */
export function nightsOf(poll: Pick<PollSettings, 'tz'>, r: Pick<RaidOf, 'raid' | 'mode'>, now = Date.now(), count = 4): RaidNight[] {
  return raidNights({ mode: r.mode, tz: poll.tz }, r.raid, now, count);
}

/** Events whose night ended more than a couple of days ago are dropped when the list is next saved. */
export function currentEvents(events: OneOff[], now = Date.now()): OneOff[] {
  return events.filter((o) => o.at + o.minutes * MINUTE > now - 2 * DAY_MINUTES * MINUTE);
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** Which of `names` a word is, written out or cut short to at least three letters ("sat", "thurs", "sept"). */
const nameIn = (names: string[], word: string) => (word.length >= 3 ? names.findIndex((n) => n.startsWith(word)) : -1);

/**
 * A date and a time as people type them in Discord ("sat", "tomorrow", "Dec 12", "12/12", "2026-12-12";
 * "8pm", "8:30 pm", "20:00"), in `zone`: the server's time, which is how a guild says when.
 */
export function parseWhen(dateText: string, timeText: string, zone: string, now = Date.now()): Result<number> {
  const d = dateText.trim().toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ');
  const t0 = today(zone, now);
  // A date with no year is the next one: this year's, or next year's once it's passed.
  const ahead = (m: number, day: number, y?: number): YMD | null => {
    const year = y ?? t0.y;
    const date = parseDate(`${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    if (!date || y !== undefined || compareDates(date, t0) >= 0) return date;
    return parseDate(`${year + 1}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  };
  let date: YMD | null = null;
  let weekday = false;
  let m: RegExpMatchArray | null;
  if (d === 'today' || d === 'tonight') date = t0;
  else if (d === 'tomorrow') date = addDays(t0, 1);
  else if (nameIn(WEEKDAYS, d) >= 0) {
    weekday = true;
    date = addDays(t0, (nameIn(WEEKDAYS, d) - weekdayOf(t0) + 7) % 7);
  } else if ((m = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) date = ahead(Number(m[2]), Number(m[3]), Number(m[1]));
  else if ((m = d.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    date = ahead(Number(m[1]), Number(m[2]), y);
  } else if ((m = d.match(/^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/)) && nameIn(MONTHS, m[1]) >= 0) {
    date = ahead(nameIn(MONTHS, m[1]) + 1, Number(m[2]), m[3] ? Number(m[3]) : undefined);
  } else if ((m = d.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{4}))?$/)) && nameIn(MONTHS, m[2]) >= 0) {
    date = ahead(nameIn(MONTHS, m[2]) + 1, Number(m[1]), m[3] ? Number(m[3]) : undefined);
  }
  if (!date) return fail(`muster can’t read “${dateText.trim()}” as a date. Try “sat”, “Dec 12” or “2026-12-12”.`);

  const tm = timeText.trim().toLowerCase().replace(/\s+/g, '').match(/^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/);
  if (!tm) return fail(`muster can’t read “${timeText.trim()}” as a time. Try “8pm” or “20:00”.`);
  let hour = Number(tm[1]);
  const minute = Number(tm[2] ?? 0);
  const half = tm[3]?.[0];
  if (minute > 59 || (half ? hour < 1 || hour > 12 : hour > 23)) return fail(`“${timeText.trim()}” isn’t a time of day.`);
  if (half === 'p' && hour < 12) hour += 12;
  if (half === 'a' && hour === 12) hour = 0;
  // "sat 2pm" said on a Saturday afternoon means next Saturday.
  if (weekday && zonedInstant(date, hour * 60 + minute, zone) < now) date = addDays(date, 7);
  const at = zonedInstant(date, hour * 60 + minute, zone);
  if (localTime(at, zone).minutes !== hour * 60 + minute) return fail(`${timeText.trim()} doesn’t happen that night: the clocks go forward.`);
  return { ok: true, value: at };
}
