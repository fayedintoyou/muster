import type { PollSettings } from './types';
import { parseSlotKey } from './slots';
import { MINUTE, addDays, parseDate, today, weekdayOf, zonedInstant } from './time';

/** When a slot next happens: the date itself for a dates poll; the next such weekday for a weekly one
 *  (counting from the poll's own today, in its own time zone, so daylight saving is right). */
export function nextOccurrence(
  settings: Pick<PollSettings, 'mode' | 'tz'>,
  key: string,
  now = Date.now(),
): number | null {
  const parsed = parseSlotKey(key);
  if (!parsed) return null;
  if (settings.mode === 'dates') {
    const date = parseDate(parsed.day);
    return date ? zonedInstant(date, parsed.minute, settings.tz) : null;
  }
  const weekday = Number(parsed.day.slice(1));
  const t = today(settings.tz, now);
  for (let k = -1; k <= 14; k++) {
    const date = addDays(t, k);
    if (weekdayOf(date) !== weekday) continue;
    const at = zonedInstant(date, parsed.minute, settings.tz);
    if (at >= now - 5 * MINUTE) return at;
  }
  return null;
}

/** Discord renders <t:…> in each reader's own time zone. */
export function discordTimestamps(title: string, start: number, end: number): string {
  const s = Math.floor(start / 1000);
  const e = Math.floor(end / 1000);
  return `**${title.replace(/[*_~`|]/g, '')}** · <t:${s}:F> – <t:${e}:t> (<t:${s}:R>)`;
}
