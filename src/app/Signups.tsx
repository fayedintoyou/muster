import { useState } from 'react';
import type { Person, Poll, PollState } from '../core/types';
import type { Raid } from '../core/raid';
import { raidNights } from '../core/raid';
import { formatDate, plural, weekdayName } from '../core/format';
import { localTime } from '../core/time';
import { LATE_STEPS, type Move, type SignupStatus, type Usually, eventKey, roster } from '../core/signup';
import { ROLES } from '../core/classes';
import { api } from './api';
import { classStyle } from './ClassPicker';

// Sign-ups for a locked-in raid's nights: your answer for a night, and who's seated, on standby, maybe,
// out or still to answer. The raid's team is seated first, then anyone else, first come.

type Auth = { token?: string; admin?: string };

const LABELS: Record<SignupStatus, string> = { in: 'in', late: 'late', tentative: 'maybe', out: 'out' };

function nightLabel(instant: number, zone: string): string {
  const t = localTime(instant, zone);
  return `${weekdayName(t.weekday, 'short')} ${formatDate(t, 'short')}`;
}

/** in · late · maybe · out for one night, and how late once late. */
export function SignupButtons({
  pollId,
  owner,
  night,
  me,
  current,
  auth,
  onState,
}: {
  pollId: string;
  owner: string;
  night: string;
  me: Person;
  current: { status: SignupStatus; late?: number } | undefined;
  auth: Auth;
  onState: (state: PollState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (status: SignupStatus | null, late?: number) => {
    setBusy(true);
    setError('');
    try {
      onState(await api.signUp(pollId, { owner, night }, me.id, auth, { status, late }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="signup">
      <span className="segmented small" role="group" aria-label="Coming?">
        {(Object.keys(LABELS) as SignupStatus[]).map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={current?.status === status}
            disabled={busy}
            onClick={() =>
              void (current?.status === status ? send(null) : send(status, status === 'late' ? LATE_STEPS[0] : undefined))
            }
          >
            {LABELS[status]}
          </button>
        ))}
      </span>
      {current?.status === 'late' && (
        <select
          aria-label="How late"
          value={current.late}
          disabled={busy}
          onChange={(e) => void send('late', Number(e.target.value))}
        >
          {LATE_STEPS.map((m) => (
            <option key={m} value={m}>
              {m} min late
            </option>
          ))}
        </select>
      )}
      {error && (
        <span className="error" role="alert">
          {' '}
          {error}
        </span>
      )}
    </span>
  );
}

/** A raid's coming nights: pick one, answer for it, and see its roster. */
export function EventPanel({
  poll,
  state,
  owner,
  raid,
  team,
  zone,
  me,
  auth,
  onState,
}: {
  poll: Poll;
  state: PollState;
  owner: string;
  raid: Raid;
  team: { members: string[]; size: number; makeup: Record<string, number> } | null;
  zone: string;
  me?: Person;
  auth: Auth;
  onState: (state: PollState) => void;
}) {
  const nights = raidNights(poll, raid, Date.now(), poll.mode === 'weekly' ? 4 : 1).filter((n) => !n.off);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState('');
  const night = nights.find((n) => n.night === picked) ?? nights[0];
  if (!night) return null;
  const event = state.signups[eventKey(owner, night.night)];
  const people = state.people;
  const byId = new Map(people.map((p) => [p.id, p]));
  const r = roster(people, event, raid, team, poll);
  const members = new Set(team?.members ?? []);
  const moves = event?.moves ?? {};
  const signup = (id: string) => event?.people[id];

  const move = async (id: string, to: Move | null) => {
    if (!auth.admin) return;
    setError('');
    try {
      onState(await api.move(poll.id, auth.admin, { owner, night: night.night }, id, to));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const name = (id: string) => {
    const p = byId.get(id);
    const s = signup(id);
    return (
      <span className="roster-name" style={classStyle(p?.cls ?? '')}>
        {p?.name ?? 'someone'}
        {id === me?.id && <span className="muted"> (you)</span>}
        {p?.level60 === false && <span className="muted"> levelling</span>}
        {s?.status === 'late' && <span className="muted"> {s.late} min late</span>}
        {team && !members.has(id) && <span className="muted"> guild</span>}
      </span>
    );
  };
  const moveButton = (id: string, seated: boolean) =>
    auth.admin &&
    (moves[id] ? (
      <button type="button" className="text-button" onClick={() => void move(id, null)}>
        undo {moves[id]}
      </button>
    ) : (
      <button type="button" className="text-button" onClick={() => void move(id, seated ? 'bench' : 'seat')}>
        {seated ? 'bench' : 'seat'}
      </button>
    ));

  const size = team ? team.size : poll.size;
  const short = Object.entries(r.seating.want)
    .map(([role, n]) => [role, n - (r.seating.filled[role] ?? 0)] as const)
    .filter(([, n]) => n > 0);
  const roles = [...ROLES, ...new Set(r.seating.seated.map((s) => s.role).filter((x) => !ROLES.includes(x)))];
  const groups: Record<Usually, string> = {
    free: 'usually free',
    'if needed': 'free if needed',
    busy: 'not usually free',
  };

  return (
    <div className="event">
      {nights.length > 1 && (
        <div className="event-nights" role="group" aria-label="Night">
          {nights.map((n) => (
            <button
              key={n.night}
              type="button"
              className="chip small"
              aria-pressed={n.night === night.night}
              onClick={() => setPicked(n.night)}
            >
              {nightLabel(n.start, zone)}
            </button>
          ))}
        </div>
      )}
      {me && (
        <p className="event-me">
          <span className="muted">You, {nightLabel(night.start, zone)}:</span>{' '}
          <SignupButtons
            pollId={poll.id}
            owner={owner}
            night={night.night}
            me={me}
            current={signup(me.id)}
            auth={auth}
            onState={onState}
          />
        </p>
      )}
      <p className="event-count">
        <span className="count">
          {r.seating.seated.length}
          {size > 0 && <span className="of">/{size}</span>}
        </span>{' '}
        <span className="count-words">
          {size === 0
            ? 'coming'
            : short.length === 0
              ? `fills the ${size}`
              : `seated, needs ${short.map(([role, n]) => (role === 'dps' ? `${n} dps` : plural(n, role))).join(', ')}`}
        </span>
      </p>
      {r.seating.seated.length > 0 && (
        <ul className="event-roster" aria-label="Seated">
          {roles.map((role) => {
            const seated = r.seating.seated.filter((s) => s.role === role);
            if (seated.length === 0) return null;
            return (
              <li key={role}>
                <span className="event-role">{role}</span>
                {seated.map((s) => (
                  <span key={s.id} className="event-person">
                    {name(s.id)} {moveButton(s.id, true)}
                  </span>
                ))}
              </li>
            );
          })}
        </ul>
      )}
      {r.standby.length > 0 && (
        <p className="event-line">
          <span className="event-role">standby</span>
          {r.standby.map((id) => (
            <span key={id} className="event-person">
              {name(id)} {moveButton(id, false)}
            </span>
          ))}
        </p>
      )}
      {r.tentative.length > 0 && (
        <p className="event-line">
          <span className="event-role">maybe</span>
          {r.tentative.map((id) => (
            <span key={id} className="event-person">
              {name(id)}
            </span>
          ))}
        </p>
      )}
      {r.out.length > 0 && (
        <p className="event-line">
          <span className="event-role">out</span>
          {r.out.map((id) => (
            <span key={id} className="event-person">
              {name(id)}
            </span>
          ))}
        </p>
      )}
      {r.unanswered.length > 0 && (
        <p className="event-line event-quiet">
          <span className="event-role">not answered</span>
          {(['free', 'if needed', 'busy'] as const)
            .map((u) => [u, r.unanswered.filter((x) => x.usually === u)] as const)
            .filter(([, list]) => list.length > 0)
            .map(([u, list]) => (
              <span key={u} className="event-person">
                {list.map((x) => byId.get(x.id)?.name).join(', ')} <span className="muted">({groups[u]})</span>
              </span>
            ))}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
