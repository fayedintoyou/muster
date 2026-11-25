import type { PollSettings } from './types';
import { windowLength } from './time';

// A slot's key names its column and its start in the poll's own local minutes after that column's
// midnight (past 1440 for a window that runs past midnight): 'w2/1260' is Tuesday 9pm, 'w2/1470' the
// half hour after midnight that ends Tuesday night. Keys stay put when the window grows or shrinks, so
// editing a poll keeps everyone's answers for the times still in it.

export const WEEKDAY_KEYS = ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6'] as const;

/** Monday first: the order weekly columns run in. */
export const WEEK_ORDER = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w0'] as const;

export function slotKey(day: string, minute: number): string {
  return `${day}/${minute}`;
}

export function parseSlotKey(key: string): { day: string; minute: number } | null {
  const i = key.indexOf('/');
  if (i < 0) return null;
  const minute = Number(key.slice(i + 1));
  if (!Number.isInteger(minute)) return null;
  return { day: key.slice(0, i), minute };
}

/** The minutes (poll-local, after the column's midnight) at which each slot of a column starts. */
export function slotMinutes(settings: Pick<PollSettings, 'start' | 'end' | 'slot'>): number[] {
  const len = windowLength(settings.start, settings.end);
  const out: number[] = [];
  for (let m = settings.start; m < settings.start + len; m += settings.slot) out.push(m);
  return out;
}

export function slotKeys(settings: Pick<PollSettings, 'days' | 'start' | 'end' | 'slot'>): string[] {
  const minutes = slotMinutes(settings);
  const keys: string[] = [];
  for (const day of settings.days) for (const m of minutes) keys.push(slotKey(day, m));
  return keys;
}
