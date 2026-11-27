import { useId, useState } from 'react';
import type { Person } from '../core/types';
import { LIMITS } from '../core/validate';
import { api } from './api';
import { DiscordIcon } from './icons';

// Keeping your answers yours: a password, a linked Discord account, or both. Without either, anyone who
// types your name can carry on as you, which is fine for a lot of guilds.

/** What came back from Discord, from the hash the Worker sent the browser back with. Clears the hash. */
export function discordReturn(): {
  outcome: string;
  as?: string;
  person?: string;
  token?: string;
  /** Signed in with Discord but not in the poll yet: lets their answers be saved linked to it. */
  ticket?: string;
} | null {
  const params = new URLSearchParams(location.hash.slice(1));
  const outcome = params.get('discord');
  if (!outcome) return null;
  history.replaceState(null, '', location.pathname);
  return {
    outcome,
    as: params.get('as') ?? undefined,
    person: params.get('person') ?? undefined,
    token: params.get('token') ?? undefined,
    ticket: params.get('ticket') ?? undefined,
  };
}

export function discordMessage(back: { outcome: string; as?: string }): string {
  switch (back.outcome) {
    case 'signedin':
      return 'Signed in with Discord.';
    case 'linked':
      return `Linked to Discord as ${back.as ?? 'you'}. On another device, sign in with Discord.`;
    case 'taken':
      return 'That Discord account is already linked to someone else in this poll.';
    case 'none':
      // The join form says what happens next.
      return '';
    case 'cancelled':
      return '';
    default:
      return 'Discord sign-in didn’t finish. Try again.';
  }
}

/** Sends the browser to Discord, to sign in, or with `link` to link the account to that person. */
export function DiscordButton({
  pollId,
  link,
  label,
  small = false,
}: {
  pollId: string;
  link?: { person: string; token?: string };
  label: string;
  small?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <button
        type="button"
        className={`button discord${small ? ' small' : ''}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const { url } = await api.discord(pollId, link);
            location.assign(url);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setBusy(false);
          }
        }}
      >
        <DiscordIcon />
        {busy ? 'off to discord…' : label}
      </button>
      {error && (
        <span className="error" role="alert">
          {' '}
          {error}
        </span>
      )}
    </>
  );
}

/** Under your times: how your answers are kept yours, and changing that. */
export function MySignIn({
  pollId,
  me,
  token,
  discordOnly = false,
  onPerson,
}: {
  pollId: string;
  me: Person;
  /** The poll asks everyone to sign in with Discord. */
  discordOnly?: boolean;
  token?: string;
  onPerson: (person: Person) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fieldId = `password-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const save = async (input: { password?: string; discord?: null }) => {
    setBusy(true);
    setError('');
    try {
      const { person } = await api.save(pollId, me.id, { token }, input);
      onPerson(person);
      setEditing(false);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="my-lock">
      <p className={discordOnly && !me.discord ? 'my-lock-ask' : 'muted'}>
        {discordOnly && !me.discord
          ? 'This poll asks everyone to link Discord. Until you do, anyone who types your name can change your answers.'
          : me.discord && me.hasPassword
          ? 'Your answers are locked with a password, and linked to Discord.'
          : me.discord
            ? 'Your answers are linked to Discord: sign in with it on any device.'
            : me.hasPassword
              ? 'Your answers are locked with a password.'
              : 'Anyone who types your name can change your answers. Lock them if you like.'}
      </p>
      {editing ? (
        <form
          className="my-lock-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) void save({ password });
          }}
        >
          <label htmlFor={fieldId}>{me.hasPassword ? 'New password' : 'Password'}</label>
          <input
            id={fieldId}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            maxLength={LIMITS.password}
            autoFocus
          />
          <button type="submit" className="button small primary" disabled={busy || !password}>
            {busy ? 'saving…' : 'save password'}
          </button>
          <button type="button" className="text-button" onClick={() => setEditing(false)}>
            cancel
          </button>
        </form>
      ) : (
        <div className="my-lock-actions">
          {me.discord ? (
            <button type="button" className="text-button" disabled={busy} onClick={() => void save({ discord: null })}>
              unlink discord
            </button>
          ) : (
            <DiscordButton pollId={pollId} link={{ person: me.id, token }} label="link discord" small />
          )}
          <button type="button" className="text-button" onClick={() => setEditing(true)}>
            {me.hasPassword ? 'change password' : 'lock with a password'}
          </button>
          {me.hasPassword && (
            <button type="button" className="text-button" disabled={busy} onClick={() => void save({ password: '' })}>
              remove password
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
