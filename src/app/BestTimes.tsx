import { useMemo } from 'react';
import type { Grid } from '../core/grid';
import type { Person, Poll } from '../core/types';
import { bestWindows } from '../core/best';
import { formatDate, formatDuration, formatRange, formatTime, weekdayName } from '../core/format';
import { MINUTE } from '../core/time';
import { discordTimestamps, nextOccurrence } from '../core/occurrence';
import { useCopied } from './copy';
import { Composition } from './Composition';

const LENGTHS = Array.from({ length: 16 }, (_, i) => (i + 1) * 30);

function names(ids: string[], nameOf: (id: string) => string): string {
  const list = ids.map(nameOf);
  if (list.length <= 2) return list.join(' and ');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

export function BestTimes({
  poll,
  grid,
  people,
  required,
  length,
  onLength,
  nameOf,
  zone,
}: {
  poll: Poll;
  grid: Grid;
  /** The people being counted. */
  people: Person[];
  required: ReadonlySet<string>;
  length: number;
  onLength: (minutes: number) => void;
  nameOf: (id: string) => string;
  zone: string;
}) {
  const [copied, copy] = useCopied();
  const answered = people.filter((p) => Object.keys(p.marks).length > 0);
  const result = useMemo(
    () => bestWindows(grid, { length, people, required, roles: poll.roles }),
    [grid, length, people, required, poll.roles],
  );
  const lengths = LENGTHS.includes(length) ? LENGTHS : [...LENGTHS, length].sort((a, b) => a - b);
  const total = people.length;

  return (
    <div className="best">
      <div className="best-controls">
        <label className="inline-select">
          <span>Windows of</span>
          <select value={length} onChange={(e) => onLength(Number(e.target.value))}>
            {lengths.map((m) => (
              <option key={m} value={m}>
                {formatDuration(m)}
                {m === poll.length ? ' (the raid length)' : ''}
              </option>
            ))}
          </select>
        </label>
        {result.clamped && (
          <p className="hint">The poll’s nights are only {formatDuration(result.span * poll.slot)} long, so that’s the window.</p>
        )}
        {required.size > 0 && <p className="hint">Only windows {names([...required], nameOf)} can all make.</p>}
      </div>

      {answered.length < 2 ? (
        <p className="empty">
          {answered.length === 0
            ? 'Once people mark their times, the nights that suit the most of you show up here.'
            : 'One answer so far. Once a second person marks their times, the nights that suit the most of you show up here.'}
        </p>
      ) : result.candidates.length === 0 ? (
        <p className="empty">
          {result.requiredUnmet
            ? `${names([...required], nameOf)} are never free together for ${formatDuration(length)}. Try a shorter window, or take someone off “must come”.`
            : `No one is free for a whole ${formatDuration(length)} yet. Try a shorter window.`}
        </p>
      ) : (
        <ol className="best-list">
          {result.candidates.map((c, i) => {
            const column = grid.columns[c.col];
            const first = column.slots[c.first];
            const last = column.slots[c.last];
            const end = first.instant + c.span * poll.slot * MINUTE;
            const day = `${weekdayName(column.weekday, 'long')}${grid.mode === 'dates' ? ` ${formatDate(column.date)}` : ''}`;
            const maybe = c.attend.length - c.yes.length;
            const id = `${c.col}-${c.first}`;
            const occurs = nextOccurrence(poll, first.key);
            const roleEntries = Object.entries(c.roles);
            return (
              <li key={id} className="best-item" data-top={i === 0 || undefined}>
                <div className="best-when">
                  <h3>
                    {day}, {formatRange(first.instant, end, zone)}
                  </h3>
                  {c.last > c.first && (
                    <p className="best-flex">or start as late as {formatTime(last.instant, zone)} with the same people</p>
                  )}
                </div>
                <p className="best-count">
                  <span className="count">
                    {c.attend.length}
                    <span className="of">/{total}</span>
                  </span>
                  <span className="count-words">
                    {c.attend.length === total ? 'everyone can make it' : 'can make it'}
                    {maybe > 0 && `, ${maybe} only if needed`}
                  </span>
                </p>
                {roleEntries.length > 0 && (
                  <ul className="roles-count" aria-label="Roles">
                    {roleEntries.map(([role, n]) => (
                      <li key={role} data-none={n === 0 || undefined}>
                        <span className="role-n">{n}</span> {role}
                      </li>
                    ))}
                  </ul>
                )}
                <Composition
                  people={people.filter((p) => c.attend.includes(p.id))}
                  classes={poll.classes}
                  className="best-classes"
                />
                {c.missing.length > 0 && (
                  <p className="best-missing">
                    Not free: {names(c.missing, nameOf)}.
                    {c.partly.length > 0 &&
                      ` ${c.partly
                        .map((p) => `${nameOf(p.id)} can make ${formatDuration(p.slots * poll.slot)} of it`)
                        .join('; ')}.`}
                  </p>
                )}
                {occurs !== null && (
                  <button
                    type="button"
                    className="button small"
                    onClick={() => copy(id, discordTimestamps(poll.title, occurs, occurs + c.span * poll.slot * MINUTE))}
                  >
                    {copied === id ? 'copied: paste it in discord' : 'copy for discord'}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
