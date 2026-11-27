import { type FormEvent, useRef, useState } from 'react';
import type { Marks, Person, Poll, PollState } from '../core/types';
import { LIMITS } from '../core/validate';
import { ApiError, api } from './api';
import { store } from './store';
import { ClassPicker } from './ClassPicker';
import { RoleIcon } from './icons';
import { DiscordButton } from './SignIn';

// Who's answering, after they've marked their times: a name or in-game handle, their class and a spec or
// two (which say what roles they bring), and a note if they like. Saving sends the times along with it.
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
  const [cls, setCls] = useState(() => (poll.classes.includes(store.lastClass()) ? store.lastClass() : ''));
  const [specs, setSpecs] = useState<string[]>(() => (cls ? store.lastSpecs() : []));
  const [classMissing, setClassMissing] = useState<'class' | 'spec' | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState('');
  const marked = Object.keys(marks).length;
  const [nameMissing, setNameMissing] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);
  const [locking, setLocking] = useState(false);
  const [password, setPassword] = useState('');
  const [claim, setClaim] = useState<{ name: string; hasPassword: boolean; discord: boolean } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const join = async (asExisting: boolean) => {
    setError('');
    setBusy(true);
    try {
      const result = await api.join(poll.id, {
        name,
        password: password || undefined,
        roles: poll.classes.length ? undefined : roles,
        cls: poll.classes.length ? cls : undefined,
        specs: poll.classes.length ? specs : undefined,
        note,
        marks,
        claim: asExisting,
      });
      store.setLastName(result.person.name);
      if (roles.length) store.setLastRoles(roles);
      if (cls) {
        store.setLastClass(cls);
        store.setLastSpecs(specs);
      }
      onJoined(result.person, result.token, result.state);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.extra.exists) {
        setClaim({ name: name.trim(), hasPassword: Boolean(err.extra.hasPassword), discord: Boolean(err.extra.discord) });
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // The button stays pressable without a name, so a press always does something: it says what's missing.
    if (!claim && !name.trim()) {
      setNameMissing(true);
      nameField.current?.focus();
      nameField.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    // Class and spec too, on a poll that asks for them (not when signing in as someone who's answered).
    if (!claim && poll.classes.length) {
      const missing = !cls ? 'class' : specs.length === 0 ? 'spec' : null;
      setClassMissing(missing);
      if (missing) {
        pickerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    }
    void join(claim !== null);
  };

  if (claim) {
    return (
      <form className="join" onSubmit={submit} noValidate>
        <h3 className="panel-title">{claim.name} has already answered</h3>
        <p className="lede-small">
          {claim.discord && !claim.hasPassword
            ? `${claim.name} is linked to Discord. If that’s you, sign in with Discord to carry on where you left off. Otherwise pick a different name.`
            : 'If that’s you on another device, carry on where you left off. Otherwise pick a different name.'}
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
          {claim.discord && (
            <DiscordButton pollId={poll.id} label="sign in with discord" />
          )}
          {(claim.hasPassword || !claim.discord) && (
            <button className="button primary" type="submit" disabled={busy || (claim.hasPassword && !password)}>
              {busy ? 'signing in…' : claim.discord ? 'sign in with the password' : `yes, I’m ${claim.name}`}
            </button>
          )}
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
    <form className="join" onSubmit={submit} noValidate>
      <h3 className="panel-title">Then, who’s this?</h3>
      <div className="field">
        <label htmlFor="join-name">Name or in-game handle</label>
        <input
          id="join-name"
          ref={nameField}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (e.target.value.trim()) setNameMissing(false);
          }}
          aria-invalid={nameMissing || undefined}
          aria-describedby={nameMissing ? 'join-name-missing' : undefined}
          maxLength={LIMITS.name}
          autoComplete="nickname"
          placeholder="What the guild calls you"
          required
        />
        {nameMissing && (
          <p className="error" id="join-name-missing" role="alert">
            Add your name or in-game handle.
          </p>
        )}
        <p className="hint">
          Answered already on another device? Use the same name to pick up where you left off, or sign in with
          Discord if you linked it.
        </p>
        <DiscordButton pollId={poll.id} label="sign in with discord" small />
      </div>
      {poll.classes.length === 0 && poll.roles.length > 0 && (
        <fieldset className="field">
          <legend>What do you play?</legend>
          <div className="day-chips">
            {poll.roles.map((role) => (
              <button
                type="button"
                key={role}
                className="chip icon-chip"
                aria-pressed={roles.includes(role)}
                onClick={() => setRoles((list) => (list.includes(role) ? list.filter((r) => r !== role) : [...list, role]))}
              >
                <RoleIcon role={role} />
                {role}
              </button>
            ))}
          </div>
          <p className="hint">Pick every role you’d bring.</p>
        </fieldset>
      )}
      {poll.classes.length > 0 && (
        <div ref={pickerRef}>
          <ClassPicker
            classes={poll.classes}
            cls={cls}
            specs={specs}
            idPrefix="join"
            missing={classMissing && (classMissing === 'class' ? (cls ? null : 'class') : specs.length ? null : 'spec')}
            onChange={(c, s) => {
              setCls(c);
              setSpecs(s);
            }}
          />
        </div>
      )}
      <div className="field">
        <label htmlFor="join-note">
          A note for the organizer <span className="muted">(optional)</span>
        </label>
        <textarea
          id="join-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={LIMITS.note}
          rows={2}
          placeholder="Anything your times don’t say, like “Fridays I might be 30 minutes late”"
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
        <p className="hint join-locks">
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
      {marked === 0 && <p className="hint">You can add your times after saving.</p>}
      <button className="button primary wide" type="submit" disabled={busy}>
        {busy ? 'saving…' : 'save my times'}
      </button>
    </form>
  );
}
