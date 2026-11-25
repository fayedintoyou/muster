import { type FormEvent, useState } from 'react';
import type { Person, Poll, PollState } from '../core/types';
import { LIMITS } from '../core/validate';
import { ApiError, api } from './api';
import { store } from './store';

export function JoinForm({
  poll,
  onJoined,
}: {
  poll: Poll;
  onJoined: (person: Person, token: string, state: PollState) => void;
}) {
  const [name, setName] = useState(() => store.lastName());
  const [roles, setRoles] = useState<string[]>(() => store.lastRoles().filter((r) => poll.roles.includes(r)));
  const [locking, setLocking] = useState(false);
  const [password, setPassword] = useState('');
  const [claim, setClaim] = useState<{ name: string; hasPassword: boolean } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const join = async (asExisting: boolean) => {
    setError('');
    setBusy(true);
    try {
      const result = await api.join(poll.id, { name, password: password || undefined, roles, claim: asExisting });
      store.setLastName(result.person.name);
      if (roles.length) store.setLastRoles(roles);
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
      <h3 className="panel-title">Add your times</h3>
      <p className="first-steps">
        Put your name in, then drag over the hours you’re free. After that you can see everyone’s answers and
        the nights that suit the most people.
      </p>
      <div className="field">
        <label htmlFor="join-name">Your name</label>
        <input
          id="join-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={LIMITS.name}
          autoComplete="nickname"
          placeholder="The name the guild knows you by"
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
      <button className="button primary wide" type="submit" disabled={busy || !name.trim()}>
        {busy ? 'joining…' : 'start marking times'}
      </button>
    </form>
  );
}
