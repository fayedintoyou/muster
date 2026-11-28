import { useId, useState } from 'react';
import type { Poll, PollState } from '../core/types';
import { type OneOff, type RaidOf, raidsOf } from '../core/event';
import { formatDate, formatDuration, formatMinute, formatRange, serverTime, weekdayName, zonePlace } from '../core/format';
import { MINUTE, addDays, dateKey, localTime, parseDate, today, zonedInstant } from '../core/time';
import { seatsFor } from '../core/seating';
import { api } from './api';
import { RaidSize } from './RaidSize';
import { EventPanel } from './Signups';

// One-off events: a pug night, an attunement run, a raid outside the usual week. Each is one night with its
// own name, size and sign-ups, for the guild or for a team, and gets its own Discord post like a raid night.

type Draft = Omit<OneOff, 'id' | 'version'>;

const LENGTHS = Array.from({ length: 16 }, (_, i) => (i + 1) * 30);
const TIMES = Array.from({ length: 96 }, (_, i) => i * 15);

function sizeLine(o: Pick<OneOff, 'size' | 'makeup'>): string {
  if (!o.size) return 'any size';
  const s = seatsFor(o.size, o.makeup);
  return `${o.size} players: ${s.tank} tanks, ${s.healer} healers, ${s.dps} dps`;
}

/** "Sat Dec 12, 8:00–11:00pm". */
function whenLine(o: Pick<OneOff, 'at' | 'minutes'>, zone: string): string {
  const t = localTime(o.at, zone);
  return `${weekdayName(t.weekday, 'short')} ${formatDate(t, 'short')}, ${formatRange(o.at, o.at + o.minutes * MINUTE, zone)}`;
}

export function EventsPanel({
  poll,
  state,
  zone,
  admin,
  meId,
  token,
  onState,
}: {
  poll: Poll;
  state: PollState;
  zone: string;
  admin?: string;
  meId?: string;
  token?: string;
  onState: (state: PollState) => void;
}) {
  const [making, setMaking] = useState(false);
  const events = raidsOf(state, state.people.map((p) => p.id)).filter((r) => r.kind === 'event');
  const now = Date.now();
  const coming = events.filter((r) => r.event!.at + r.event!.minutes * MINUTE >= now);
  // The zone events are made in: the server's, which is how a guild says "8pm".
  const makeZone = poll.realm || zone;

  return (
    <div className="events">
      <h2 className="panel-heading">Events</h2>
      {coming.length === 0 &&
        (admin ? (
          <p className="hint">
            One-off nights outside the usual raids, such as a pug night or an attunement run. Each has its own
            sign-ups{state.teams.length ? ', for the guild or for one team' : ''}, and its own Discord post.
          </p>
        ) : (
          <p className="empty">No events coming up.</p>
        ))}
      {coming.map((r) => (
        <EventCard key={r.owner} of={r} poll={poll} state={state} zone={zone} makeZone={makeZone} admin={admin} meId={meId} token={token} onState={onState} />
      ))}
      {admin &&
        (making ? (
          <EventForm
            initial={{
              name: '',
              at: zonedInstant(addDays(today(makeZone), localTime(now, makeZone).minutes < 19 * 60 ? 0 : 1), 20 * 60, makeZone),
              minutes: poll.length,
              size: poll.size,
              makeup: poll.makeup,
              team: null,
              note: '',
              off: false,
            }}
            poll={poll}
            state={state}
            zone={makeZone}
            submitLabel="make the event"
            onCancel={() => setMaking(false)}
            onSubmit={async (draft) => {
              onState(await api.saveEvent(poll.id, admin, draft));
              setMaking(false);
            }}
          />
        ) : (
          <button type="button" className="button small" onClick={() => setMaking(true)}>
            new event
          </button>
        ))}
    </div>
  );
}

function EventCard({
  of,
  poll,
  state,
  zone,
  makeZone,
  admin,
  meId,
  token,
  onState,
}: {
  of: RaidOf;
  poll: Poll;
  state: PollState;
  zone: string;
  makeZone: string;
  admin?: string;
  meId?: string;
  token?: string;
  onState: (state: PollState) => void;
}) {
  const o = of.event!;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const server = serverTime(poll.realm, zone, o.at, o.at + o.minutes * MINUTE);
  const draft = (): Draft => ({ name: o.name, at: o.at, minutes: o.minutes, size: o.size, makeup: o.makeup, team: o.team, note: o.note, off: o.off });
  const run = async (work: () => Promise<void>) => {
    setError('');
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (editing && admin) {
    return (
      <section className="team" aria-label={o.name}>
        <EventForm
          initial={draft()}
          poll={poll}
          state={state}
          zone={makeZone}
          submitLabel="save the event"
          onCancel={() => setEditing(false)}
          onSubmit={async (next) => {
            onState(await api.saveEvent(poll.id, admin, next, o.id));
            setEditing(false);
          }}
        />
      </section>
    );
  }

  return (
    <section className="team" aria-label={o.name} data-off={o.off || undefined}>
      <div className="team-head">
        <h3>{o.name}</h3>
        <p className="team-size">
          {sizeLine(o)}
          {of.team ? ` · for ${of.team.name}` : ' · open to the guild'}
          {of.team?.closed && <span className="team-only"> · team only</span>}
        </p>
      </div>
      <p className="raid-when">
        {whenLine(o, zone)} <span className="muted">{zonePlace(zone)} time</span>
        {server && <span className="muted"> ({server} server)</span>}
        {o.off && <span className="raid-off"> called off</span>}
      </p>
      {o.note && <p className="poll-notes">{o.note}</p>}
      {!o.off && (
        <EventPanel poll={poll} state={state} of={of} zone={zone} me={state.people.find((p) => p.id === meId)} auth={{ token, admin }} onState={onState} />
      )}
      {admin && (
        <div className="team-actions">
          <button type="button" className="button small" onClick={() => setEditing(true)}>
            change event
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => void run(async () => onState(await api.saveEvent(poll.id, admin, { ...draft(), off: !o.off }, o.id)))}
          >
            {o.off ? 'back on' : 'call off'}
          </button>
          {deleting ? (
            <span className="confirm">
              Delete {o.name} and its sign-ups?{' '}
              <button
                type="button"
                className="button small danger"
                onClick={() => void run(async () => onState(await api.deleteEvent(poll.id, admin, o.id)))}
              >
                delete it
              </button>{' '}
              <button type="button" className="text-button" onClick={() => setDeleting(false)}>
                keep it
              </button>
            </span>
          ) : (
            <button type="button" className="text-button danger" onClick={() => setDeleting(true)}>
              delete event
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** An event's name, when (in `zone`, the server's), how long and big, who it's for, and a note. */
function EventForm({
  initial,
  poll,
  state,
  zone,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial: Draft;
  poll: Poll;
  state: PollState;
  zone: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (draft: Draft) => Promise<void>;
}) {
  const start = localTime(initial.at, zone);
  const [name, setName] = useState(initial.name);
  const [date, setDate] = useState(dateKey(start));
  const [minute, setMinute] = useState(start.minutes - (start.minutes % 15));
  const [minutes, setMinutes] = useState(initial.minutes);
  const [size, setSize] = useState(initial.size);
  const [makeup, setMakeup] = useState(initial.makeup);
  const [team, setTeam] = useState(initial.team ?? '');
  const [note, setNote] = useState(initial.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const day = parseDate(date);

  return (
    <form
      className="team-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!day) return setError('Pick a date.');
        setBusy(true);
        setError('');
        try {
          await onSubmit({
            ...initial,
            name,
            at: zonedInstant(day, minute, zone),
            minutes,
            size,
            makeup: size ? makeup : {},
            team: team || null,
            note,
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor={`event-name-${id}`}>Event name</label>
        <input
          id={`event-name-${id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Pug night, attunement run…"
          autoComplete="off"
        />
      </div>
      <fieldset className="field">
        <legend>When? <span className="muted">{poll.realm ? 'server time' : `${zonePlace(zone)} time`}</span></legend>
        <div className="time-row">
          <label className="select">
            <span className="visually-hidden">Date</span>
            <input type="date" value={date} min={dateKey(today(zone))} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="select">
            <span className="visually-hidden">Starts</span>
            <select value={minute} onChange={(e) => setMinute(Number(e.target.value))}>
              {TIMES.map((t) => (
                <option key={t} value={t}>
                  {formatMinute(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="select">
            <span className="visually-hidden">How long</span>
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {LENGTHS.map((m) => (
                <option key={m} value={m}>
                  {formatDuration(m)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>How big?</legend>
        <RaidSize
          size={size}
          makeup={makeup}
          onChange={(n, m) => {
            setSize(n);
            setMakeup(m);
          }}
        />
      </fieldset>
      {state.teams.length > 0 && (
        <div className="field">
          <label htmlFor={`event-team-${id}`}>Who’s it for?</label>
          <select id={`event-team-${id}`} value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">the guild: anyone, first come</option>
            {state.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.closed ? ' only' : ' first, then the guild'}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor={`event-note-${id}`}>
          Note <span className="muted">optional</span>
        </label>
        <input
          id={`event-note-${id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="Bring fire resistance; meet at the summoning stone"
          autoComplete="off"
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="team-actions">
        <button type="submit" className="button small primary" disabled={busy}>
          {busy ? 'saving…' : submitLabel}
        </button>
        <button type="button" className="text-button" onClick={onCancel}>
          cancel
        </button>
      </div>
    </form>
  );
}
