import { useEffect, useId, useState } from 'react';
import type { Poll } from '../core/types';
import { type Raid, raidCalendar, raidNights } from '../core/raid';
import { formatDate, formatRange, serverTime, weekdayName, zonePlace } from '../core/format';
import { localTime } from '../core/time';
import { discordTimestamps } from '../core/occurrence';
import { useCopied } from './copy';

/** "in 3 days", "in 5 hours", "in 20 minutes", "on now". */
function until(ms: number): string {
  if (ms <= 0) return 'on now';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  return `in ${Math.round(hours / 24)} days`;
}

/**
 * The locked-in raid, at the top of the poll: when it is in your time and the server's, the next night and
 * how long until it, the nights coming up, a calendar file and the Discord message. Its maker can call a
 * night off, or unlock it.
 */
export function RaidBanner({
  poll,
  raid,
  zone,
  label = 'the raid',
  onChange,
  compact = false,
}: {
  poll: Poll;
  raid: Raid;
  zone: string;
  /** "the raid", or the team's name. */
  label?: string;
  /** For the poll's maker: change the raid (nights called off), or with null unlock it. */
  onChange?: (raid: Pick<Raid, 'start' | 'minutes' | 'skips'> | null) => Promise<void>;
  /** One line: when, and the next night. */
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [copied, copy] = useCopied();
  const [error, setError] = useState('');
  const titleId = `raid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  const nights = raidNights(poll, raid, now, poll.mode === 'weekly' ? 4 : 1);
  const next = nights.find((n) => !n.off);
  const shown = nights[0];
  const day = (instant: number, style: 'short' | 'long') => {
    const t = localTime(instant, zone);
    return poll.mode === 'weekly' && style === 'long'
      ? `${weekdayName(t.weekday, 'long')}s`
      : `${weekdayName(t.weekday, style)} ${formatDate(t, style)}`;
  };
  const server = shown ? serverTime(poll.realm, zone, shown.start, shown.end) : null;

  const change = async (next: Parameters<NonNullable<typeof onChange>>[0]) => {
    if (!onChange) return;
    setError('');
    try {
      await onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const toggleNight = (night: string) => {
    const skips = raid.skips.includes(night) ? raid.skips.filter((s) => s !== night) : [...raid.skips, night];
    void change({ start: raid.start, minutes: raid.minutes, skips });
  };
  const download = () => {
    const ics = raidCalendar(poll, raid, `${location.origin}/e/${poll.id}`);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    link.download = `${poll.title.replace(/[^\w -]+/g, '').trim() || 'raid'}.ics`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (compact) {
    return (
      <p className="raid-line">
        <span className="raid-label">{label}</span>{' '}
        {shown && (
          <>
            {day(shown.start, 'long')}, {formatRange(shown.start, shown.end, zone)}
            {server && <span className="muted"> ({server} server)</span>}
            {next && (
              <span className="muted">
                {' '}
                · next {day(next.start, 'short')}, {until(next.start - now)}
              </span>
            )}
          </>
        )}
      </p>
    );
  }

  return (
    <section className="raid-banner" aria-labelledby={titleId}>
      <p className="raid-label" id={titleId}>
        {label}
      </p>
      {shown ? (
        <>
          <p className="raid-when">
            {day(shown.start, 'long')}, {formatRange(shown.start, shown.end, zone)}{' '}
            <span className="muted">{zonePlace(zone)} time</span>
          </p>
          {server && <p className="raid-server">{server} server time</p>}
          <p className="raid-next">
            {next ? (
              <>
                Next: <strong>{day(next.start, 'short')}</strong>, {until(next.start - now)}.
              </>
            ) : (
              'No raid nights coming up.'
            )}
          </p>
          {poll.mode === 'weekly' && (
            <ul className="raid-nights" aria-label="Coming up">
              {nights.map((n) => (
                <li key={n.night} data-off={n.off || undefined}>
                  <span>{day(n.start, 'short')}</span>
                  {n.off && <span className="raid-off">off</span>}
                  {onChange && (
                    <button type="button" className="text-button" onClick={() => toggleNight(n.night)}>
                      {n.off ? 'back on' : 'call off'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="raid-actions">
            <button type="button" className="button small" onClick={download}>
              add to calendar
            </button>
            {next && (
              <button
                type="button"
                className="button small"
                onClick={() => copy('raid', discordTimestamps(poll.title, next.start, next.end))}
              >
                {copied === 'raid' ? 'copied: paste it in discord' : 'copy for discord'}
              </button>
            )}
            {onChange && (
              <button type="button" className="text-button" onClick={() => void change(null)}>
                unlock
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="raid-next">This raid has been and gone.</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
