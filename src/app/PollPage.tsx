import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Mark, Marks, Person, PollState } from '../core/types';
import { buildGrid } from '../core/grid';
import { tallySlots } from '../core/best';
import { formatRange, plural, zonePlace } from '../core/format';
import { MINUTE } from '../core/time';
import { LIMITS } from '../core/validate';
import { ApiError, api } from './api';
import { Wordmark, navigate } from './App';
import { BestTimes } from './BestTimes';
import { slotLabel } from './GridFrame';
import { HeatGrid } from './HeatGrid';
import { JoinForm } from './JoinForm';
import { PaintGrid } from './PaintGrid';
import { People } from './People';
import { PollForm } from './PollForm';
import { ZonePicker } from './ZonePicker';
import { useCopied } from './copy';
import { GLOW_GRADIENT } from './glow';
import { type Membership, detectedZone, store } from './store';

type Tab = 'mine' | 'group' | 'best';
type SaveState = 'idle' | 'waiting' | 'saving' | 'saved' | 'error';

const REFRESH_MS = 15_000;
/** After this long without a touch, click or key, refresh every fourth tick instead. */
const IDLE_MS = 5 * 60_000;

export function PollPage({ id }: { id: string }) {
  const [state, setState] = useState<PollState | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [membership, setMembershipState] = useState<Membership>(() => {
    // The maker's private link, /e/<id>#admin=<token>, makes this browser able to change the poll too.
    const fromLink = /^#admin=([\w-]{16,})$/.exec(location.hash)?.[1];
    const saved = store.membership(id);
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
  const [tool, setTool] = useState<Mark>(2);
  const [draft, setDraft] = useState<Marks | null>(null);
  /** Times marked before saying who you are; they go along with the join. */
  const [unsaved, setUnsaved] = useState<Marks>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [required, setRequired] = useState<ReadonlySet<string>>(new Set());
  const [length, setLength] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [copied, copy] = useCopied();

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

  // Removed from the poll (by its maker, or on another device): back to the join form.
  useEffect(() => {
    if (state && membership.personId && !me) setMembership({ admin: membership.admin });
  }, [state, me, membership, setMembership]);

  useEffect(() => {
    if (poll) document.title = `${poll.title} · muster`;
  }, [poll]);

  useEffect(() => {
    if (!state || tab) return;
    setTab(me && Object.keys(me.marks).length > 0 ? 'group' : 'mine');
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
  const nightRange = firstSlot
    ? formatRange(firstSlot.instant, firstSlot.instant + grid.columns[0].slots.length * poll.slot * MINUTE, zone)
    : '';
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
  const highlightPerson = highlight ? people.find((p) => p.id === highlight) : undefined;

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

  const saveDetail = async (field: 'spec' | 'note', value: string) => {
    if (!me || value.trim() === me[field]) return;
    try {
      const { person } = await api.save(id, me.id, { token: membership.token }, { [field]: value });
      mine.current = { id: person.id, updated: person.updated };
      if (field === 'spec') store.setLastSpec(person.spec);
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
      night. Use <em>if needed</em> for hours you could do at a push.
    </p>
  ) : (
    <p className="hint how">
      Drag to light more hours; start on a lit one to clear. Tap a night or a time for the whole column or row.
    </p>
  );

  const removePerson = async (pid: string) => {
    await api.remove(id, pid, { token: pid === me?.id ? membership.token : undefined, admin: membership.admin });
    if (pid === me?.id) {
      setMembership({ admin: membership.admin });
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
            {when}, {nightRange} in {zonePlace(zone)} time.{' '}
            <span className="muted">
              {answeredCount === 0 ? 'No answers yet.' : `${plural(answeredCount, 'person', 'people')} answered.`}
            </span>
          </p>
          {poll.notes && <p className="poll-notes">{poll.notes}</p>}
          {justMade ? (
            <div className="share-panel" role="status">
              <p>
                <strong>Your poll is ready.</strong> Mark your own times first, so the first people to open it see how
                it works. Then send the link to the guild: pasted in Discord, it shows the poll’s name.
              </p>
              <div className="share-row">
                <code className="share-link">{link}</code>
                <button type="button" className="button primary small" onClick={() => copy('link', link)}>
                  {copied === 'link' ? 'copied' : 'copy link'}
                </button>
              </div>
              <p className="hint">
                Only this browser can change the poll. You’ll find that at the bottom of the page, under “Change this
                poll”.
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
                      setMembership({ admin: membership.admin });
                      setDraft(null);
                    }}
                  >
                    not you?
                  </button>
                </div>
                {toolbar}
                {howTo}
                <PaintGrid grid={grid} marks={myMarks} tool={tool} onChange={paint} demo={nothingMarked} />
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
                  {poll.roles.length > 0 && (
                    <div className="my-roles">
                      <span className="muted">You play</span>
                      {poll.roles.map((role) => (
                        <button
                          type="button"
                          key={role}
                          className="chip small"
                          aria-pressed={me.roles.includes(role)}
                          onClick={() =>
                            void saveRoles(me.roles.includes(role) ? me.roles.filter((r) => r !== role) : [...me.roles, role])
                          }
                        >
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
                <label className="my-spec">
                  <span className="muted">Class and spec</span>
                  <input
                    key={me.spec}
                    defaultValue={me.spec}
                    maxLength={LIMITS.spec}
                    placeholder="optional"
                    autoComplete="off"
                    onBlur={(e) => void saveDetail('spec', e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  />
                </label>
                <label className="my-note">
                  <span className="muted">A note for the organizer</span>
                  <textarea
                    key={me.note}
                    defaultValue={me.note}
                    maxLength={LIMITS.note}
                    rows={2}
                    placeholder="optional, like “Fridays I might be 30 minutes late”"
                    onBlur={(e) => void saveDetail('note', e.target.value)}
                  />
                </label>
                {!nothingMarked && (
                  <div className="next-step">
                    <p>Your times save as you go, so you can close this whenever you’re done.</p>
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
                <h3 className="panel-title">First, when can you play?</h3>
                <p className="first-steps">
                  Light up every night and hour that works for you, in {zonePlace(zone)} time. Then add your name below
                  and save.
                </p>
                {toolbar}
                {howTo}
                <PaintGrid grid={grid} marks={unsaved} tool={tool} onChange={setUnsaved} demo={nothingMarked} />
                <JoinForm
                  poll={poll}
                  marks={unsaved}
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
                No answers yet. Once people mark their times, this grid lights up wherever they overlap.
              </p>
            ) : (
              <>
              <div className="legend" aria-hidden="true">
                <span>none free</span>
                <span className="legend-ramp" style={{ background: GLOW_GRADIENT }} />
                <span>all {counted.length}</span>
              </div>
              <HeatGrid
                grid={grid}
                tallies={tallies}
                total={counted.length}
                selected={selected}
                onSelect={setSelected}
                onHover={setHovered}
                outline={highlightPerson?.marks}
              />
              <div className="slot-detail" aria-live="polite">
                {focusSlot && focusTally ? (
                  <>
                    <p className="slot-detail-head">
                      <strong>{slotLabel(grid, focusSlot, true)}</strong>{' '}
                      <span className="muted">
                        {focusTally.yes.length + focusTally.maybe.length} of {counted.length} free
                      </span>
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
                  <p className="muted">
                    Tap a window to see who’s free then.
                  </p>
                )}
              </div>
              </>
            )}
            <h3 className="sub-heading">People</h3>
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
              canRemove={(pid) => Boolean(membership.admin) || pid === me?.id}
              onRemove={removePerson}
            />
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

        {membership.admin && <AdminPanel state={state} admin={membership.admin} onState={applyState} />}
      </main>
    </div>
  );
}

function AdminPanel({
  state,
  admin,
  onState,
}: {
  state: PollState;
  admin: string;
  onState: (s: PollState) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [copied, copy] = useCopied();
  const answered = state.people.some((p) => Object.keys(p.marks).length > 0);
  const adminLink = `${location.origin}/e/${state.poll.id}#admin=${admin}`;
  return (
    <section className="admin" aria-labelledby="admin-title">
      <details>
        <summary id="admin-title">Change this poll</summary>
        <p className="hint">
          This browser can change the poll because it made it. To change it from another device, open this private
          link there; anyone with it can change or delete the poll, so keep it to yourself.
        </p>
        <p>
          <button type="button" className="button small" onClick={() => copy('admin', adminLink)}>
            {copied === 'admin' ? 'private link copied' : 'copy private link'}
          </button>
        </p>
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
      </details>
    </section>
  );
}
