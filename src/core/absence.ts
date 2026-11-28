import { type Result, cleanLine } from './validate';
import { addDays, compareDates, dateKey, parseDate, type YMD } from './time';

// Dated absences: "out December 22 to January 2". One stays on the person, not on a raid, so it covers
// every raid night in its span, the poll's and every team's, without them tapping anything. Dates are
// raid nights' own dates (the poll's time zone), and both ends count.
//
// Only organizers and the person themselves see one: to everyone else, someone away hasn't answered.

export interface Absence {
  /** First night away, YYYY-MM-DD. */
  from: string;
  /** Last night away, YYYY-MM-DD: the same as `from` for one night. */
  to: string;
  /** A short reason or detail, such as "family, back the 3rd". Empty when not given. */
  note: string;
}

export const ABSENCE_LIMITS = {
  absences: 12,
  /** The longest one, counting both ends. */
  days: 60,
  note: 60,
  /** How far ahead one can start. */
  ahead: 366,
} as const;

/** Nights from `from` to `to`, both counted. */
export function spanDays(from: YMD, to: YMD): number {
  return Math.round(compareDates(to, from) / 86_400_000) + 1;
}

/** The absence covering this night ('YYYY-MM-DD'), if any. */
export function awayOn(absences: readonly Absence[] | undefined, night: string): Absence | undefined {
  return absences?.find((a) => a.from <= night && night <= a.to);
}

/** Absences that haven't ended before `today`, which is all anyone needs to see or keep. */
export function currentAbsences(absences: readonly Absence[] | undefined, today: YMD): Absence[] {
  const from = dateKey(today);
  return (absences ?? []).filter((a) => a.to >= from);
}

/**
 * Someone's whole list of absences, checked: real dates in order, each at most 60 nights, starting within
 * a year, and at most 12. Ones already over by `today` are dropped, so they never count towards the 12.
 */
export function validateAbsences(input: unknown, today: YMD): Result<Absence[]> {
  if (!Array.isArray(input)) return { ok: false, error: 'The absences must be a list.' };
  const out: Absence[] = [];
  const last = addDays(today, ABSENCE_LIMITS.ahead);
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Missing an absence’s dates.' };
    const { from: f, to: t, note: n } = raw as Record<string, unknown>;
    const from = typeof f === 'string' ? parseDate(f) : null;
    const to = typeof t === 'string' ? parseDate(t) : null;
    if (!from || !to) return { ok: false, error: 'Give each absence a first and last night.' };
    if (compareDates(to, from) < 0) return { ok: false, error: 'An absence’s last night can’t be before its first.' };
    if (spanDays(from, to) > ABSENCE_LIMITS.days) {
      return { ok: false, error: `An absence can be at most ${ABSENCE_LIMITS.days} days. Add another for longer.` };
    }
    if (compareDates(from, last) > 0) return { ok: false, error: 'An absence can start at most a year ahead.' };
    if (compareDates(to, today) < 0) continue;
    out.push({ from: dateKey(from), to: dateKey(to), note: cleanLine(n, ABSENCE_LIMITS.note) });
  }
  if (out.length > ABSENCE_LIMITS.absences) return { ok: false, error: `At most ${ABSENCE_LIMITS.absences} absences.` };
  return { ok: true, value: out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)) };
}
