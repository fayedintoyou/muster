import { describe, expect, it } from 'vitest';
import { describePoll } from './describe';
import type { Poll } from '../src/core/types';

const base: Poll = {
  id: 'abcdefgh',
  title: 'Raid nights',
  notes: '',
  mode: 'weekly',
  days: ['w2', 'w4'],
  start: 1200,
  end: 60,
  slot: 30,
  tz: 'America/New_York',
  roles: [],
  length: 180,
  created: 0,
  updated: 0,
};
const NOW = Date.UTC(2026, 10, 25, 5, 37);

describe('link previews', () => {
  it('describe a weekly poll in its own zone', () => {
    expect(describePoll(base, 0, NOW).description).toBe(
      'Weekly · Tue, Thu · 8pm–1am EST · No answers yet. Mark when you’re free; times show in your own time zone.',
    );
  });

  it('describe a few dates, or a range of many', () => {
    const few = describePoll({ ...base, mode: 'dates', days: ['2026-12-01', '2026-12-03'] }, 1, NOW);
    expect(few.description).toMatch(/^Tue Dec 1, Thu Dec 3 · 8pm–1am EST · 1 person answered\./);
    const many = describePoll(
      { ...base, mode: 'dates', days: ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-08'] },
      12,
      NOW,
    );
    expect(many.description).toMatch(/^Tue Dec 1 – Tue Dec 8 \(4 dates\) · .* · 12 people answered\./);
  });
});
