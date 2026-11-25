import type { Marks, Mode, PollSettings, SlotSize } from './types';
import { WEEK_ORDER, slotKeys } from './slots';
import { addDays, compareDates, dateKey, isValidTimeZone, parseDate, today, windowLength } from './time';

// One set of rules for the Worker (which enforces them) and the page (which explains them early).

export const LIMITS = {
  title: 80,
  notes: 600,
  dates: 31,
  slots: 1000,
  roles: 6,
  role: 16,
  name: 32,
  spec: 40,
  note: 200,
  password: 64,
  people: 150,
  minLength: 15,
  maxLength: 720,
} as const;

export const SLOT_SIZES: SlotSize[] = [15, 30, 60];

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
}

/** Single-line text with runs of whitespace collapsed. */
export function cleanLine(value: unknown, max: number): string {
  return cleanText(value, max * 2).replace(/\s+/g, ' ').slice(0, max).trim();
}

export function nameKey(name: string): string {
  return name.normalize('NFKC').toLocaleLowerCase('en-US');
}

export function cleanRoles(value: unknown): Result<string[]> {
  if (value === undefined || value === null) return ok([]);
  if (!Array.isArray(value)) return fail('Roles must be a list.');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const role = cleanLine(raw, LIMITS.role).toLocaleLowerCase('en-US');
    if (!role) continue;
    if (seen.has(role)) continue;
    seen.add(role);
    out.push(role);
  }
  if (out.length > LIMITS.roles) return fail(`At most ${LIMITS.roles} roles.`);
  return ok(out);
}

/** Checks a whole poll definition. `now` bounds how far back or ahead dates may be. */
export function validateSettings(input: unknown, now = Date.now()): Result<PollSettings> {
  if (!input || typeof input !== 'object') return fail('Missing poll details.');
  const raw = input as Record<string, unknown>;

  const title = cleanLine(raw.title, LIMITS.title);
  if (!title) return fail('Give the poll a name.');
  const notes = cleanText(raw.notes, LIMITS.notes);

  const mode = raw.mode as Mode;
  if (mode !== 'weekly' && mode !== 'dates') return fail('Pick weekly or specific dates.');

  const tz = raw.tz;
  if (!isValidTimeZone(tz)) return fail('Unknown time zone.');

  const slot = Number(raw.slot) as SlotSize;
  if (!SLOT_SIZES.includes(slot)) return fail('Slots are 15, 30 or 60 minutes.');

  const start = Number(raw.start);
  const end = Number(raw.end);
  for (const t of [start, end]) {
    if (!Number.isInteger(t) || t < 0 || t >= 1440 || t % slot !== 0) {
      return fail(`Start and end times must fall on the ${slot}-minute grid.`);
    }
  }

  if (!Array.isArray(raw.days) || raw.days.length === 0) {
    return fail(mode === 'weekly' ? 'Pick at least one day of the week.' : 'Pick at least one date.');
  }
  let days: string[];
  if (mode === 'weekly') {
    const chosen = new Set(raw.days.filter((d): d is string => typeof d === 'string'));
    days = WEEK_ORDER.filter((d) => chosen.has(d));
    if (days.length !== chosen.size || days.length === 0) return fail('Unknown day of the week.');
  } else {
    const parsed = [];
    const seen = new Set<string>();
    for (const d of raw.days) {
      const date = typeof d === 'string' ? parseDate(d) : null;
      if (!date) return fail('Unknown date.');
      const key = dateKey(date);
      if (seen.has(key)) continue;
      seen.add(key);
      parsed.push(date);
    }
    if (parsed.length > LIMITS.dates) return fail(`At most ${LIMITS.dates} dates.`);
    const t = today(tz, now);
    const earliest = addDays(t, -400);
    const latest = addDays(t, 800);
    if (parsed.some((d) => compareDates(d, earliest) < 0 || compareDates(d, latest) > 0)) {
      return fail('Dates must be within about two years of today.');
    }
    parsed.sort(compareDates);
    days = parsed.map(dateKey);
  }

  if (windowLength(start, end) < slot) return fail('The time window is shorter than one slot.');
  if (slotKeys({ days, start, end, slot }).length > LIMITS.slots) {
    return fail('That is a lot of slots: pick fewer days, a shorter window or bigger slots.');
  }

  const roles = cleanRoles(raw.roles);
  if (!roles.ok) return roles;

  let length = Number(raw.length);
  if (!Number.isFinite(length)) length = 180;
  length = Math.round(length / 15) * 15;
  if (length < LIMITS.minLength || length > LIMITS.maxLength) {
    return fail('Raid length must be between 15 minutes and 12 hours.');
  }

  return ok({ title, notes, mode, days, start, end, slot, tz, roles: roles.value, length });
}

export function validateName(input: unknown): Result<string> {
  const name = cleanLine(input, LIMITS.name);
  if (!name) return fail('Enter a name.');
  return ok(name);
}

export function validatePassword(input: unknown): Result<string> {
  if (input === undefined || input === null || input === '') return ok('');
  if (typeof input !== 'string') return fail('Password must be text.');
  if (input.length > LIMITS.password) return fail(`Passwords are at most ${LIMITS.password} characters.`);
  return ok(input);
}

/** Keeps only marks for slots the poll has, with a known value. */
export function cleanMarks(input: unknown, validKeys: ReadonlySet<string>): Result<Marks> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('Availability must be an object.');
  const out: Marks = {};
  let n = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (++n > LIMITS.slots * 2) return fail('Too many slots.');
    if (!validKeys.has(key)) continue;
    if (value === 1 || value === 2) out[key] = value;
  }
  return ok(out);
}

/** A person's class, spec or anything else they'd like next to their name. Optional. */
export function cleanSpec(input: unknown): string {
  return cleanLine(input, LIMITS.spec);
}

/** A person's note to the organizer. Optional; line breaks are kept. */
export function cleanNote(input: unknown): string {
  return cleanText(input, LIMITS.note);
}

/** Roles a person picked, kept to the poll's own. */
export function cleanPersonRoles(input: unknown, pollRoles: string[]): string[] {
  const r = cleanRoles(input);
  if (!r.ok) return [];
  return r.value.filter((role) => pollRoles.includes(role));
}
