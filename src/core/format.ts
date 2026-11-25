import { DAY_MINUTES, type YMD, localTime } from './time';

// Labels in the reader's own conventions (12- or 24-hour clock, month names), from Intl.

let cachedHour12: boolean | undefined;
export function prefersHour12(): boolean {
  if (cachedHour12 === undefined) {
    const cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
    cachedHour12 = cycle === 'h11' || cycle === 'h12';
  }
  return cachedHour12;
}

/** 8pm, 8:30pm, or 20:00 — for minutes after a midnight (wrapping past 1440). */
export function formatMinute(minute: number, h12 = prefersHour12(), compact = true): string {
  const m = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (!h12) return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const suffix = h < 12 ? 'am' : 'pm';
  const hh = h % 12 || 12;
  if (compact && mm === 0) return `${hh}${suffix}`;
  return `${hh}:${String(mm).padStart(2, '0')}${suffix}`;
}

export function formatTime(instant: number, tz: string, h12 = prefersHour12()): string {
  return formatMinute(localTime(instant, tz).minutes, h12);
}

/** "8–11pm", "11pm–2am", "20:00–23:00". */
export function formatRange(start: number, end: number, tz: string, h12 = prefersHour12()): string {
  const a = localTime(start, tz).minutes;
  const b = localTime(end, tz).minutes;
  if (h12 && (a < 720) === (b < 720) && b > a) {
    return `${formatMinute(a, true).replace(/am|pm/, '')}–${formatMinute(b, true)}`;
  }
  return `${formatMinute(a, h12)}–${formatMinute(b, h12)}`;
}

const weekdayFormats = new Map<string, Intl.DateTimeFormat>();
export function weekdayName(weekday: number, style: 'short' | 'long' = 'short'): string {
  let f = weekdayFormats.get(style);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, { weekday: style, timeZone: 'UTC' });
    weekdayFormats.set(style, f);
  }
  // 2023-01-01 was a Sunday.
  return f.format(new Date(Date.UTC(2023, 0, 1 + weekday)));
}

export function formatDate(date: YMD, style: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat(undefined, {
    month: style === 'short' ? 'short' : 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(date.y, date.m - 1, date.d)));
}

/** "Eastern Standard Time", from the zone as it is at `instant`. */
export function zoneName(tz: string, instant = Date.now(), style: 'long' | 'short' = 'long'): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: style }).formatToParts(
      new Date(instant),
    );
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
  } catch {
    return tz;
  }
}

/** "New York" from "America/New_York". */
export function zoneCity(tz: string): string {
  const last = tz.split('/').pop() ?? tz;
  return last.replace(/_/g, ' ');
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
