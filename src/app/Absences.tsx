import { createContext, useEffect, useState } from 'react';
import type { Person, Poll } from '../core/types';
import { ABSENCE_LIMITS, type Absence, validateAbsences } from '../core/absence';
import { formatDate, weekdayName } from '../core/format';
import { addDays, dateKey, parseDate, today, weekdayOf } from '../core/time';
import { api } from './api';

// Dated absences: "away December 22 to January 2", on the person, so every raid night in the span counts
// them out. They come in their own read, never in the poll's state, so only organizers and the person see them.

type Auth = { token?: string; admin?: string };

/** Everyone's absences this browser may see, by person id: read by each night's roster. */
export const AbsencesContext = createContext<Record<string, Absence[]>>({});

/** Reads the absences again whenever the poll changes, for anyone signed in or organizing. */
export function useAbsences(pollId: string, auth: Auth, version: number | undefined) {
  const [absences, setAbsences] = useState<Record<string, Absence[]>>({});
  const { token, admin } = auth;
  useEffect(() => {
    if (version === undefined) return;
    if (!token && !admin) {
      setAbsences({});
      return;
    }
    let alive = true;
    api
      .absences(pollId, { token, admin })
      .then((r) => alive && setAbsences(r.absences))
      // Not worth a message: the roster just shows them as not answered until the next read.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pollId, token, admin, version]);
  const setOwn = (personId: string, list: Absence[]) =>
    setAbsences((prev) => {
      const next = { ...prev };
      if (list.length) next[personId] = list;
      else delete next[personId];
      return next;
    });
  return [absences, setOwn] as const;
}

function day(key: string): string {
  const d = parseDate(key);
  return d ? `${weekdayName(weekdayOf(d))} ${formatDate(d)}` : key;
}

/** "Tue Dec 22 – Sat Jan 2", or one night. */
export function absenceRange(a: Pick<Absence, 'from' | 'to'>): string {
  return a.from === a.to ? day(a.from) : `${day(a.from)} – ${day(a.to)}`;
}

/** Your own absences, under your times: add one, change one, take one off. */
export function MyAbsences({
  poll,
  me,
  token,
  absences,
  onSaved,
}: {
  poll: Poll;
  me: Person;
  token?: string;
  absences: Absence[];
  onSaved: (list: Absence[]) => void;
}) {
  // The absence being edited: its place in the list, or -1 for a new one.
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Absence>({ from: '', to: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The Worker counts from yesterday in the poll's zone; so does this.
  const since = addDays(today(poll.tz), -1);
  const first = dateKey(since);

  const save = async (list: Absence[]) => {
    const checked = validateAbsences(list, since);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const saved = await api.setAbsences(poll.id, me.id, { token }, checked.value);
      onSaved(saved.absences);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const open = (i: number) => {
    setDraft(i < 0 ? { from: '', to: '', note: '' } : absences[i]);
    setError('');
    setEditing(i);
  };

  return (
    <div className="my-away">
      <p className="muted">
        Away for a while? Every raid night in those dates counts you out, for every team. Only organizers see
        this.
      </p>
      {absences.length > 0 && (
        <ul className="my-away-list">
          {absences.map((a, i) => (
            <li key={`${a.from}/${a.to}`}>
              <span>
                {absenceRange(a)}
                {a.note && <span className="muted"> · {a.note}</span>}
              </span>
              {editing === null && (
                <span className="my-away-actions">
                  <button type="button" className="text-button" onClick={() => open(i)}>
                    change
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => void save(absences.filter((_, j) => j !== i))}
                  >
                    remove
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing !== null ? (
        <form
          className="my-away-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(editing < 0 ? [...absences, draft] : absences.map((a, j) => (j === editing ? draft : a)));
          }}
        >
          <label>
            <span className="muted">first night away</span>
            <input
              type="date"
              required
              min={first}
              value={draft.from}
              onChange={(e) => {
                const from = e.target.value;
                // A new last night follows the first one, so a single night is one pick.
                setDraft((d) => ({ ...d, from, to: !d.to || d.to < from ? from : d.to }));
              }}
            />
          </label>
          <label>
            <span className="muted">last night away</span>
            <input
              type="date"
              required
              min={draft.from || first}
              value={draft.to}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            />
          </label>
          <label className="my-away-note">
            <span className="muted">note</span>
            <input
              value={draft.note}
              maxLength={ABSENCE_LIMITS.note}
              placeholder="optional, like “visiting family”"
              autoComplete="off"
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
            />
          </label>
          <div className="my-away-actions">
            <button type="submit" className="button small primary" disabled={busy || !draft.from || !draft.to}>
              {busy ? 'saving…' : 'save'}
            </button>
            <button type="button" className="text-button" onClick={() => setEditing(null)}>
              cancel
            </button>
          </div>
        </form>
      ) : (
        absences.length < ABSENCE_LIMITS.absences && (
          <button type="button" className="text-button" onClick={() => open(-1)}>
            add dates away
          </button>
        )
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
