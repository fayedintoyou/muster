import { useEffect, useState } from 'react';
import type { Poll } from '../core/types';
import { type Raid, raidCalendar, raidNights } from '../core/raid';
import { formatDate, formatRange, serverTime, weekdayName, zonePlace } from '../core/format';
import { localTime } from '../core/time';
import { discordTimestamps } from '../core/occurrence';
import { api } from './api';
import { useCopied } from './copy';

/** "in 3 days", "in 5 hours", "in 20 minutes", "on now". */
function until(ms: number): string {
  if (ms <= 0) return 'on now';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} hours`;
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
  admin,
  onState,
}: {
  poll: Poll;
  raid: Raid;
  zone: string;
  admin?: string;
  onState: (state: Awaited<ReturnType<typeof api.lockRaid>>) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [copied, copy] = useCopied();
  const [error, setError] = useState('');
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

  const change = async (call: () => Promise<Parameters<typeof onState>[0]>) => {
    setError('');
    try {
      onState(await call());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const toggleNight = (night: string) => {
    if (!admin) return;
    const skips = raid.skips.includes(night) ? raid.skips.filter((s) => s !== night) : [...raid.skips, night];
    void change(() => api.lockRaid(poll.id, admin, { start: raid.start, minutes: raid.minutes, skips }));
  };
  const download = () => {
    const ics = raidCalendar(poll, raid, `${location.origin}/e/${poll.id}`);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    link.download = `${poll.title.replace(/[^\w -]+/g, '').trim() || 'raid'}.ics`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <section className="raid-banner" aria-labelledby="raid-title">
      <p className="raid-label" id="raid-title">
        the raid
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
                  {admin && (
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
            {admin && (
              <button type="button" className="text-button" onClick={() => void change(() => api.unlockRaid(poll.id, admin))}>
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
