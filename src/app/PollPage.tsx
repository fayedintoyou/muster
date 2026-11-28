import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Mark, Marks, Person, PollState } from '../core/types';
import { buildGrid } from '../core/grid';
import { sharedSlots, tallySlots } from '../core/best';
import { formatDuration, formatRange, plural, serverTime, zonePlace } from '../core/format';
import { MINUTE } from '../core/time';
import { LIMITS } from '../core/validate';
import { ApiError, api } from './api';
import { Wordmark, navigate } from './App';
import { BestTimes } from './BestTimes';
import { RaidBanner } from './RaidBanner';
import { TeamsPanel } from './TeamsPanel';
import { MySignIn, discordMessage, discordReturn } from './SignIn';
import { EventPanel, SignupButtons } from './Signups';
import { ANSWER_TOUR, Tour, tourSeen } from './Tour';
import { nextRaid } from '../core/raid';
import { POLL_RAID, eventKey } from '../core/signup';
import { slotLabel } from './GridFrame';
import { HeatGlance, HeatGrid } from './HeatGrid';
import { JoinForm } from './JoinForm';
import { PaintGrid } from './PaintGrid';
import { People } from './People';
import { Organizer } from './Organizer';
import { ZonePicker } from './ZonePicker';
import { ClassPicker } from './ClassPicker';
import { Composition } from './Composition';
import { RoleIcon } from './icons';
import { useCopied } from './copy';
import { GLOW_GRADIENT } from './glow';
import { type Membership, detectedZone, store } from './store';

type Tab = 'mine' | 'group' | 'best' | 'teams' | 'organizer';
type SaveState = 'idle' | 'waiting' | 'saving' | 'saved' | 'error';

const REFRESH_MS = 15_000;
/** After this long without a touch, click or key, refresh every fourth tick instead. */
const IDLE_MS = 5 * 60_000;

export function PollPage({ id }: { id: string }) {
  const [state, setState] = useState<PollState | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  // Back from Discord: signed in, linked, or why not. Read once, before the hash is cleared.
  const [fromDiscord] = useState(discordReturn);
  const [discordNote, setDiscordNote] = useState(() => (fromDiscord ? discordMessage(fromDiscord) : ''));
  // Signed in with Discord, but not in this poll yet: answering links them.
  const [discordJoin] = useState(() =>
    fromDiscord?.outcome === 'none' && fromDiscord.ticket ? { name: fromDiscord.as ?? '', ticket: fromDiscord.ticket } : undefined,
  );
  const [membership, setMembershipState] = useState<Membership>(() => {
    // The maker's private link, /e/<id>#admin=<token>, makes this browser able to change the poll too.
    const fromLink = /^#admin=([\w-]{16,})$/.exec(location.hash)?.[1];
    const saved = store.membership(id);
    if (fromDiscord?.outcome === 'signedin' && fromDiscord.person && fromDiscord.token) {
      const next = { ...saved, personId: fromDiscord.person, token: fromDiscord.token };
      store.setMembership(id, next);
      return next;
    }
    if (!fromLink) return saved;
    history.replaceState(null, '', location.pathname);
    const next = { ...saved, admin: fromLink };
    store.setMembership(id, next);
    return next;
  });
  const [zone, setZoneState] = useState(() => store.zone() ?? detectedZone());
  const [justMade] = useState(() => {
    const made = sessionStorage.getItem('muster:made') === id;
    if (made) sessionStorage.removeItem('muster:made');
    return made;
  });
  const [tab, setTab] = useState<Tab | null>(null);
  // A class just switched to, waiting for its spec before it can save (a class needs one).
  const [classDraft, setClassDraft] = useState<{ cls: string; specs: string[] } | null>(null);
  const [tool, setTool] = useState<Mark>(2);
  const [draft, setDraft] = useState<Marks | null>(null);
  /** Times marked before saying who you are; they go along with the join. */
  // Kept for this tab, so a trip to Discord to sign in doesn't lose what you'd marked.
  const [unsaved, setUnsavedState] = useState<Marks>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(`muster:unsaved:${id}`) ?? '{}') as Marks;
    } catch {
      return {};
    }
  });
  const setUnsaved = useCallback(
    (marks: Marks) => {
      setUnsavedState(marks);
      try {
        if (Object.keys(marks).length) sessionStorage.setItem(`muster:unsaved:${id}`, JSON.stringify(marks));
        else sessionStorage.removeItem(`muster:unsaved:${id}`);
      } catch {
        // Private browsing: the marks just don't survive a reload.
      }
    },
    [id],
  );
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [required, setRequired] = useState<ReadonlySet<string>>(new Set());
  const [length, setLength] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  // Traced on the everyone grid until let go: someone picked from the list, or your own times. One at a time.
  const [pinned, setPinned] = useState<string | null>(null);
  const [withMe, setWithMe] = useState(false);
  const heatRef = useRef<HTMLDivElement>(null);
  const [copied, copy] = useCopied();
  // The guided tour, offered once to someone who hasn't answered yet.
  const [touring, setTouring] = useState(false);
  const tourOffered = useRef(false);

  const version = useRef<number | undefined>(undefined);
  const mine = useRef<{ id?: string; updated: number }>({ id: membership.personId, updated: 0 });

  const setMembership = useCallback(
    (m: Membership) => {
      store.setMembership(id, m);
      setMembershipState(m);
      mine.current = { id: m.personId, updated: 0 };
    },
    [id],
  );

  const setZone = (tz: string) => {
    setZoneState(tz);
    store.setZone(tz === detectedZone() ? undefined : tz);
  };

  // A fresh read never replaces your own answers with an older copy than the one you just saved.
  const applyState = useCallback((next: PollState) => {
    version.current = next.version;
    setState((prev) => {
      const me = prev?.people.find((p) => p.id === mine.current.id);
      if (!me) return next;
      return { ...next, people: next.people.map((p) => (p.id === me.id && p.updated < me.updated ? me : p)) };
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const first = version.current === undefined;
        const next = await api.read(id, version.current);
        if (!alive || !next) return;
        // A read sent before a join or an edit can land after it: never step back to an older poll.
        if (version.current !== undefined && next.version < version.current) return;
        applyState(next);
        if (first) store.remember(next.poll, Boolean(store.membership(id).admin));
      } catch (err) {
        if (!alive) return;
        if (version.current === undefined || (err instanceof ApiError && err.status === 404)) {
          setFailure(err instanceof ApiError ? err : new ApiError(String(err), 0));
        }
      }
    };
    void load();
    let active = Date.now();
    let ticks = 0;
    const touched = () => {
      active = Date.now();
    };
    const timer = window.setInterval(() => {
      ticks++;
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - active > IDLE_MS && ticks % 4 !== 0) return;
      void load();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        touched();
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pointerdown', touched);
    window.addEventListener('keydown', touched);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pointerdown', touched);
      window.removeEventListener('keydown', touched);
    };
  }, [id, applyState]);

  const poll = state?.poll;
  const me = state?.people.find((p) => p.id === membership.personId);

  // An officer organizes from their own Discord sign-in, and stops when they're stood down.
  const officer = Boolean(me && me.discord && state?.officers.includes(me.id));
  const organizing = useRef(false);
  useEffect(() => {
    if (!state) return;
    if (membership.officer && !officer) {
      setMembership({ personId: membership.personId, token: membership.token });
    } else if (officer && !membership.admin && membership.token && !organizing.current) {
      organizing.current = true;
      api
        .organize(id, membership.token)
        .then(({ admin }) => setMembership({ ...store.membership(id), admin, officer: true }))
        .catch(() => {})
        .finally(() => {
          organizing.current = false;
        });
    }
  }, [state, officer, membership, id, setMembership]);

  // Removed from the poll (by its maker, or on another device): back to the join form.
  useEffect(() => {
    if (state && membership.personId && !me) setMembership(signedOut(membership));
  }, [state, me, membership, setMembership]);

  useEffect(() => {
    if (poll) document.title = `${poll.title} · muster`;
  }, [poll]);

  useEffect(() => {
    if (!state || tab) return;
    // Back from linking Discord, you land where you started it.
    const linking = fromDiscord?.outcome === 'linked' || fromDiscord?.outcome === 'taken';
    setTab(me && Object.keys(me.marks).length > 0 && !linking ? 'group' : 'mine');
  }, [state, me, tab, fromDiscord]);

  useEffect(() => {
    if (!state || me || tab !== 'mine' || tourOffered.current) return;
    tourOffered.current = true;
    if (!tourSeen()) setTouring(true);
  }, [state, me, tab]);

  // Saving: answers save themselves half a second after the last change.
  const pending = useRef<Marks | null>(null);
  const saving = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const auth = useRef(membership);
  auth.current = membership;

  const flush = useCallback(
    async (keepalive = false) => {
      const who = auth.current;
      if (saving.current || !pending.current || !who.personId) return;
      const marks = pending.current;
      pending.current = null;
      saving.current = true;
      setSaveState('saving');
      try {
        const { person } = await api.save(id, who.personId, { token: who.token, admin: who.admin }, { marks }, keepalive);
        mine.current = { id: person.id, updated: person.updated };
        setState((prev) => prev && { ...prev, people: prev.people.map((p) => (p.id === person.id ? person : p)) });
        if (!pending.current) {
          setDraft(null);
          setSaveState('saved');
        }
      } catch (err) {
        pending.current = pending.current ?? marks;
        setSaveError(err instanceof Error ? err.message : String(err));
        setSaveState('error');
      } finally {
        saving.current = false;
        if (pending.current && !keepalive) saveTimer.current = window.setTimeout(() => void flush(), 300);
      }
    },
    [id],
  );

  useEffect(() => {
    const onHide = () => {
      window.clearTimeout(saveTimer.current);
      void flush(true);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [flush]);

  const paint = (marks: Marks) => {
    setDraft(marks);
    pending.current = marks;
    setSaveState('waiting');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), 500);
  };

  const myMarks = me ? (draft ?? me.marks) : unsaved;
  const nothingMarked = Object.keys(myMarks).length === 0;

  const people: Person[] = useMemo(
    () => (state ? state.people.map((p) => (p.id === me?.id && draft ? { ...p, marks: draft } : p)) : []),
    [state, me?.id, draft],
  );
  const counted = useMemo(
    () => people.filter((p) => !excluded.has(p.id) && Object.keys(p.marks).length > 0),
    [people, excluded],
  );
  const countedRequired = useMemo(
    () => new Set([...required].filter((rid) => counted.some((p) => p.id === rid))),
    [required, counted],
  );

  const grid = useMemo(
    () => (poll ? buildGrid(poll, zone) : null),
    // Rebuild when the poll's shape or the zone changes, not on every refresh.
    [poll?.updated, poll?.id, zone],
  );
  const tallies = useMemo(() => (grid ? tallySlots(grid, counted) : new Map()), [grid, counted]);

  if (failure) {
    return (
      <div className="poll-page">
        <header className="topbar">
          <Wordmark />
        </header>
        <main className="page narrow">
          <h1 className="title">{failure.status === 404 ? 'No poll here' : 'Couldn’t open the poll'}</h1>
          <p className="lede">
            {failure.status === 404
              ? 'This poll doesn’t exist, or whoever made it deleted it. Check the link you were sent.'
              : failure.message}
          </p>
          <p>
            <a className="button primary" href="/" onClick={(e) => (e.preventDefault(), navigate('/'))}>
              make a new poll
            </a>
          </p>
        </main>
      </div>
    );
  }

  if (!state || !poll || !grid) {
    return (
      <div className="poll-page">
        <header className="topbar">
          <Wordmark />
        </header>
        <main className="page narrow">
          <p className="loading" role="status">
            Opening the poll…
          </p>
        </main>
      </div>
    );
  }

  const link = `${location.origin}/e/${id}`;
  const nameOf = (pid: string) => state.people.find((p) => p.id === pid)?.name ?? 'someone';
  const firstSlot = grid.columns[0]?.slots[0];
  const nightEnd = firstSlot ? firstSlot.instant + grid.columns[0].slots.length * poll.slot * MINUTE : 0;
  const nightRange = firstSlot ? formatRange(firstSlot.instant, nightEnd, zone) : '';
  const serverRange = firstSlot ? serverTime(poll.realm, zone, firstSlot.instant, nightEnd) : null;
  const onServerTime = Boolean(poll.realm && firstSlot && !serverRange);
  const when =
    poll.mode === 'weekly'
      ? `Every week, ${plural(poll.days.length, 'night')} to choose from`
      : `${plural(poll.days.length, 'date')} to choose from`;
  const activeTab = tab ?? 'mine';
  const focusKey = hovered ?? selected;
  const focusSlot = focusKey ? grid.byKey.get(focusKey) : undefined;
  const focusTally = focusKey ? tallies.get(focusKey) : undefined;
  const answeredCount = people.filter((p) => Object.keys(p.marks).length > 0).length;
  const canShare = typeof navigator.share === 'function';
  const iAnswered = Boolean(me) && !nothingMarked;
  const traceId = highlight ?? pinned ?? (withMe && iAnswered ? me!.id : null);
  const tracePerson = traceId ? people.find((p) => p.id === traceId) : undefined;
  const withYou = iAnswered
    ? new Map(people.map((p) => [p.id, sharedSlots(grid, myMarks, p.marks) * poll.slot]))
    : undefined;
  const traceLine = !tracePerson
    ? undefined
    : tracePerson.id === me?.id
      ? 'Outlined: when you’re free.'
      : `Outlined: when ${tracePerson.name} is free${
          !withYou ? '' : withYou.get(tracePerson.id) ? `, ${formatDuration(withYou.get(tracePerson.id)!)} of it with you` : ', never when you are'
        }.`;

  const share = () => {
    if (canShare) {
      navigator.share({ title: poll.title, text: `When can you make ${poll.title}?`, url: link }).catch(() => {});
    } else {
      copy('link', link);
    }
  };

  const saveRoles = async (roles: string[]) => {
    if (!me) return;
    try {
      const { person } = await api.save(id, me.id, { token: membership.token }, { roles });
      mine.current = { id: person.id, updated: person.updated };
      store.setLastRoles(roles);
      setState((prev) => prev && { ...prev, people: prev.people.map((p) => (p.id === person.id ? { ...person, marks: p.marks } : p)) });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaveState('error');
    }
  };

  const saveDetail = async (details: { cls?: string; specs?: string[]; spec?: string; note?: string; level60?: boolean }) => {
    if (!me) return;
    if (details.note !== undefined && details.cls === undefined && details.note.trim() === me.note) return;
    if (details.spec !== undefined && details.spec.trim() === me.spec) return;
    try {
      const { person } = await api.save(id, me.id, { token: membership.token }, details);
      mine.current = { id: person.id, updated: person.updated };
      if (details.spec !== undefined) store.setLastSpec(person.spec);
      if (person.cls) {
        store.setLastClass(person.cls);
        store.setLastSpecs(person.specs);
      }
      setState((prev) => prev && { ...prev, people: prev.people.map((p) => (p.id === person.id ? { ...person, marks: p.marks } : p)) });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaveState('error');
    }
  };

  const toolbar = (
    <div className="toolbar">
      <div className="segmented tool" role="radiogroup" aria-label="Mark slots as">
        <button type="button" role="radio" aria-checked={tool === 2} onClick={() => setTool(2)}>
          <span className="swatch yes" aria-hidden="true" />
          available
        </button>
        <button type="button" role="radio" aria-checked={tool === 1} onClick={() => setTool(1)}>
          <span className="swatch maybe" aria-hidden="true" />
          if needed
        </button>
      </div>
      {me && (
        <span className={`save-state ${saveState}`} role="status">
          {saveState === 'waiting' || saveState === 'saving' ? 'saving…' : saveState === 'saved' ? 'saved' : ''}
        </span>
      )}
    </div>
  );
  const howTo = nothingMarked ? (
    <p className="hint how first">
      Press on a window and drag down to light up the hours you can play. Tap a night’s name to light the whole
      night. Use <em>if needed</em> for hours you could do at a push.{' '}
      {!me && (
        <button type="button" className="text-button" onClick={() => setTouring(true)}>
          show me how
        </button>
      )}
    </p>
  ) : (
    <p className="hint how">
      Drag to light more hours; start on a lit one to clear. Tap a night or a time for the whole column or row.
    </p>
  );

  const removePerson = async (pid: string) => {
    await api.remove(id, pid, { token: pid === me?.id ? membership.token : undefined, admin: membership.admin });
    if (pid === me?.id) {
      setMembership(signedOut(membership));
      setDraft(null);
    }
    const next = await api.read(id);
    if (next) applyState(next);
  };

  return (
    <div className="poll-page">
      <header className="topbar">
        <Wordmark />
        <ZonePicker value={zone} onChange={setZone} detected={detectedZone()} label="Show times in" align="end" />
      </header>

      <main className="page wide">
        <section className="poll-head">
          <h1 className="title">{poll.title}</h1>
          <p className="poll-when">
            {when}, {nightRange} in {zonePlace(zone)} time
            {serverRange ? ` (${serverRange} server time)` : onServerTime ? ', the same as the server' : ''}.{' '}
            <span className="muted">
              {answeredCount === 0 ? 'No answers yet.' : `${plural(answeredCount, 'person', 'people')} answered.`}
            </span>
          </p>
          {poll.notes && <p className="poll-notes">{poll.notes}</p>}
          {discordNote && (
            <p className="notice" role="status">
              {discordNote}{' '}
              <button type="button" className="text-button" onClick={() => setDiscordNote('')}>
                ok
              </button>
            </p>
          )}
          {state.teams
            .filter((t) => t.raid && me && t.members.includes(me.id))
            .map((t) => {
              const next = nextRaid(poll, t.raid!);
              return (
                <RaidBanner key={t.id} poll={poll} raid={t.raid!} zone={zone} label={`your team, ${t.name}:`} compact>
                  {next && me && (
                    <>
                      {' '}
                      <SignupButtons
                        pollId={id}
                        owner={t.id}
                        night={next.night}
                        me={me}
                        current={state.signups[eventKey(t.id, next.night)]?.people[me.id]}
                        auth={{ token: membership.token }}
                        onState={applyState}
                      />
                    </>
                  )}
                </RaidBanner>
              );
            })}
          {state.raid && (
            <RaidBanner
              poll={poll}
              raid={state.raid}
              zone={zone}
              onChange={
                membership.admin
                  ? async (raid) =>
                      applyState(raid ? await api.lockRaid(id, membership.admin!, raid) : await api.unlockRaid(id, membership.admin!))
                  : undefined
              }
            >
              <details className="event-details">
                <summary>sign-ups</summary>
                <EventPanel
                  poll={poll}
                  state={state}
                  owner={POLL_RAID}
                  raid={state.raid}
                  team={null}
                  zone={zone}
                  me={me}
                  auth={{ token: membership.token, admin: membership.admin }}
                  onState={applyState}
                />
              </details>
            </RaidBanner>
          )}
          {justMade ? (
            <div className="share-panel" role="status">
              <p>
                Mark your own times first, then share the link with your guild.
              </p>
              <div className="share-row">
                <code className="share-link">{link}</code>
                <button type="button" className="button primary small" onClick={() => copy('link', link)}>
                  {copied === 'link' ? 'copied' : 'copy link'}
                </button>
              </div>
              <p className="hint">
                To edit this poll from another device, copy the private link from the organizer tab.
              </p>
            </div>
          ) : (
            <button type="button" className="button small" onClick={share}>
              {copied === 'link' ? 'link copied' : canShare ? 'share link' : 'copy link'}
            </button>
          )}
        </section>

        <div className="tabs" role="tablist" aria-label="Poll views">
          {(
            [
              ['mine', me ? 'your times' : 'mark your times'],
              ['group', `everyone (${answeredCount})`],
              ['best', 'best times'],
              ...(state.teams.length > 0 || membership.admin
                ? ([['teams', state.teams.length ? `teams (${state.teams.length})` : 'teams']] as const)
                : []),
              ...(membership.admin ? ([['organizer', 'organizer']] as const) : []),
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`tab-${key}`}
              aria-controls={`panel-${key}`}
              aria-selected={activeTab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* One view at a time, on every screen: your grid, everyone's, or the best times. */}
        <div className="panels" data-tab={activeTab}>
          <section className="panel panel-mine" id="panel-mine" role="tabpanel" aria-labelledby="tab-mine">
            <h2 className="panel-heading">Your times</h2>
            {me ? (
              <>
                <div className="me-line">
                  <span>
                    Answering as <strong>{me.name}</strong>
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setMembership(signedOut(membership));
                      setDraft(null);
                    }}
                  >
                    not you?
                  </button>
                </div>
                {toolbar}
                {howTo}
                <PaintGrid grid={grid} marks={myMarks} tool={tool} onChange={paint} />
                {saveState === 'error' && (
                  <p className="error" role="alert">
                    Not saved: {saveError}{' '}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        pending.current = pending.current ?? draft;
                        void flush();
                      }}
                    >
                      try again
                    </button>
                  </p>
                )}
                <div className="mine-footer">
                  {poll.classes.length === 0 && poll.roles.length > 0 && (
                    <div className="my-roles">
                      <span className="muted">You play</span>
                      {poll.roles.map((role) => (
                        <button
                          type="button"
                          key={role}
                          className="chip small icon-chip"
                          aria-pressed={me.roles.includes(role)}
                          onClick={() =>
                            void saveRoles(me.roles.includes(role) ? me.roles.filter((r) => r !== role) : [...me.roles, role])
                          }
                        >
                          <RoleIcon role={role} />
                          {role}
                        </button>
                      ))}
                    </div>
                  )}
                  {!nothingMarked && (
                    <button type="button" className="text-button" onClick={() => paint({})}>
                      clear all my times
                    </button>
                  )}
                </div>
                {poll.classes.length > 0 ? (
                  <div className="my-class">
                    {!me.cls && !classDraft && <p className="hint">Choose your class and spec.</p>}
                    <ClassPicker
                      classes={poll.classes}
                      cls={classDraft?.cls ?? me.cls}
                      specs={classDraft?.specs ?? me.specs}
                      idPrefix="mine"
                      missing={classDraft ? 'spec' : null}
                      onChange={(cls, specs) => {
                        if (specs.length === 0) {
                          setClassDraft({ cls, specs });
                          return;
                        }
                        setClassDraft(null);
                        void saveDetail({ cls, specs });
                      }}
                    />
                  </div>
                ) : (
                  <label className="my-spec">
                    <span className="muted">Class and spec</span>
                    <input
                      key={me.spec}
                      defaultValue={me.spec}
                      maxLength={LIMITS.spec}
                      placeholder="optional"
                      autoComplete="off"
                      onBlur={(e) => void saveDetail({ spec: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                  </label>
                )}
                <label className="check my-level">
                  <input
                    type="checkbox"
                    key={String(me.level60)}
                    defaultChecked={me.level60 === true}
                    onChange={(e) => void saveDetail({ level60: e.target.checked })}
                  />
                  <span>I’m level 60</span>
                </label>
                <label className="my-note">
                  <span className="muted">A note for the organizer</span>
                  <textarea
                    key={me.note}
                    defaultValue={me.note}
                    maxLength={LIMITS.note}
                    rows={2}
                    placeholder="optional, like “Fridays I might be 30 minutes late”"
                    onBlur={(e) => void saveDetail({ note: e.target.value })}
                  />
                </label>
                <MySignIn
                  pollId={id}
                  me={me}
                  token={membership.token}
                  discordOnly={poll.discordOnly}
                  onPerson={(person) => {
                    mine.current = { id: person.id, updated: person.updated };
                    setState(
                      (prev) =>
                        prev && { ...prev, people: prev.people.map((p) => (p.id === person.id ? { ...person, marks: p.marks } : p)) },
                    );
                  }}
                />
                {!nothingMarked && (
                  <div className="next-step">
                    <p>Your times save automatically.</p>
                    <button
                      type="button"
                      className="button small"
                      onClick={() => {
                        setTab('group');
                        window.scrollTo(0, 0);
                      }}
                    >
                      see who else is free
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <h3 className="panel-title">When can you play?</h3>
                <p className="first-steps">
                  Mark your hours in {zonePlace(zone)} time, then add your name.
                </p>
                {toolbar}
                {howTo}
                <PaintGrid grid={grid} marks={unsaved} tool={tool} onChange={setUnsaved} />
                <JoinForm
                  poll={poll}
                  marks={unsaved}
                  discord={discordJoin}
                  onJoined={(person, token, next) => {
                    setMembership({ ...membership, personId: person.id, token });
                    mine.current = { id: person.id, updated: person.updated };
                    version.current = next.version;
                    setState(next);
                    setUnsaved({});
                    setSaveState('saved');
                    setTab('mine');
                    store.remember(next.poll, Boolean(membership.admin));
                  }}
                />
              </>
            )}
          </section>

          <section className="panel panel-group" id="panel-group" role="tabpanel" aria-labelledby="tab-group">
            <h2 className="panel-heading">Everyone</h2>
            {counted.length === 0 ? (
              <p className="empty">
                No times marked yet.
              </p>
            ) : (
              <div className="group-main" ref={heatRef}>
              {/* Always one line, so pointing along the list doesn't nudge the grid. */}
              <p className="hint group-hint" data-tracing={tracePerson ? true : undefined}>
                {traceLine ?? (
                  <>
                    <span className="hint-touch">Tap a window to see who’s free.</span>
                    <span className="hint-mouse">Point at someone to trace their times.</span>
                  </>
                )}
              </p>
              <div className="legend">
                <span aria-hidden="true">none free</span>
                <span className="legend-ramp" aria-hidden="true" style={{ background: GLOW_GRADIENT }} />
                <span aria-hidden="true">all {counted.length}</span>
                {iAnswered && (
                  <button
                    type="button"
                    className="toggle"
                    aria-pressed={withMe}
                    onClick={() => {
                      setPinned(null);
                      setWithMe(!withMe);
                    }}
                    title="Trace your times, to see who’s free when you are"
                  >
                    my times
                  </button>
                )}
              </div>
              <HeatGrid
                grid={grid}
                tallies={tallies}
                total={counted.length}
                selected={selected}
                onSelect={setSelected}
                onHover={setHovered}
                outline={tracePerson?.marks}
              />
              </div>
            )}
            <div className="group-side">
            {counted.length > 0 && (
              <HeatGlance
                grid={grid}
                tallies={tallies}
                total={counted.length}
                outline={tracePerson?.marks}
                label={traceLine ?? 'Everyone’s times.'}
                target={heatRef}
              />
            )}
            {counted.length > 0 && (
              <div className="slot-detail" aria-live="polite">
                {focusSlot && focusTally ? (
                  <>
                    <p className="slot-detail-head">
                      <strong>{slotLabel(grid, focusSlot, true)}</strong>{' '}
                      <span className="muted">
                        {focusTally.yes.length + focusTally.maybe.length} of {counted.length} free
                      </span>
                      {(() => {
                        const server = serverTime(poll.realm, zone, focusSlot.instant);
                        return server ? <span className="muted server-time">{server} server</span> : null;
                      })()}
                    </p>
                    {focusTally.yes.length > 0 && (
                      <p>
                        <span className="swatch yes" aria-hidden="true" /> {focusTally.yes.map(nameOf).join(', ')}
                      </p>
                    )}
                    {focusTally.maybe.length > 0 && (
                      <p>
                        <span className="swatch maybe" aria-hidden="true" /> if needed: {focusTally.maybe.map(nameOf).join(', ')}
                      </p>
                    )}
                    {(() => {
                      const away = counted.filter((p) => !focusTally.yes.includes(p.id) && !focusTally.maybe.includes(p.id));
                      return away.length > 0 ? <p className="muted">not free: {away.map((p) => p.name).join(', ')}</p> : null;
                    })()}
                  </>
                ) : (
                  <p className="muted slot-detail-idle">Point at a window to see who’s free then.</p>
                )}
              </div>
            )}
            <h3 className="sub-heading">People</h3>
            <Composition people={counted} classes={poll.classes} lead={`Of the ${counted.length}:`} />
            <People
              people={people}
              meId={me?.id}
              excluded={excluded}
              required={required}
              onExclude={(pid, out) =>
                setExcluded((s) => {
                  const next = new Set(s);
                  if (out) next.add(pid);
                  else next.delete(pid);
                  return next;
                })
              }
              onRequire={(pid, must) =>
                setRequired((s) => {
                  const next = new Set(s);
                  if (must) next.add(pid);
                  else next.delete(pid);
                  return next;
                })
              }
              onHighlight={setHighlight}
              pinned={pinned}
              onPin={(pid) => {
                setPinned(pid);
                setWithMe(false);
              }}
              withYou={withYou}
              canRemove={(pid) => Boolean(membership.admin) || pid === me?.id}
              onRemove={removePerson}
            />
            </div>
          </section>

          <section className="panel panel-best" id="panel-best" role="tabpanel" aria-labelledby="tab-best">
            <h2 className="panel-heading">Best times</h2>
            <BestTimes
              poll={poll}
              grid={grid}
              people={counted}
              required={countedRequired}
              length={length ?? poll.length}
              onLength={setLength}
              nameOf={nameOf}
              zone={zone}
              raid={state.raid}
              onLock={
                membership.admin
                  ? async (start, minutes) => {
                      applyState(await api.lockRaid(id, membership.admin!, { start, minutes, skips: [] }));
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  : undefined
              }
            />
            {excluded.size > 0 && (
              <p className="hint">
                Leaving out {[...excluded].map(nameOf).join(', ')}.{' '}
                <button type="button" className="text-button" onClick={() => setExcluded(new Set())}>
                  count everyone
                </button>
              </p>
            )}
          </section>
        </div>

        {activeTab === 'teams' && (
          <section className="panel panel-teams" id="panel-teams" role="tabpanel" aria-labelledby="tab-teams">
            <TeamsPanel
              poll={poll}
              state={state}
              grid={grid}
              zone={zone}
              admin={membership.admin}
              meId={me?.id}
              token={membership.token}
              nameOf={nameOf}
              onState={applyState}
            />
          </section>
        )}

        {activeTab === 'organizer' && membership.admin && (
          <section className="panel panel-organizer" id="panel-organizer" role="tabpanel" aria-labelledby="tab-organizer">
            <Organizer
              state={state}
              admin={membership.admin}
              maker={!membership.officer}
              meId={me?.id}
              onState={applyState}
              onPerson={(person) =>
                setState(
                  (prev) =>
                    prev && { ...prev, people: prev.people.map((p) => (p.id === person.id ? { ...person, marks: p.marks } : p)) },
                )
              }
              onRemove={removePerson}
            />
          </section>
        )}
      </main>
      {touring && <Tour steps={ANSWER_TOUR} onClose={() => setTouring(false)} />}
    </div>
  );
}

/** Signing out keeps the maker's private link, but an officer's organizer token goes with them. */
function signedOut(m: Membership): Membership {
  return m.officer ? {} : { admin: m.admin };
}
