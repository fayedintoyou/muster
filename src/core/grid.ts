import type { PollSettings } from './types';
import { WEEK_ORDER, slotKey, slotMinutes } from './slots';
import {
  DAY_MINUTES,
  MINUTE,
  type YMD,
  addDays,
  localTime,
  parseDate,
  today,
  weekdayOf,
  zonedInstant,
} from './time';

// The grid a viewer sees: the poll's columns ("nights") in the viewer's own time zone. A column keeps
// its slots together even when they cross the viewer's midnight, so a raid night stays one column.

export interface GridSlot {
  key: string;
  /** When the slot starts. */
  instant: number;
  col: number;
  row: number;
  /** Index within its column. */
  index: number;
}

export interface GridColumn {
  /** The poll's key for this column: 'w2' or '2026-12-01'. */
  day: string;
  /** The viewer-local date the column is labelled with: the date of the night it belongs to. */
  date: YMD;
  weekday: number;
  slots: GridSlot[];
}

export interface GridRow {
  /** Viewer-local minutes after the column date's midnight; 1440 and later fall on the next day. */
  minute: number;
}

export interface Grid {
  mode: PollSettings['mode'];
  tz: string;
  slotMinutes: number;
  columns: GridColumn[];
  rows: GridRow[];
  /** cells[row][col]: the slot shown there, or null where that column has none. */
  cells: (GridSlot | null)[][];
  byKey: Map<string, GridSlot>;
}

/** The poll-local date each column stands for. Weekly polls use the current week, Monday first, so
 *  daylight-saving offsets are today's. */
export function columnDates(settings: Pick<PollSettings, 'mode' | 'days' | 'tz'>, now = Date.now()): YMD[] {
  if (settings.mode === 'dates') {
    return settings.days.map((d) => parseDate(d) ?? { y: 1970, m: 1, d: 1 });
  }
  const t = today(settings.tz, now);
  const monday = addDays(t, -((weekdayOf(t) + 6) % 7));
  return settings.days.map((d) => addDays(monday, WEEK_ORDER.indexOf(d as (typeof WEEK_ORDER)[number])));
}

export function buildGrid(settings: PollSettings, viewerTz: string, now = Date.now()): Grid {
  const minutes = slotMinutes(settings);
  const dates = columnDates(settings, now);
  const columns: GridColumn[] = [];
  const localMinute = new Map<GridSlot, number>();
  const rowMinutes = new Set<number>();
  let reference = 0;

  settings.days.forEach((day, col) => {
    const first = zonedInstant(dates[col], settings.start, settings.tz);
    const local = localTime(first, viewerTz);
    let date: YMD = { y: local.y, m: local.m, d: local.d };
    let startMinute = local.minutes;
    if (col === 0) {
      reference = startMinute;
    } else {
      // Keep every column's rows lined up with the first's when a daylight-saving change falls between
      // them: label the column by the neighbouring date if that puts its start closer.
      for (const shift of [-1, 1]) {
        const candidate = startMinute - shift * DAY_MINUTES;
        if (Math.abs(candidate - reference) < Math.abs(startMinute - reference)) {
          startMinute = candidate;
          date = addDays(date, shift);
        }
      }
    }
    const slots = minutes.map((m, index): GridSlot => {
      const offset = m - settings.start;
      const slot = { key: slotKey(day, m), instant: first + offset * MINUTE, col, row: -1, index };
      localMinute.set(slot, startMinute + offset);
      rowMinutes.add(startMinute + offset);
      return slot;
    });
    columns.push({ day, date, weekday: weekdayOf(date), slots });
  });

  const rows = [...rowMinutes].sort((a, b) => a - b).map((minute) => ({ minute }));
  const rowIndex = new Map(rows.map((r, i) => [r.minute, i]));
  const cells: (GridSlot | null)[][] = rows.map(() => columns.map(() => null));
  const byKey = new Map<string, GridSlot>();
  for (const column of columns) {
    for (const slot of column.slots) {
      slot.row = rowIndex.get(localMinute.get(slot)!)!;
      cells[slot.row][slot.col] = slot;
      byKey.set(slot.key, slot);
    }
  }

  return { mode: settings.mode, tz: viewerTz, slotMinutes: settings.slot, columns, rows, cells, byKey };
}
