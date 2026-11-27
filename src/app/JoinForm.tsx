import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { Marks, Person, Poll, PollState } from '../core/types';
import { LIMITS } from '../core/validate';
import { ApiError, api } from './api';
import { store } from './store';
import { ClassPicker } from './ClassPicker';
import { RoleIcon } from './icons';
import { DiscordButton } from './SignIn';
import { DiscordIcon } from './icons';

// Who's answering, after they've marked their times: their character's name, their class and a spec or
// two (which say what roles they bring), and a note if they like. Saving sends the times along with it.
export function JoinForm({
  poll,
  marks,
  discord,
  onJoined,
}: {
  poll: Poll;
  /** The times marked so far on this device. */
  marks: Marks;
  /** Signed in with Discord already: saving links the answers to it. */
  discord?: { name: string; ticket: string };
  onJoined: (person: Person, token: string, state: PollState) => void;
}) {
  // A character's name, not a Discord one, so Discord doesn't fill it in.
  const [name, setName] = useState(() => store.lastName());
  const [roles, setRoles] = useState<string[]>(() => store.lastRoles().filter((r) => poll.roles.includes(r)));
  const [cls, setCls] = useState(() => (poll.classes.includes(store.lastClass()) ? store.lastClass() : ''));
  const [specs, setSpecs] = useState<string[]>(() => (cls ? store.lastSpecs() : []));
  const [classMissing, setClassMissing] = useState<'class' | 'spec' | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState('');
  const [level60, setLevel60] = useState(false);
  const marked = Object.keys(marks).length;
  const [nameMissing, setNameMissing] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);
  const [locking, setLocking] = useState(false);
  const [password, setPassword] = useState('');
  const [claim, setClaim] = useState<{ name: string; hasPassword: boolean; discord: boolean } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Back from Discord, where the page opens at the top: show what happens next.
  useEffect(() => {
    if (discord) formRef.current?.scrollIntoView({ block: 'start' });
  }, [discord]);

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
        level60,
        marks,
        claim: asExisting,
        discordTicket: discord?.ticket,
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

  // A poll that wants everyone through Discord: that's the only way in.
  if (poll.discordOnly && !discord) {
    return (
      <div className="join">
        <h3 className="panel-title">Then, who’s this?</h3>
        <p className="lede-small">
          This poll asks everyone to sign in with Discord, so no one can take someone else’s name.
          {marked > 0 && ' The times you’ve marked are kept.'}
        </p>
        <DiscordButton pollId={poll.id} label="sign in with discord" />
      </div>
    );
  }

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
    <form className="join" ref={formRef} onSubmit={submit} noValidate>
      <h3 className="panel-title">Then, who’s this?</h3>
      {discord && (
        <p className="discord-joined" role="status">
          <DiscordIcon />
          <span>
            Signed in with Discord as <strong>{discord.name}</strong>. Save your times and they’re linked to it, so
            Discord signs you in anywhere. Answered here before on another device? Use the same character name.
          </span>
        </p>
      )}
      <div className="field">
        <label htmlFor="join-name">Character name</label>
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
          placeholder="Your main, as it shows in game"
          required
        />
        {nameMissing && (
          <p className="error" id="join-name-missing" role="alert">
            Add your character’s name.
          </p>
        )}
        {!discord && (
          <>
            <p className="hint">
              Answered already on another device? Use the same character name to pick up where you left off, or sign in with
              Discord.
            </p>
            <DiscordButton pollId={poll.id} label="sign in with discord" small />
          </>
        )}
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
      <label className="check join-level">
        <input type="checkbox" checked={level60} onChange={(e) => setLevel60(e.target.checked)} />
        <span>I’m level 60</span>
      </label>
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
      {discord ? null : locking ? (
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
