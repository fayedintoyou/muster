import { useId, useState } from 'react';
import type { Grid } from '../core/grid';
import type { Person, Poll, PollState } from '../core/types';
import { type Team, teamClashes } from '../core/team';
import { seatsFor } from '../core/seating';
import { formatDuration } from '../core/format';
import { api } from './api';
import { BestTimes } from './BestTimes';
import { ClassName } from './ClassPicker';
import { Composition } from './Composition';
import { RaidBanner } from './RaidBanner';
import { RaidSize } from './RaidSize';

// Raid teams, picked from everyone who answered. The poll finds when the guild is free; here its maker
// splits people into teams, and each team finds and locks in its own time from its members' answers.

type Draft = Pick<Team, 'name' | 'members' | 'size' | 'makeup'>;

function sizeLine(t: Pick<Team, 'size' | 'makeup'>): string {
  if (!t.size) return 'any size';
  const s = seatsFor(t.size, t.makeup);
  return `${t.size} players: ${s.tank} tanks, ${s.healer} healers, ${s.dps} dps`;
}

/** Hours marked available, which helps when picking people who play a lot. */
function freeHours(p: Person, slot: number): string {
  const n = Object.values(p.marks).filter((m) => m === 2).length;
  return n ? `${formatDuration(n * slot)} free` : 'only if needed';
}

export function TeamsPanel({
  poll,
  state,
  grid,
  zone,
  admin,
  meId,
  nameOf,
  onState,
}: {
  poll: Poll;
  state: PollState;
  grid: Grid;
  zone: string;
  admin?: string;
  meId?: string;
  nameOf: (id: string) => string;
  onState: (state: PollState) => void;
}) {
  const [making, setMaking] = useState(false);
  const clashes = teamClashes(state.teams);
  const answered = state.people.filter((p) => Object.keys(p.marks).length > 0);

  return (
    <div className="teams">
      {state.teams.length === 0 &&
        (admin ? (
          <p className="hint">
            Split everyone who answered into raid teams. Each team then finds its own best time from its members’
            answers, and locks it in.
          </p>
        ) : (
          <p className="empty">No raid teams yet. The organizer makes them from everyone’s answers.</p>
        ))}
      {state.teams.map((t) => (
        <TeamCard
          key={t.id}
          team={t}
          poll={poll}
          state={state}
          grid={grid}
          zone={zone}
          admin={admin}
          meId={meId}
          nameOf={nameOf}
          clashes={clashes.get(t.id) ?? []}
          onState={onState}
        />
      ))}
      {admin &&
        (making ? (
          <TeamForm
            initial={{ name: `Team ${state.teams.length + 1}`, members: [], size: poll.size, makeup: poll.makeup }}
            people={answered}
            teams={state.teams}
            slot={poll.slot}
            classes={poll.classes}
            submitLabel="make the team"
            onCancel={() => setMaking(false)}
            onSubmit={async (draft) => {
              onState(await api.saveTeam(poll.id, admin, draft));
              setMaking(false);
            }}
          />
        ) : (
          <button type="button" className="button small" onClick={() => setMaking(true)}>
            new team
          </button>
        ))}
    </div>
  );
}

function TeamCard({
  team,
  poll,
  state,
  grid,
  zone,
  admin,
  meId,
  nameOf,
  clashes,
  onState,
}: {
  team: Team;
  poll: Poll;
  state: PollState;
  grid: Grid;
  zone: string;
  admin?: string;
  meId?: string;
  nameOf: (id: string) => string;
  clashes: { person: string; team: Team }[];
  onState: (state: PollState) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [finding, setFinding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [length, setLength] = useState(poll.length);
  const [error, setError] = useState('');
  const members = team.members
    .map((id) => state.people.find((p) => p.id === id))
    .filter((p): p is Person => Boolean(p));
  const answered = state.people.filter((p) => Object.keys(p.marks).length > 0);

  if (editing && admin) {
    return (
      <section className="team" aria-label={team.name}>
        <TeamForm
          initial={team}
          people={answered}
          teams={state.teams.filter((t) => t.id !== team.id)}
          slot={poll.slot}
          classes={poll.classes}
          submitLabel="save the team"
          onCancel={() => setEditing(false)}
          onSubmit={async (draft) => {
            onState(await api.saveTeam(poll.id, admin, draft, team.id));
            setEditing(false);
          }}
        />
      </section>
    );
  }

  return (
    <section className="team" aria-label={team.name}>
      <div className="team-head">
        <h3>{team.name}</h3>
        <p className="team-size">{sizeLine(team)}</p>
      </div>
      {members.length === 0 ? (
        <p className="empty">No one picked yet.</p>
      ) : (
        <>
          <Composition people={members} classes={poll.classes} lead={`${members.length}:`} />
          <ul className="team-roster">
            {members.map((p) => (
              <li key={p.id}>
                <span className="person-name">
                  {p.name}
                  {p.id === meId && <span className="muted"> (you)</span>}
                </span>
                <ClassName cls={p.cls} specs={p.specs} spec={p.spec} />
              </li>
            ))}
          </ul>
        </>
      )}
      {clashes.length > 0 && (
        <p className="error team-clash">
          {[...new Set(clashes.map((c) => c.team))]
            .map((other) => {
              const who = clashes.filter((c) => c.team === other).map((c) => nameOf(c.person));
              const names = who.length === 1 ? who[0] : `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}`;
              return `${names} ${who.length === 1 ? 'is' : 'are'} also on ${other.name}, which raids at the same time.`;
            })
            .join(' ')}
        </p>
      )}
      {team.raid && (
        <RaidBanner
          poll={poll}
          raid={team.raid}
          zone={zone}
          label={`${team.name}’s raid`}
          onChange={admin ? async (raid) => onState(await api.lockTeamRaid(poll.id, admin, team.id, raid)) : undefined}
        />
      )}
      {admin && (
        <div className="team-actions">
          <button type="button" className="button small" onClick={() => setEditing(true)}>
            change team
          </button>
          {members.length > 0 && (
            <button type="button" className="button small" aria-expanded={finding} onClick={() => setFinding((f) => !f)}>
              {finding ? 'hide best times' : team.raid ? 'find another time' : 'find a time'}
            </button>
          )}
          {deleting ? (
            <span>
              Delete {team.name}?{' '}
              <button
                type="button"
                className="button small danger"
                onClick={async () => {
                  try {
                    onState(await api.deleteTeam(poll.id, admin, team.id));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                delete it
              </button>{' '}
              <button type="button" className="text-button" onClick={() => setDeleting(false)}>
                keep it
              </button>
            </span>
          ) : (
            <button type="button" className="text-button danger" onClick={() => setDeleting(true)}>
              delete team
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {admin && finding && (
        <div className="team-best">
          <BestTimes
            poll={poll}
            grid={grid}
            people={members.filter((p) => Object.keys(p.marks).length > 0)}
            required={new Set()}
            length={length}
            onLength={setLength}
            nameOf={nameOf}
            zone={zone}
            size={team.size}
            makeup={team.makeup}
            raid={team.raid}
            onLock={async (start, minutes) => {
              onState(await api.lockTeamRaid(poll.id, admin, team.id, { start, minutes, skips: [] }));
              setFinding(false);
            }}
          />
        </div>
      )}
    </section>
  );
}

/** A team's name, size and the people on it, picked from everyone who answered. */
function TeamForm({
  initial,
  people,
  teams,
  slot,
  classes,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial: Draft;
  classes: string[];
  people: Person[];
  /** The other teams, to show who's already on one. */
  teams: Team[];
  slot: number;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (draft: Draft) => Promise<void>;
}) {
  const [name, setName] = useState(initial.name);
  const [size, setSize] = useState(initial.size);
  const [makeup, setMakeup] = useState(initial.makeup);
  const [members, setMembers] = useState<string[]>(initial.members);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const picked = people.filter((p) => members.includes(p.id));
  const nameId = `team-name-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <form
      className="team-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await onSubmit({ name, members, size, makeup: size ? makeup : {} });
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor={nameId}>Team name</label>
        <input id={nameId} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="off" />
      </div>
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
      <fieldset className="field">
        <legend>
          Who’s on it? <span className="muted">{size ? `${picked.length} of ${size}` : `${picked.length} picked`}</span>
        </legend>
        {picked.length > 0 && <Composition people={picked} classes={classes} />}
        <ul className="team-pick">
          {people.map((p) => {
            const elsewhere = teams.filter((t) => t.members.includes(p.id)).map((t) => t.name);
            return (
              <li key={p.id}>
                <label className="person-count">
                  <input
                    type="checkbox"
                    checked={members.includes(p.id)}
                    onChange={(e) =>
                      setMembers((list) => (e.target.checked ? [...list, p.id] : list.filter((id) => id !== p.id)))
                    }
                  />
                  <span className="person-name">{p.name}</span>
                </label>
                <span className="person-meta">
                  <ClassName cls={p.cls} specs={p.specs} spec={p.spec} />
                  <span className="muted">{freeHours(p, slot)}</span>
                  {elsewhere.length > 0 && <span className="muted">on {elsewhere.join(', ')}</span>}
                </span>
              </li>
            );
          })}
        </ul>
        {people.length === 0 && <p className="empty">No one has answered yet.</p>}
      </fieldset>
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
