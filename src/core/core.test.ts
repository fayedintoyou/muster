import { describe, expect, it } from 'vitest';
import { bestWindows, tallySlots } from './best';
import { buildGrid } from './grid';
import { nextOccurrence, discordTimestamps } from './occurrence';
import { slotKeys } from './slots';
import { localTime, tzOffset, windowLength, zonedInstant } from './time';
import { formatMinute, formatRange } from './format';
import { cleanMarks, validateSettings } from './validate';
import type { Person, PollSettings } from './types';

const NY = 'America/New_York';
const weekly: PollSettings = {
  title: 'Raid nights',
  notes: '',
  mode: 'weekly',
  days: ['w2', 'w4'],
  start: 20 * 60,
  end: 60,
  slot: 30,
  tz: NY,
  roles: ['tank', 'healer', 'dps'],
  length: 90,
};
// Wednesday 25 November 2026, 00:37 in New York.
const NOW = Date.UTC(2026, 10, 25, 5, 37);

function person(id: string, marks: Record<string, 1 | 2>, roles: string[] = []): Person {
  return { id, name: id, roles, spec: '', marks, hasPassword: false, updated: 0 };
}

describe('time', () => {
  it('knows daylight saving offsets', () => {
    expect(tzOffset(Date.UTC(2026, 0, 15, 12), NY)).toBe(-300);
    expect(tzOffset(Date.UTC(2026, 6, 15, 12), NY)).toBe(-240);
    expect(tzOffset(Date.UTC(2026, 6, 15, 12), 'Asia/Kolkata')).toBe(330);
  });

  it('turns local wall time into instants and back', () => {
    const at = zonedInstant({ y: 2026, m: 12, d: 1 }, 20 * 60, NY);
    expect(new Date(at).toISOString()).toBe('2026-12-02T01:00:00.000Z');
    const past = zonedInstant({ y: 2026, m: 12, d: 1 }, 24 * 60 + 30, NY);
    expect(new Date(past).toISOString()).toBe('2026-12-02T05:30:00.000Z');
    expect(localTime(at, 'Europe/Berlin')).toMatchObject({ y: 2026, m: 12, d: 2, minutes: 120, weekday: 3 });
  });

  it('treats an end at or before the start as running past midnight', () => {
    expect(windowLength(1200, 60)).toBe(300);
    expect(windowLength(1080, 1320)).toBe(240);
    expect(windowLength(600, 600)).toBe(1440);
  });
});

describe('slots', () => {
  it('keys each slot by its night and poll-local minute', () => {
    const keys = slotKeys(weekly);
    expect(keys).toHaveLength(20);
    expect(keys.slice(0, 3)).toEqual(['w2/1200', 'w2/1230', 'w2/1260']);
    expect(keys[9]).toBe('w2/1470');
  });
});

describe('grid', () => {
  it('keeps a night that crosses midnight in one column', () => {
    const grid = buildGrid(weekly, NY, NOW);
    expect(grid.columns.map((c) => c.weekday)).toEqual([2, 4]);
    expect(grid.rows.map((r) => r.minute)).toEqual([1200, 1230, 1260, 1290, 1320, 1350, 1380, 1410, 1440, 1470]);
    expect(grid.cells[8][0]?.key).toBe('w2/1440');
  });

  it('shows the same night in another time zone', () => {
    const berlin = buildGrid(weekly, 'Europe/Berlin', NOW);
    expect(berlin.columns.map((c) => c.weekday)).toEqual([3, 5]);
    expect(berlin.rows[0].minute).toBe(120);
    const la = buildGrid(weekly, 'America/Los_Angeles', NOW);
    expect(la.columns.map((c) => c.weekday)).toEqual([2, 4]);
    expect(la.rows.map((r) => r.minute)).toEqual([1020, 1050, 1080, 1110, 1140, 1170, 1200, 1230, 1260, 1290]);
  });

  it('lines rows up across a daylight-saving change between dates', () => {
    const poll: PollSettings = { ...weekly, mode: 'dates', days: ['2026-10-31', '2026-11-02'] };
    const london = buildGrid(poll, 'Europe/London', NOW);
    expect(london.columns.map((c) => [c.date.m, c.date.d])).toEqual([[11, 1], [11, 3]]);
    expect(london.rows[0].minute).toBe(0);
    expect(london.rows).toHaveLength(12);
    expect(london.cells[0][1]).toBeNull();
    expect(london.cells[2][1]?.key).toBe('2026-11-02/1200');
    expect(london.cells[11][0]).toBeNull();
  });
});

describe('best windows', () => {
  const grid = buildGrid(weekly, NY, NOW);
  const tue = (h: number, m = 0) => `w2/${h * 60 + m}`;
  const thu = (h: number, m = 0) => `w4/${h * 60 + m}`;
  const fill = (keys: string[], mark: 1 | 2 = 2) => Object.fromEntries(keys.map((k) => [k, mark]));
  const tueEvening = [tue(20), tue(20, 30), tue(21), tue(21, 30), tue(22), tue(22, 30)];
  const thuLate = [thu(21), thu(21, 30), thu(22), thu(22, 30), thu(23), thu(23, 30), thu(24), thu(24, 30)];

  const people = [
    person('ana', { ...fill(tueEvening), ...fill(thuLate) }, ['tank']),
    person('bo', { ...fill(tueEvening.slice(1)), ...fill(thuLate, 1) }, ['healer']),
    person('cy', fill(thuLate.slice(0, 4)), ['dps', 'healer']),
  ];

  it('counts who is free in each slot', () => {
    const t = tallySlots(grid, people);
    expect(t.get(tue(20, 30))).toEqual({ yes: ['ana', 'bo'], maybe: [] });
    expect(t.get(thu(22))).toEqual({ yes: ['ana', 'cy'], maybe: ['bo'] });
  });

  it('ranks the windows the most people can make, with who is missing', () => {
    const result = bestWindows(grid, { length: 90, people, roles: weekly.roles });
    const top = result.candidates[0];
    expect(top.col).toBe(1);
    expect(top.attend).toEqual(['ana', 'bo', 'cy']);
    expect(top.yes).toEqual(['ana', 'cy']);
    expect(grid.columns[1].slots[top.first].key).toBe(thu(21));
    expect(grid.columns[1].slots[top.last].key).toBe(thu(21, 30));
    expect(top.roles).toEqual({ tank: 1, healer: 2, dps: 1 });
    const second = result.candidates.find((c) => c.col === 0)!;
    expect(second.attend).toEqual(['ana', 'bo']);
    expect(second.missing).toEqual(['cy']);
  });

  it('only offers windows that include required people', () => {
    const result = bestWindows(grid, { length: 120, people, required: new Set(['cy']) });
    expect(result.candidates.every((c) => c.attend.includes('cy'))).toBe(true);
    const none = bestWindows(grid, { length: 180, people, required: new Set(['cy']) });
    expect(none.candidates).toEqual([]);
    expect(none.requiredUnmet).toBe(true);
  });

  it('notes people who can make part of a window', () => {
    const result = bestWindows(grid, { length: 120, people });
    const tueBest = result.candidates.find((c) => c.col === 0)!;
    expect(tueBest.attend).toContain('ana');
    expect(tueBest.missing.length + tueBest.attend.length).toBe(3);
  });

  it('cuts the window down to a whole night when the raid runs longer', () => {
    const result = bestWindows(grid, { length: 600, people });
    expect(result.clamped).toBe(true);
    expect(result.span).toBe(10);
  });
});

describe('occurrences', () => {
  it('finds the next Tuesday for a weekly slot, after midnight included', () => {
    expect(new Date(nextOccurrence(weekly, 'w2/1200', NOW)!).toISOString()).toBe('2026-12-02T01:00:00.000Z');
    expect(new Date(nextOccurrence(weekly, 'w2/1470', NOW)!).toISOString()).toBe('2026-12-02T05:30:00.000Z');
    expect(new Date(nextOccurrence(weekly, 'w4/1200', NOW)!).toISOString()).toBe('2026-11-27T01:00:00.000Z');
  });

  it('writes Discord timestamps', () => {
    expect(discordTimestamps('Raid *night*', 1_764_637_200_000, 1_764_648_000_000)).toBe(
      '**Raid night** · <t:1764637200:F> – <t:1764648000:t> (<t:1764637200:R>)',
    );
  });
});

describe('format', () => {
  it('writes compact times', () => {
    expect(formatMinute(1200, true)).toBe('8pm');
    expect(formatMinute(1470, true)).toBe('12:30am');
    expect(formatMinute(1470, false)).toBe('00:30');
    const at = zonedInstant({ y: 2026, m: 12, d: 1 }, 20 * 60, NY);
    expect(formatRange(at, at + 3 * 3600_000, NY, true)).toBe('8–11pm');
    expect(formatRange(at + 3 * 3600_000, at + 6 * 3600_000, NY, true)).toBe('11pm–2am');
  });
});

describe('validation', () => {
  it('accepts a weekly poll and orders its days Monday first', () => {
    const r = validateSettings({ ...weekly, days: ['w0', 'w4', 'w2'] }, NOW);
    expect(r.ok && r.value.days).toEqual(['w2', 'w4', 'w0']);
  });

  it('sorts and dedupes dates', () => {
    const r = validateSettings({ ...weekly, mode: 'dates', days: ['2026-12-03', '2026-12-01', '2026-12-03'] }, NOW);
    expect(r.ok && r.value.days).toEqual(['2026-12-01', '2026-12-03']);
  });

  it('refuses what it cannot schedule', () => {
    expect(validateSettings({ ...weekly, tz: 'Mars/Olympus' }, NOW).ok).toBe(false);
    expect(validateSettings({ ...weekly, start: 1205 }, NOW).ok).toBe(false);
    expect(validateSettings({ ...weekly, title: '  ' }, NOW).ok).toBe(false);
    const many = Array.from({ length: 31 }, (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`);
    expect(validateSettings({ ...weekly, mode: 'dates', days: many, slot: 15, start: 0, end: 0 }, NOW).ok).toBe(false);
    expect(validateSettings({ ...weekly, mode: 'dates', days: ['2031-01-01'] }, NOW).ok).toBe(false);
  });

  it('keeps only marks for the poll’s slots', () => {
    const keys = new Set(slotKeys(weekly));
    const r = cleanMarks({ 'w2/1200': 2, 'w2/1230': 1, 'w3/1200': 2, 'w2/1260': 5 }, keys);
    expect(r.ok && r.value).toEqual({ 'w2/1200': 2, 'w2/1230': 1 });
  });
});
