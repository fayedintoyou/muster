import { useCallback, useEffect, useState } from 'react';
import type { PollState } from '../core/types';
import { type BotLink, LEAD_DAYS, NUDGE_HOURS, REMIND_MINUTES, pingOf } from '../core/bot';
import { POLL_RAID } from '../core/signup';
import { plural } from '../core/format';
import { api } from './api';
import { useCopied } from './copy';
import { DiscordIcon } from './icons';

// The organizer's Discord section: adding the bot to the server, connecting the channel raid posts go to
// with a one-time code, and the guild's own choices once it's connected: how far ahead posts go up,
// reminders, nudges for people who haven't answered, and who each raid's posts ping.

type Info = Awaited<ReturnType<typeof api.bot>>;

const remindLabel = (m: number) => (m === 0 ? 'no reminder' : m < 60 ? `${m} minutes before` : m === 60 ? 'an hour before' : `${m / 60} hours before`);
const nudgeLabel = (h: number) => (h === 0 ? 'no nudge' : h < 24 ? `${h} hours before` : h === 24 ? 'a day before' : `${h / 24} days before`);

export function DiscordPanel({ state, admin }: { state: PollState; admin: string }) {
  const { poll } = state;
  const [info, setInfo] = useState<Info | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, copy] = useCopied();

  const load = useCallback(async () => {
    try {
      setInfo(await api.bot(poll.id, admin));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [poll.id, admin]);

  useEffect(() => {
    void load();
  }, [load]);

  // Waiting for `/muster connect` in Discord: look every few seconds until it's done.
  const linked = Boolean(info?.link);
  useEffect(() => {
    if (!code || linked) return;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [code, linked, load]);

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

  const command = `/muster connect code:${code}`;
  const link = info?.link;

  return (
    <section className="org-section org-discord" aria-labelledby="org-discord">
      <h3 className="org-title" id="org-discord">
        Discord
      </h3>
      {!info ? (
        <p className="muted">{error || 'Looking…'}</p>
      ) : !info.ready ? (
        <p className="hint">The Discord bot isn’t set up on this copy of muster.</p>
      ) : link ? (
        <Connected
          link={link}
          info={info}
          state={state}
          busy={busy}
          onChange={(settings) =>
            run(async () => {
              const { link: next } = await api.botSettings(poll.id, admin, settings);
              setInfo({ ...info, link: next });
            })
          }
          onDisconnect={() =>
            run(async () => {
              await api.botDisconnect(poll.id, admin);
              setCode('');
              await load();
            })
          }
        />
      ) : (
        <>
          <p className="org-count">
            Post each raid night in a Discord channel, with buttons to sign up in one tap. The post keeps itself up to
            date.
          </p>
          <ol className="org-steps">
            <li>
              <a className="button small discord" href={info.invite} target="_blank" rel="noreferrer">
                <DiscordIcon /> add muster to your server
              </a>
            </li>
            <li>
              {code ? (
                <>
                  In the channel for raid posts, send:
                  <span className="org-command">
                    <code>{command}</code>
                    <button type="button" className="button small" onClick={() => copy('command', command)}>
                      {copied === 'command' ? 'copied' : 'copy'}
                    </button>
                  </span>
                  <span className="hint">
                    The code works once, for half an hour. Waiting for it… Only people who can manage events can use
                    it; a server can change who under Server Settings → Integrations → muster.
                  </span>
                </>
              ) : (
                <button
                  type="button"
                  className="button small"
                  disabled={busy}
                  onClick={() => void run(async () => setCode((await api.botCode(poll.id, admin)).code))}
                >
                  get a code to connect a channel
                </button>
              )}
            </li>
          </ol>
        </>
      )}
      {error && info && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function Connected({
  link,
  info,
  state,
  busy,
  onChange,
  onDisconnect,
}: {
  link: BotLink;
  info: Info;
  state: PollState;
  busy: boolean;
  onChange: (settings: Partial<BotLink['settings']>) => void;
  onDisconnect: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const s = link.settings;
  const raids = [
    ...(state.raid ? [{ owner: POLL_RAID, name: state.poll.title }] : []),
    ...state.teams.map((t) => ({ owner: t.id, name: t.name })),
  ];
  const linkedCount = state.people.filter((p) => p.discord).length;

  return (
    <>
      <p className="org-count">
        Raid posts go to <strong>#{link.channelName || 'a channel'}</strong>
        {link.guildName ? ` in ${link.guildName}` : ''}.
      </p>
      <p className="hint">
        {plural(linkedCount, 'person', 'people')} here {linkedCount === 1 ? 'is' : 'are'} linked to Discord, so their
        taps sign them up. Anyone else who taps is shown how to link.
      </p>
      {info.problem && (
        <p className="error" role="alert">
          Discord said: {info.problem}
        </p>
      )}
      <div className="org-bot">
        <label>
          <span>Posts go up</span>
          <select value={s.lead} disabled={busy} onChange={(e) => onChange({ lead: Number(e.target.value) })}>
            {LEAD_DAYS.map((d) => (
              <option key={d} value={d}>
                {d === 1 ? 'a day before' : `${d} days before`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Remind those coming</span>
          <select value={s.remind} disabled={busy} onChange={(e) => onChange({ remind: Number(e.target.value) })}>
            {REMIND_MINUTES.map((m) => (
              <option key={m} value={m}>
                {remindLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Nudge who hasn’t answered, privately</span>
          <select value={s.nudge} disabled={busy} onChange={(e) => onChange({ nudge: Number(e.target.value) })}>
            {NUDGE_HOURS.map((h) => (
              <option key={h} value={h}>
                {nudgeLabel(h)}
              </option>
            ))}
          </select>
        </label>
        {raids.map((r) => (
          <label key={r.owner}>
            <span>New posts for {r.name} ping</span>
            <select
              value={pingOf(s, r.owner)}
              disabled={busy}
              onChange={(e) => onChange({ pings: { [r.owner]: e.target.value } })}
            >
              <option value="members">{r.owner === POLL_RAID ? 'everyone here on Discord' : 'the team’s people on Discord'}</option>
              {info.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  @{role.name}
                </option>
              ))}
              <option value="none">no one</option>
            </select>
          </label>
        ))}
      </div>
      <p className="org-do">
        {leaving ? (
          <>
            Stop posting to Discord? Posts already there stay as they are.{' '}
            <button type="button" className="button small danger" disabled={busy} onClick={onDisconnect}>
              disconnect
            </button>{' '}
            <button type="button" className="text-button" onClick={() => setLeaving(false)}>
              keep it
            </button>
          </>
        ) : (
          <button type="button" className="text-button danger" onClick={() => setLeaving(true)}>
            disconnect discord
          </button>
        )}
      </p>
    </>
  );
}
