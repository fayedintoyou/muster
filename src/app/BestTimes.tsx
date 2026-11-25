import { useMemo, useState } from 'react';
import type { Grid } from '../core/grid';
import type { Candidate } from '../core/best';
import type { Person, Poll } from '../core/types';
import { bestWindows } from '../core/best';
import { formatDate, formatDuration, formatRange, formatTime, weekdayName } from '../core/format';
import { MINUTE } from '../core/time';
import { discordTimestamps, nextOccurrence } from '../core/occurrence';
import { useCopied } from './copy';
import { Composition } from './Composition';

const LENGTHS = Array.from({ length: 16 }, (_, i) => (i + 1) * 30);
/** How many entries show before "more nights". */
const SHOWN = 3;

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
  const [showAll, setShowAll] = useState(false);
  const answered = people.filter((p) => Object.keys(p.marks).length > 0);
  const result = useMemo(
    () => bestWindows(grid, { length, people, required, roles: poll.roles, limit: 14 }),
    [grid, length, people, required, poll.roles],
  );
  const lengths = LENGTHS.includes(length) ? LENGTHS : [...LENGTHS, length].sort((a, b) => a - b);
  const total = people.length;

  // Nights with the same hours and the same people read as one entry: "Mon, Tue and Wed, 8–11pm".
  const groups = useMemo(() => {
    const out: { key: string; range: string; list: Candidate[] }[] = [];
    for (const c of result.candidates) {
      const column = grid.columns[c.col];
      const first = column.slots[c.first];
      const range = formatRange(first.instant, first.instant + c.span * poll.slot * MINUTE, zone);
      const key = [range, c.last - c.first, c.attend.join(','), c.yes.join(',')].join('|');
      const same = out.find((g) => g.key === key);
      if (same) same.list.push(c);
      else out.push({ key, range, list: [c] });
    }
    for (const g of out) g.list.sort((a, b) => a.col - b.col);
    return out;
  }, [result, grid, poll.slot, zone]);
  const shown = showAll ? groups : groups.slice(0, SHOWN);
  const dayName = (c: Candidate, style: 'short' | 'long') => {
    const column = grid.columns[c.col];
    return `${weekdayName(column.weekday, style)}${grid.mode === 'dates' ? ` ${formatDate(column.date)}` : ''}`;
  };

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
        <>
          <ol className="best-list">
            {shown.map((g, i) => {
              const c = g.list[0];
              const column = grid.columns[c.col];
              const last = column.slots[c.last];
              const days = g.list.length === 1 ? dayName(c, 'long') : names(g.list.map((x) => dayName(x, 'short')), (d) => d);
              const maybe = c.attend.length - c.yes.length;
              const id = g.key;
              const occurrences = g.list
                .map((x) => nextOccurrence(poll, grid.columns[x.col].slots[x.first].key))
                .filter((o): o is number => o !== null);
              const roleEntries = Object.entries(c.roles);
              return (
                <li key={id} className="best-item" data-top={i === 0 || undefined}>
                  <div className="best-when">
                    <h3>
                      {days}, {g.range}
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
                  {/* With everyone there, the classes are the same as the People list's. */}
                  {c.attend.length < total && (
                    <Composition
                      people={people.filter((p) => c.attend.includes(p.id))}
                      classes={poll.classes}
                      className="best-classes"
                    />
                  )}
                  {c.missing.length > 0 && (
                    <p className="best-missing">
                      Not free: {names(c.missing, nameOf)}.
                      {g.list.length === 1 &&
                        c.partly.length > 0 &&
                        ` ${c.partly
                          .map((p) => `${nameOf(p.id)} can make ${formatDuration(p.slots * poll.slot)} of it`)
                          .join('; ')}.`}
                    </p>
                  )}
                  {occurrences.length > 0 && (
                    <button
                      type="button"
                      className="button small"
                      onClick={() =>
                        copy(
                          id,
                          occurrences
                            .map((o) => discordTimestamps(poll.title, o, o + c.span * poll.slot * MINUTE))
                            .join('\n'),
                        )
                      }
                    >
                      {copied === id ? 'copied: paste it in discord' : 'copy for discord'}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {groups.length > SHOWN && (
            <button type="button" className="text-button best-more" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'show fewer' : `${groups.length - SHOWN} more`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
