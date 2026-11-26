import type { Poll, PollSettings } from './types';
import { parseSlotKey, slotKeys } from './slots';
import { LIMITS, type Result } from './validate';
import { MINUTE, addDays, dateKey, localTime, parseDate, today, weekdayOf, zonedInstant } from './time';

// A locked-in raid: the time the organizer picked from best times. A weekly poll's raid repeats every
// week on that night; a dates poll's happens once. Single nights can be called off.

export interface Raid {
  /** The slot it starts at, a poll slot key such as 'w4/1200' or '2026-12-09/1200'. */
  start: string;
  /** How long it runs. */
  minutes: number;
  /** Nights called off, by the date of the night in the poll's zone, such as '2026-12-17'. */
  skips: string[];
  /** Goes up with every change, so calendars know to update. */
  version: number;
}

export interface RaidNight {
  /** The night's date in the poll's zone ('2026-12-10'), even when the raid starts after midnight. */
  night: string;
  start: number;
  end: number;
  off: boolean;
}

const fail = (error: string): Result<never> => ({ ok: false, error });

export function validateRaid(
  input: unknown,
  poll: Pick<PollSettings, 'days' | 'start' | 'end' | 'slot'>,
): Result<Omit<Raid, 'version'>> {
  if (!input || typeof input !== 'object') return fail('Missing the raid’s time.');
  const raw = input as Record<string, unknown>;
  const start = raw.start;
  if (typeof start !== 'string' || !slotKeys(poll).includes(start)) return fail('Pick a time from the poll.');
  const minutes = Number(raw.minutes);
  if (!Number.isInteger(minutes) || minutes % 15 !== 0 || minutes < LIMITS.minLength || minutes > LIMITS.maxLength) {
    return fail('A raid runs between 15 minutes and 12 hours.');
  }
  const skips = raw.skips === undefined ? [] : raw.skips;
  if (!Array.isArray(skips) || skips.length > 60 || !skips.every((d) => typeof d === 'string' && parseDate(d))) {
    return fail('Unknown night to call off.');
  }
  return { ok: true, value: { start, minutes, skips: [...new Set(skips as string[])].sort() } };
}

/** The raid's next nights, from any still under way, called-off ones included. */
export function raidNights(
  poll: Pick<PollSettings, 'mode' | 'tz'>,
  raid: Pick<Raid, 'start' | 'minutes' | 'skips'>,
  now = Date.now(),
  count = 4,
): RaidNight[] {
  const parsed = parseSlotKey(raid.start);
  if (!parsed) return [];
  const night = (date: { y: number; m: number; d: number }): RaidNight => {
    const start = zonedInstant(date, parsed.minute, poll.tz);
    const key = dateKey(date);
    return { night: key, start, end: start + raid.minutes * MINUTE, off: raid.skips.includes(key) };
  };
  if (poll.mode === 'dates') {
    const date = parseDate(parsed.day);
    if (!date) return [];
    const one = night(date);
    return one.end >= now ? [one] : [];
  }
  const weekday = Number(parsed.day.slice(1));
  const out: RaidNight[] = [];
  const t = today(poll.tz, now);
  for (let k = -2; out.length < count && k < count * 7 + 7; k++) {
    const date = addDays(t, k);
    if (weekdayOf(date) !== weekday) continue;
    const n = night(date);
    if (n.end >= now) out.push(n);
  }
  return out;
}

/** The next night that's on. */
export function nextRaid(poll: Pick<PollSettings, 'mode' | 'tz'>, raid: Raid, now = Date.now()): RaidNight | null {
  return raidNights(poll, raid, now, 12).find((n) => !n.off) ?? null;
}

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
const pad = (n: number) => String(n).padStart(2, '0');

function icsLocal(instant: number, tz: string): string {
  const t = localTime(instant, tz);
  return `${t.y}${pad(t.m)}${pad(t.d)}T${pad(Math.floor(t.minutes / 60))}${pad(t.minutes % 60)}00`;
}

function icsUtc(instant: number): string {
  return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * A calendar file for the raid: weekly with called-off nights left out, or a single night. Times stay in
 * the poll's named zone, so the hour doesn't slip when daylight saving changes.
 */
export function raidCalendar(poll: Pick<Poll, 'id' | 'title' | 'mode' | 'tz'>, raid: Raid, url: string, now = Date.now()): string {
  const nights = raidNights(poll, raid, now, 1);
  const first = nights[0];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//muster//raid//EN', 'CALSCALE:GREGORIAN'];
  if (first) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${poll.id}-raid@muster.fayelore.com`,
      `SEQUENCE:${raid.version}`,
      `DTSTAMP:${icsUtc(now)}`,
      `DTSTART;TZID=${poll.tz}:${icsLocal(first.start, poll.tz)}`,
      `DURATION:PT${raid.minutes}M`,
      `SUMMARY:${icsText(poll.title)}`,
      `URL:${url}`,
      `DESCRIPTION:${icsText(`Sign-ups and changes: ${url}`)}`,
    );
    if (poll.mode === 'weekly') {
      lines.push('RRULE:FREQ=WEEKLY');
      const minute = parseSlotKey(raid.start)?.minute ?? 0;
      for (const skip of raid.skips) {
        const date = parseDate(skip);
        if (date) lines.push(`EXDATE;TZID=${poll.tz}:${icsLocal(zonedInstant(date, minute, poll.tz), poll.tz)}`);
      }
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
