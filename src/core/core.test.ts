import { describe, expect, it } from 'vitest';
import { bestWindows, sharedSlots, tallySlots } from './best';
import { buildGrid } from './grid';
import { nextOccurrence, discordTimestamps } from './occurrence';
import { slotKeys } from './slots';
import { localTime, tzOffset, windowLength, zonedInstant } from './time';
import { formatMinute, formatRange, serverTime } from './format';
import { cleanMarks, validateSettings } from './validate';
import { seat } from './seating';
import { raidCalendar, raidNights, validateRaid } from './raid';
import { raidsClash, teamClashes, validateTeam } from './team';
import { nextSignup, roster, usuallyFree, validateSignup } from './signup';
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
  realm: '',
  size: 0,
  makeup: {},
  discordOnly: false,
  closed: false,
  roles: ['tank', 'healer', 'dps'],
  classes: [],
  length: 90,
};
// Wednesday 25 November 2026, 00:37 in New York.
const NOW = Date.UTC(2026, 10, 25, 5, 37);

function person(id: string, marks: Record<string, 1 | 2>, roles: string[] = []): Person {
  return { id, name: id, roles, cls: '', specs: [], spec: '', note: '', level60: null, marks, hasPassword: false, discord: false, updated: 0 };
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

  it('counts the slots two people are both free, if needed included', () => {
    expect(sharedSlots(grid, people[0].marks, people[1].marks)).toBe(5 + 8);
    expect(sharedSlots(grid, people[1].marks, people[2].marks)).toBe(4);
    expect(sharedSlots(grid, fill(tueEvening), people[2].marks)).toBe(0);
    expect(sharedSlots(grid, { 'w9/60': 2 }, { 'w9/60': 2 })).toBe(0);
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

describe('seating', () => {
  const p = (id: string, roles: string[]) => person(id, {}, roles);
  it('seats each person once, moving a flexible one to make room', () => {
    const s = seat([p('ben', ['tank', 'dps']), p('ana', ['dps'])], new Set(['ben', 'ana']), 2, { tank: 1, healer: 0 });
    expect(s.seated).toEqual([{ id: 'ben', role: 'tank' }, { id: 'ana', role: 'dps' }]);
    expect(s.flex).toEqual([{ id: 'ben', role: 'tank' }]);
  });

  it('seats the sure before the if-needed, and says who is left over', () => {
    const s = seat([p('maybe', ['healer']), p('sure', ['healer'])], new Set(['sure']), 2, { tank: 0, healer: 1 });
    expect(s.seated).toEqual([{ id: 'sure', role: 'healer' }]);
    expect(s.extra).toEqual(['maybe']);
    expect(s.filled).toEqual({ tank: 0, healer: 1, dps: 0 });
  });

  it('counts a seat taken only if needed', () => {
    const s = seat([p('cy', ['dps'])], new Set(), 10, { tank: 2, healer: 3 });
    expect(s.ifNeeded).toEqual(['cy']);
    expect(s.want).toEqual({ tank: 2, healer: 3, dps: 5 });
  });

  it('ranks windows by how full a raid they seat', () => {
    const grid = buildGrid({ ...weekly, days: ['w2', 'w4'], start: 20 * 60, end: 21 * 60 }, NY);
    const tue = { 'w2/1200': 2, 'w2/1230': 2 } as const;
    const thu = { 'w4/1200': 2, 'w4/1230': 2 } as const;
    const people = [
      person('d1', tue, ['dps']),
      person('d2', tue, ['dps']),
      person('d3', tue, ['dps']),
      person('tank', thu, ['tank']),
      person('heal', thu, ['healer']),
    ];
    const r = bestWindows(grid, { length: 60, people, raid: { size: 2, makeup: { tank: 1, healer: 1 } } });
    expect(grid.columns[r.candidates[0].col].day).toBe('w4');
    expect(r.candidates[0].seating?.seated.length).toBe(2);
  });
});

describe('a locked-in raid', () => {
  // Tuesdays and Thursdays 8pm–1am New York; now is Wednesday 25 November, 00:37.
  const raid = { start: 'w4/1200', minutes: 180, skips: ['2026-12-03'], version: 2 };

  it('only locks in a time the poll has', () => {
    expect(validateRaid({ start: 'w4/1200', minutes: 180 }, weekly).ok).toBe(true);
    expect(validateRaid({ start: 'w3/1200', minutes: 180 }, weekly).ok).toBe(false);
    expect(validateRaid({ start: 'w4/1200', minutes: 7 }, weekly).ok).toBe(false);
  });

  it('lists the coming nights, with called-off ones marked', () => {
    const nights = raidNights(weekly, raid, NOW, 3);
    expect(nights.map((n) => [n.night, n.off])).toEqual([
      ['2026-11-26', false],
      ['2026-12-03', true],
      ['2026-12-10', false],
    ]);
    expect(localTime(nights[0].start, NY).minutes).toBe(20 * 60);
  });

  it('keeps a raid that runs past midnight on its night, and counts one under way', () => {
    // Tuesday night's 12:30am raid started seven minutes ago.
    const late = raidNights(weekly, { ...raid, start: 'w2/1470', skips: [] }, NOW, 1)[0];
    expect(late.night).toBe('2026-11-24');
    expect(localTime(late.start, NY)).toMatchObject({ d: 25, minutes: 30 });
  });

  it('writes a weekly calendar in the poll’s zone, leaving out nights called off', () => {
    const ics = raidCalendar({ id: 'abcdefgh', title: 'Raid nights', mode: 'weekly', tz: NY }, raid, 'https://x/e/abcdefgh', NOW);
    expect(ics).toContain('DTSTART;TZID=America/New_York:20261126T200000');
    expect(ics).toContain('RRULE:FREQ=WEEKLY');
    expect(ics).toContain('EXDATE;TZID=America/New_York:20261203T200000');
    expect(ics).toContain('SEQUENCE:2');
    expect(ics).toContain('DURATION:PT180M');
  });
});

describe('teams', () => {
  it('keeps only people in the poll, once each', () => {
    const r = validateTeam({ name: '  Thursday   10 ', members: ['a', 'zz', 'a', 'b'], size: 10, makeup: { tank: 2, healer: 3 } }, new Set(['a', 'b']));
    expect(r.ok && r.value).toEqual({ name: 'Thursday 10', members: ['a', 'b'], size: 10, makeup: { tank: 2, healer: 3 } });
    expect(validateTeam({ name: ' ', members: [] }, new Set()).ok).toBe(false);
  });

  it('finds people on two teams whose raids overlap', () => {
    expect(raidsClash({ start: 'w4/1200', minutes: 180 }, { start: 'w4/1290', minutes: 120 })).toBe(true);
    expect(raidsClash({ start: 'w4/1200', minutes: 90 }, { start: 'w4/1290', minutes: 120 })).toBe(false);
    expect(raidsClash({ start: 'w4/1200', minutes: 180 }, { start: 'w2/1200', minutes: 180 })).toBe(false);
    const raid = (start: string) => ({ start, minutes: 180, skips: [], version: 1 });
    const teams = [
      { id: 'one', name: 'One', members: ['faye', 'bo'], size: 0, makeup: {}, raid: raid('w4/1200') },
      { id: 'two', name: 'Two', members: ['bo'], size: 0, makeup: {}, raid: raid('w4/1260') },
      { id: 'tre', name: 'Three', members: ['faye'], size: 0, makeup: {}, raid: raid('w2/1200') },
    ];
    const clashes = teamClashes(teams);
    expect(clashes.get('one')?.map((c) => [c.person, c.team.id])).toEqual([['bo', 'two']]);
    expect(clashes.get('tre')).toEqual([]);
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

  it('gives server time only when it reads differently', () => {
    const at = zonedInstant({ y: 2026, m: 12, d: 1 }, 20 * 60, NY);
    expect(serverTime('America/Chicago', NY, at, at + 3 * 3600_000)).toMatch(/^7(:00)?\s?(–|-)\s?10(:00)?\s?pm$|^19:00–22:00$/);
    expect(serverTime('America/Chicago', 'America/Chicago', at)).toBeNull();
    expect(serverTime('', NY, at)).toBeNull();
  });
});

describe('validation', () => {
  it('accepts a weekly poll and orders its days Monday first', () => {
    const r = validateSettings({ ...weekly, days: ['w0', 'w4', 'w2'] }, NOW);
    expect(r.ok && r.value.days).toEqual(['w2', 'w4', 'w0']);
  });

  it('checks a raid size and its tanks and healers', () => {
    const r = validateSettings({ ...weekly, size: 10, makeup: { tank: 2, healer: 3 } }, NOW);
    expect(r.ok && r.value.makeup).toEqual({ tank: 2, healer: 3 });
    expect(validateSettings({ ...weekly, size: 10, makeup: { tank: 6, healer: 6 } }, NOW).ok).toBe(false);
    expect(validateSettings({ ...weekly, size: 41, makeup: {} }, NOW).ok).toBe(false);
    const any = validateSettings({ ...weekly, size: 0, makeup: { tank: 2 } }, NOW);
    expect(any.ok && any.value.makeup).toEqual({});
  });

  it('keeps a server time zone, and treats a missing one as none', () => {
    const r = validateSettings({ ...weekly, realm: 'America/Chicago' }, NOW);
    expect(r.ok && r.value.realm).toBe('America/Chicago');
    const { realm: _, ...old } = weekly;
    const none = validateSettings(old, NOW);
    expect(none.ok && none.value.realm).toBe('');
  });

  it('sorts and dedupes dates', () => {
    const r = validateSettings({ ...weekly, mode: 'dates', days: ['2026-12-03', '2026-12-01', '2026-12-03'] }, NOW);
    expect(r.ok && r.value.days).toEqual(['2026-12-01', '2026-12-03']);
  });

  it('refuses what it cannot schedule', () => {
    expect(validateSettings({ ...weekly, tz: 'Mars/Olympus' }, NOW).ok).toBe(false);
    expect(validateSettings({ ...weekly, realm: 'Mars/Olympus' }, NOW).ok).toBe(false);
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

describe('sign-ups', () => {
  const raid = { start: 'w4/1200', minutes: 60 };
  const poll = { size: 0, makeup: {}, slot: 30 as const };
  const at = (n: number) => ({ status: 'in' as const, at: n });

  it('seats the team first, then the guild first come, then standby', () => {
    const people = [
      person('tankA', {}, ['tank']),
      person('healA', {}, ['healer']),
      person('dpsA', {}, ['dps']),
      person('dpsB', {}, ['dps']),
      person('guest1', {}, ['dps']),
      person('guest2', {}, ['dps', 'healer']),
    ];
    const team = { members: ['tankA', 'healA', 'dpsA', 'dpsB'], size: 4, makeup: { tank: 1, healer: 1 } };
    // The guests signed up before two of the team, yet the team's members are seated first.
    const event = {
      people: { guest1: at(1), guest2: at(2), tankA: at(3), healA: at(4), dpsA: at(5) },
      moves: {},
    };
    const r = roster(people, event, raid, team, poll);
    expect(r.seating.seated.map((s) => s.id).sort()).toEqual(['dpsA', 'guest1', 'healA', 'tankA']);
    expect(r.standby).toEqual(['guest2']);
    expect(r.unanswered.map((u) => u.id)).toEqual(['dpsB']);
  });

  it('lets an organizer seat or bench anyone', () => {
    const people = [person('a', {}, ['dps']), person('b', {}, ['dps']), person('c', {}, ['dps'])];
    const team = { members: ['a', 'b'], size: 2, makeup: {} };
    const event = { people: { a: at(1), b: at(2), c: at(3) }, moves: { c: 'seat' as const, a: 'bench' as const } };
    const r = roster(people, event, raid, team, poll);
    expect(r.seating.seated.map((s) => s.id).sort()).toEqual(['b', 'c']);
    expect(r.standby).toEqual(['a']);
  });

  it('keeps your place when you switch between in and late, not after dropping out', () => {
    const first = nextSignup(undefined, { status: 'in' }, 10);
    expect(nextSignup(first, { status: 'late', late: 30 }, 20).at).toBe(10);
    const out = nextSignup(first, { status: 'out' }, 30);
    expect(nextSignup(out, { status: 'in' }, 40).at).toBe(40);
  });

  it('says whether the poll has someone free for the raid', () => {
    expect(usuallyFree(person('x', { 'w4/1200': 2, 'w4/1230': 2 }), raid, 30)).toBe('free');
    expect(usuallyFree(person('x', { 'w4/1200': 2, 'w4/1230': 1 }), raid, 30)).toBe('if needed');
    expect(usuallyFree(person('x', { 'w4/1200': 2 }), raid, 30)).toBe('busy');
  });

  it('checks what a sign-up says', () => {
    expect(validateSignup({ status: 'late', late: 30 })).toEqual({ ok: true, value: { status: 'late', late: 30 } });
    expect(validateSignup({ status: 'late' }).ok).toBe(false);
    expect(validateSignup({ status: 'maybe' }).ok).toBe(false);
    expect(validateSignup({ status: null })).toEqual({ ok: true, value: null });
  });
});
