import { useState } from 'react';
import type { Person, PollState } from '../core/types';
import { LIMITS } from '../core/validate';
import { plural } from '../core/format';
import { api } from './api';
import { navigate } from './App';
import { ClassName } from './ClassPicker';
import { DiscordPanel } from './DiscordPanel';
import { PollForm } from './PollForm';
import { useCopied } from './copy';
import { store } from './store';

// The organizer's tab, for a browser holding the poll's private link or an officer signed in with
// Discord: who's answered and who hasn't, helping someone who's locked out, renaming or removing people,
// closing the poll to new answers, sharing, and changing the poll. Only the maker's link picks officers
// and deletes the poll.

export function Organizer({
  state,
  admin,
  maker,
  meId,
  onState,
  onPerson,
  onRemove,
}: {
  state: PollState;
  admin: string;
  /** The maker's private link, rather than an officer's sign-in. */
  maker: boolean;
  meId?: string;
  onState: (s: PollState) => void;
  onPerson: (person: Person) => void;
  onRemove: (id: string) => Promise<void>;
}) {
  const { poll, people } = state;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, copy] = useCopied();
  const quiet = people.filter((p) => Object.keys(p.marks).length === 0);
  const pollLink = `${location.origin}/e/${poll.id}`;
  const adminLink = `${pollLink}#admin=${admin}`;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="organizer">
      <h2 className="panel-heading">Organizer</h2>
      <p className="hint">
        {maker
          ? 'Only organizers see this tab: you, because this browser holds the poll’s private link, and any officers you pick.'
          : 'You see this tab because you’re an officer of this poll.'}
      </p>

      <section className="org-section" aria-labelledby="org-answers">
        <h3 className="org-title" id="org-answers">
          Answers
        </h3>
        <p className="org-count">
          {people.length === 0
            ? 'No one has answered yet.'
            : `${plural(people.length - quiet.length, 'person', 'people')} with times${quiet.length ? `, ${quiet.length} still to mark any` : ''}.`}
        </p>
        {quiet.length > 0 && (
          <p className="hint">
            No times yet: {quiet.map((p) => p.name).join(', ')}.
          </p>
        )}
        <div className="org-closed">
          <p className={poll.closed ? 'org-status' : 'muted'}>
            {poll.closed
              ? 'Closed to new answers. People who’ve answered can still change theirs.'
              : 'Open: anyone with the link can answer.'}
          </p>
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={() => void run(async () => onState(await api.update(poll.id, admin, { closed: !poll.closed })))}
          >
            {poll.closed ? 'open to new answers' : 'close to new answers'}
          </button>
        </div>
      </section>

      <section className="org-section" aria-labelledby="org-people">
        <h3 className="org-title" id="org-people">
          People
        </h3>
        {people.length === 0 ? (
          <p className="hint">Share the link to invite people.</p>
        ) : (
          <ul className="org-people">
            {people.map((p) => (
              <OrgPerson
                key={p.id}
                pollId={poll.id}
                admin={admin}
                person={p}
                isMe={p.id === meId}
                officer={state.officers.includes(p.id)}
                onPerson={onPerson}
                onState={onState}
                onRemove={onRemove}
              />
            ))}
          </ul>
        )}
      </section>

      {maker && <Officers state={state} admin={admin} onState={onState} />}

      <DiscordPanel state={state} admin={admin} />

      <section className="org-section" aria-labelledby="org-share">
        <h3 className="org-title" id="org-share">
          Sharing
        </h3>
        <p className="org-actions">
          <button type="button" className="button small" onClick={() => copy('link', pollLink)}>
            {copied === 'link' ? 'link copied' : 'copy link'}
          </button>
          {maker && (
            <button type="button" className="button small" onClick={() => copy('admin', adminLink)}>
              {copied === 'admin' ? 'private link copied' : 'copy private link'}
            </button>
          )}
        </p>
        {maker && (
          <p className="hint">
            The private link is yours: whoever opens it can do everything you can, on any device, including delete the
            poll. To share the organizing, pick officers instead.
          </p>
        )}
      </section>

      <details className="org-section org-edit">
        <summary>Change days, times and more</summary>
        <ChangePoll state={state} admin={admin} onState={onState} />
      </details>

      {maker && <DeletePoll state={state} admin={admin} />}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function OrgPerson({
  pollId,
  admin,
  person: p,
  isMe,
  officer,
  onPerson,
  onState,
  onRemove,
}: {
  pollId: string;
  admin: string;
  person: Person;
  isMe: boolean;
  officer: boolean;
  onPerson: (person: Person) => void;
  onState: (s: PollState) => void;
  onRemove: (id: string) => Promise<void>;
}) {
  const [doing, setDoing] = useState<'rename' | 'unlock' | 'remove' | null>(null);
  const [name, setName] = useState(p.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Your own lock you change under your times; unlocking yourself here would sign you out.
  const locked = (p.hasPassword || p.discord) && !isMe;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      setDoing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li>
      <span className="org-name">
        {p.name}
        {isMe && <span className="muted"> (you)</span>}
      </span>
      <span className="person-meta org-meta">
        <ClassName cls={p.cls} specs={p.specs} spec={p.spec} />
        {officer && <span className="org-officer">officer</span>}
        {p.level60 === false && <span className="levelling">levelling</span>}
        {Object.keys(p.marks).length === 0 && <span>no times yet</span>}
        {p.discord && <span>discord</span>}
        {p.hasPassword && <span>password</span>}
      </span>
      {doing === 'rename' ? (
        <form
          className="org-do"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => onPerson((await api.save(pollId, p.id, { admin }, { name })).person));
          }}
        >
          <input
            aria-label={`New name for ${p.name}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={LIMITS.name}
            autoFocus
          />
          <button type="submit" className="button small primary" disabled={busy || !name.trim()}>
            rename
          </button>
          <button type="button" className="text-button" onClick={() => setDoing(null)}>
            cancel
          </button>
        </form>
      ) : doing === 'unlock' ? (
        <p className="org-do">
          Take off {p.name}’s {p.hasPassword && p.discord ? 'password and Discord link' : p.hasPassword ? 'password' : 'Discord link'}{' '}
          and sign them out everywhere? Then they sign back in by typing their name.{' '}
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={() => void run(async () => onState(await api.unlock(pollId, p.id, admin)))}
          >
            unlock
          </button>{' '}
          <button type="button" className="text-button" onClick={() => setDoing(null)}>
            cancel
          </button>
        </p>
      ) : doing === 'remove' ? (
        <p className="org-do">
          Remove {p.name} and their answers?{' '}
          <button type="button" className="button small danger" disabled={busy} onClick={() => void run(() => onRemove(p.id))}>
            remove
          </button>{' '}
          <button type="button" className="text-button" onClick={() => setDoing(null)}>
            keep
          </button>
        </p>
      ) : (
        <span className="org-person-actions">
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setName(p.name);
              setDoing('rename');
            }}
          >
            rename
          </button>
          {locked && (
            <button type="button" className="text-button" onClick={() => setDoing('unlock')}>
              unlock
            </button>
          )}
          <button type="button" className="text-button danger" onClick={() => setDoing('remove')}>
            remove
          </button>
        </span>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** Officers organize too, signed in with Discord: everything here but picking officers and deleting the poll. */
function Officers({ state, admin, onState }: { state: PollState; admin: string; onState: (s: PollState) => void }) {
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const officers = state.officers.map((id) => state.people.find((p) => p.id === id)).filter((p): p is Person => Boolean(p));
  const candidates = state.people.filter((p) => p.discord && !state.officers.includes(p.id));
  const set = async (personId: string, officer: boolean) => {
    setBusy(true);
    setError('');
    try {
      onState(await api.officer(state.poll.id, personId, admin, officer));
      setPick('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="org-section" aria-labelledby="org-officers">
      <h3 className="org-title" id="org-officers">
        Officers
      </h3>
      <p className="hint">
        Officers can do everything here except pick officers or delete the poll. They sign in with Discord, so it works on
        any device and you can take it back.
      </p>
      {officers.length > 0 && (
        <ul className="org-officers">
          {officers.map((p) => (
            <li key={p.id}>
              <span>{p.name}</span>
              <button type="button" className="text-button" disabled={busy} onClick={() => void set(p.id, false)}>
                stand down
              </button>
            </li>
          ))}
        </ul>
      )}
      {candidates.length > 0 ? (
        <form
          className="org-actions"
          onSubmit={(e) => {
            e.preventDefault();
            if (pick) void set(pick, true);
          }}
        >
          <select aria-label="Make an officer" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">pick someone…</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" className="button small" disabled={busy || !pick}>
            make officer
          </button>
        </form>
      ) : (
        <p className="hint">
          {officers.length ? 'Anyone else' : 'Anyone'} you’d make an officer needs to answer and link Discord first.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ChangePoll({ state, admin, onState }: { state: PollState; admin: string; onState: (s: PollState) => void }) {
  const [saved, setSaved] = useState(false);
  const answered = state.people.some((p) => Object.keys(p.marks).length > 0);
  return (
    <PollForm
      key={state.poll.updated}
      initial={state.poll}
      editing
      answered={answered}
      submitLabel={saved ? 'saved' : 'save changes'}
      busyLabel="saving…"
      onSubmit={async (settings) => {
        const next = await api.update(state.poll.id, admin, settings);
        onState(next);
        store.remember(next.poll, true);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2000);
      }}
    />
  );
}

function DeletePoll({ state, admin }: { state: PollState; admin: string }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="danger-zone">
      {deleting ? (
        <p>
          Delete “{state.poll.title}” and everyone’s answers?{' '}
          <button
            type="button"
            className="button small danger"
            onClick={async () => {
              try {
                await api.destroy(state.poll.id, admin);
                store.forget(state.poll.id);
                navigate('/');
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            delete it
          </button>{' '}
          <button type="button" className="button small" onClick={() => setDeleting(false)}>
            keep it
          </button>
        </p>
      ) : (
        <button type="button" className="text-button danger" onClick={() => setDeleting(true)}>
          delete this poll
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
