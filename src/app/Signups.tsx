import { useContext, useState } from 'react';
import type { Person, Poll, PollState } from '../core/types';
import { type RaidOf, nightsOf } from '../core/event';
import { formatDate, plural, weekdayName } from '../core/format';
import { localTime } from '../core/time';
import { LATE_STEPS, type Move, type Signup, type SignupStatus, type Usually, eventKey, playing, roster } from '../core/signup';
import { ROLES, classLabel, specsFor } from '../core/classes';
import { api } from './api';
import { classStyle } from './ClassPicker';
import { AbsencesContext } from './Absences';
import { Groups } from './Groups';

// Sign-ups for a locked-in raid's nights: your answer for a night, and who's seated, on standby, maybe,
// out, away or still to answer. The raid's team is seated first, then anyone else, first come.

type Auth = { token?: string; admin?: string };

const LABELS: Record<SignupStatus, string> = { in: 'in', late: 'late', tentative: 'maybe', out: 'out' };

function nightLabel(instant: number, zone: string): string {
  const t = localTime(instant, zone);
  return `${weekdayName(t.weekday, 'short')} ${formatDate(t, 'short')}`;
}

/** "main:" for their main as usual, "main:holy" for a spec this night, "<alt id>:" for an alt, and so on. */
const playValue = (s: Pick<Signup, 'as' | 'specs'> | undefined) => `${s?.as ?? 'main'}:${s?.specs?.join('+') ?? ''}`;

/** in · late · maybe · out for one night, how late once late, and who they're playing once coming. */
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
  current: Signup | undefined;
  auth: Auth;
  onState: (state: PollState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (status: SignupStatus | null, late?: number, play?: { as: string | null; specs: string[] | null }) => {
    setBusy(true);
    setError('');
    try {
      onState(await api.signUp(pollId, { owner, night }, me.id, auth, { status, late, ...play }));
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
      {current && current.status !== 'out' && (me.alts.length > 0 || specsFor(me.cls).length > 0) && (
        <select
          aria-label="Playing"
          className="signup-playing"
          value={playValue(current)}
          disabled={busy}
          onChange={(e) => {
            const [as, specs] = e.target.value.split(':');
            void send(current.status, current.late, { as: as === 'main' ? null : as, specs: specs ? specs.split('+') : null });
          }}
        >
          {[{ id: 'main', name: me.name, cls: me.cls, specs: me.specs }, ...me.alts].map((c) => (
            <optgroup key={c.id} label={c.id === 'main' ? `${c.name} (main)` : c.name}>
              <option value={`${c.id}:`}>
                {c.name}, {classLabel(c.cls, c.specs)}
              </option>
              {specsFor(c.cls)
                .filter((spec) => c.specs.join() !== spec)
                .map((spec) => (
                  <option key={spec} value={`${c.id}:${spec}`}>
                    {c.name}, {spec} {c.cls} this night
                  </option>
                ))}
            </optgroup>
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
  of,
  zone,
  me,
  auth,
  onState,
}: {
  poll: Poll;
  state: PollState;
  /** The poll's raid, a team's or an event. */
  of: RaidOf;
  zone: string;
  me?: Person;
  auth: Auth;
  onState: (state: PollState) => void;
}) {
  const { owner, raid, seats: team } = of;
  const nights = nightsOf(poll, of, Date.now(), of.mode === 'weekly' ? 4 : 1).filter((n) => !n.off);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState('');
  const absences = useContext(AbsencesContext);
  const night = nights.find((n) => n.night === picked) ?? nights[0];
  if (!night) return null;
  const event = state.signups[eventKey(owner, night.night)];
  const people = state.people;
  const byId = new Map(people.map((p) => [p.id, p]));
  const r = roster(people, event, raid, team, poll, { night: night.night, of: absences });
  const meAway = me && r.away.find((a) => a.id === me.id);
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
    const now = p && playing(p, s, poll.roles);
    return (
      <span className="roster-name" style={classStyle(now?.cls ?? '')}>
        {now?.alt ? now.name : (p?.name ?? 'someone')}
        {now?.alt && <span className="muted"> ({p!.name}’s alt)</span>}
        {now?.changed && <span className="muted"> {classLabel(now.cls, now.specs)}</span>}
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
      {me && team?.closed && !members.has(me.id) ? (
        <p className="event-me muted">Team only: for the people on {of.team?.name ?? 'the team'}.</p>
      ) : me && (
        <p className="event-me">
          <span className="muted">You, {nightLabel(night.start, zone)}:</span>{' '}
          {meAway && <span className="event-away">away{meAway.note && ` (${meAway.note})`}, unless you sign up</span>}
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
      {r.away.length > 0 && (
        <p className="event-line">
          <span className="event-role">away</span>
          {r.away.map((a) => (
            <span key={a.id} className="event-person">
              {name(a.id)}
              {a.note && <span className="muted">{a.note}</span>}
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
      {r.seating.seated.length > 0 && (
        <Groups
          key={night.night}
          pollId={poll.id}
          owner={owner}
          night={night.night}
          seated={r.seating.seated}
          size={size}
          byId={byId}
          stored={state.groups?.[eventKey(owner, night.night)]}
          layout={state.layouts?.[owner]}
          me={me}
          admin={auth.admin}
          onState={onState}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
