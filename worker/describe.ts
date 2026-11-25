import type { Poll } from '../src/core/types';
import { formatDate, formatMinute, plural, weekdayName, zoneName } from '../src/core/format';
import { parseDate, weekdayOf, zonedInstant } from '../src/core/time';
import { columnDates } from '../src/core/grid';

/** The words a link preview shows: when the poll is for, in the poll's own zone, and how many answered. */
export function describePoll(poll: Poll, count: number, now = Date.now()): { title: string; description: string } {
  const window = `${formatMinute(poll.start, true)}–${formatMinute(poll.end, true)}`;
  const firstDate = columnDates(poll, now)[0];
  const zone = zoneName(poll.tz, zonedInstant(firstDate, poll.start, poll.tz), 'short');
  let when: string;
  if (poll.mode === 'weekly') {
    const names = poll.days.map((d) => weekdayName(Number(d.slice(1))));
    when = `Weekly · ${names.join(', ')}`;
  } else {
    const dates = poll.days.map((d) => parseDate(d)!);
    const label = (i: number) => `${weekdayName(weekdayOf(dates[i]))} ${formatDate(dates[i])}`;
    when =
      dates.length <= 3
        ? dates.map((_, i) => label(i)).join(', ')
        : `${label(0)} – ${label(dates.length - 1)} (${dates.length} dates)`;
  }
  const answered = count === 0 ? 'No answers yet' : `${plural(count, 'person', 'people')} answered`;
  return {
    title: poll.title,
    description: `${when} · ${window} ${zone} · ${answered}. Mark when you’re free; times show in your own time zone.`,
  };
}
