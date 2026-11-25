import { type FormEvent, useState } from 'react';
import type { Marks, Person, Poll, PollState } from '../core/types';
import { LIMITS } from '../core/validate';
import { ApiError, api } from './api';
import { store } from './store';

// Who's answering, after they've marked their times: a name or in-game handle, the roles they'd bring
// and, if they like, a class and spec. Saving sends the times along with it.
export function JoinForm({
  poll,
  marks,
  onJoined,
}: {
  poll: Poll;
  /** The times marked so far on this device. */
  marks: Marks;
  onJoined: (person: Person, token: string, state: PollState) => void;
}) {
  const [name, setName] = useState(() => store.lastName());
  const [roles, setRoles] = useState<string[]>(() => store.lastRoles().filter((r) => poll.roles.includes(r)));
  const [spec, setSpec] = useState(() => store.lastSpec());
  const marked = Object.keys(marks).length;
  const [locking, setLocking] = useState(false);
  const [password, setPassword] = useState('');
  const [claim, setClaim] = useState<{ name: string; hasPassword: boolean } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const join = async (asExisting: boolean) => {
    setError('');
    setBusy(true);
    try {
      const result = await api.join(poll.id, {
        name,
        password: password || undefined,
        roles,
        spec,
        marks,
        claim: asExisting,
      });
      store.setLastName(result.person.name);
      if (roles.length) store.setLastRoles(roles);
      store.setLastSpec(spec.trim());
      onJoined(result.person, result.token, result.state);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.extra.exists) {
        setClaim({ name: name.trim(), hasPassword: Boolean(err.extra.hasPassword) });
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void join(claim !== null);
  };

  if (claim) {
    return (
      <form className="join" onSubmit={submit}>
        <h3 className="panel-title">{claim.name} has already answered</h3>
        <p className="lede-small">
          If that’s you on another device, carry on where you left off. Otherwise pick a different name.
          {marked > 0 && ' If you’d already marked times there, those are kept rather than the ones above.'}
        </p>
        {claim.hasPassword && (
          <div className="field">
            <label htmlFor="claim-password">{claim.name}’s password</label>
            <input
              id="claim-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          <button className="button primary" type="submit" disabled={busy || (claim.hasPassword && !password)}>
            {busy ? 'signing in…' : `yes, I’m ${claim.name}`}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              setClaim(null);
              setPassword('');
              setError('');
            }}
          >
            use another name
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="join" onSubmit={submit}>
      <h3 className="panel-title">Then, who’s this?</h3>
      <div className="field">
        <label htmlFor="join-name">Name or in-game handle</label>
        <input
          id="join-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={LIMITS.name}
          autoComplete="nickname"
          placeholder="What the guild calls you"
          required
        />
        <p className="hint">Answered already on another device? Use the same name to pick up where you left off.</p>
      </div>
      {poll.roles.length > 0 && (
        <fieldset className="field">
          <legend>What do you play?</legend>
          <div className="day-chips">
            {poll.roles.map((role) => (
              <button
                type="button"
                key={role}
                className="chip"
                aria-pressed={roles.includes(role)}
                onClick={() => setRoles((list) => (list.includes(role) ? list.filter((r) => r !== role) : [...list, role]))}
              >
                {role}
              </button>
            ))}
          </div>
          <p className="hint">Pick every role you’d bring.</p>
        </fieldset>
      )}
      <div className="field">
        <label htmlFor="join-spec">
          Class and spec <span className="muted">(optional)</span>
        </label>
        <input
          id="join-spec"
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          maxLength={LIMITS.spec}
          autoComplete="off"
          placeholder="Resto shaman, or a main and an alt"
        />
      </div>
      {locking ? (
        <div className="field">
          <label htmlFor="join-password">Password (optional)</label>
          <input
            id="join-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            maxLength={LIMITS.password}
          />
          <p className="hint">Without one, anyone who types your name can change your answers.</p>
        </div>
      ) : (
        <p className="hint">
          <button type="button" className="text-button" onClick={() => setLocking(true)}>
            lock my answers with a password
          </button>
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {marked === 0 && <p className="hint">You haven’t marked any times above yet. You can save now and mark them after.</p>}
      <button className="button primary wide" type="submit" disabled={busy || !name.trim()}>
        {busy ? 'saving…' : 'save my times'}
      </button>
    </form>
  );
}
