// Time-zone arithmetic with Intl alone: no library, and the same code runs in the browser, in Node
// (the tests) and in the Worker.

export interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

export const MINUTE = 60_000;
export const DAY_MINUTES = 1440;

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    partsFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Minutes to add to UTC to get local wall time in `tz` at `instant`. */
export function tzOffset(instant: number, tz: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  const parts = partsFormatter(tz).formatToParts(new Date(whole));
  let y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0;
  for (const p of parts) {
    switch (p.type) {
      case 'year': y = Number(p.value); break;
      case 'month': mo = Number(p.value); break;
      case 'day': d = Number(p.value); break;
      case 'hour': h = Number(p.value) % 24; break;
      case 'minute': mi = Number(p.value); break;
      case 'second': s = Number(p.value); break;
    }
  }
  return Math.round((Date.UTC(y, mo - 1, d, h, mi, s) - whole) / MINUTE);
}

/** The instant of local wall time `minutes` after midnight on `date` in `tz`. Minutes may run past
 *  1440 (into the next day). A time skipped by a daylight-saving change lands an hour later. */
export function zonedInstant(date: YMD, minutes: number, tz: string): number {
  const local = Date.UTC(date.y, date.m - 1, date.d) + minutes * MINUTE;
  const first = local - tzOffset(local, tz) * MINUTE;
  return local - tzOffset(first, tz) * MINUTE;
}

export interface LocalTime extends YMD {
  weekday: number; // 0 = Sunday
  minutes: number; // after local midnight
}

export function localTime(instant: number, tz: string): LocalTime {
  const shifted = new Date(instant + tzOffset(instant, tz) * MINUTE);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

export function parseDate(key: string): YMD | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export function dateKey(date: YMD): string {
  return `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
}

export function addDays(date: YMD, days: number): YMD {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function weekdayOf(date: YMD): number {
  return new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
}

export function compareDates(a: YMD, b: YMD): number {
  return Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d);
}

/** Today's date in `tz`. */
export function today(tz: string, now = Date.now()): YMD {
  const t = localTime(now, tz);
  return { y: t.y, m: t.m, d: t.d };
}

/** The window's length in minutes: an end at or before the start runs past midnight. */
export function windowLength(start: number, end: number): number {
  return ((end - start + DAY_MINUTES) % DAY_MINUTES) || DAY_MINUTES;
}
