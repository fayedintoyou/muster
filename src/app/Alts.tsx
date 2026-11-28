import { useState } from 'react';
import type { Alt, Person } from '../core/types';
import { ALT_LIMIT } from '../core/validate';
import { ClassName, ClassPicker } from './ClassPicker';

// Someone's alts: other characters on the same times. Each has its own name, class and specs, and can be
// picked for any night instead of the main, on the page or with "on my alt" in Discord.

type Draft = Pick<Alt, 'id' | 'name' | 'cls' | 'specs'>;

export function Alts({ me, classes, onSave }: { me: Person; classes: string[]; onSave: (alts: Draft[]) => Promise<void> }) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (alts: Draft[]) => {
    setBusy(true);
    setError('');
    try {
      await onSave(alts);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const keep = (a: Alt): Draft => ({ id: a.id, name: a.name, cls: a.cls, specs: a.specs });

  return (
    <div className="my-alts">
      <p className="muted">
        Alts{' '}
        <span className="hint">
          {me.alts.length ? 'pick one for any night you’re on it' : 'other characters you might bring, on the same times'}
        </span>
      </p>
      {me.alts.length > 0 && (
        <ul className="alt-list">
          {me.alts.map((a) => (
            <li key={a.id}>
              <span className="person-name">{a.name}</span> <ClassName cls={a.cls} specs={a.specs} spec="" />{' '}
              <button type="button" className="text-button" disabled={busy} onClick={() => setEditing(keep(a))}>
                change
              </button>{' '}
              <button
                type="button"
                className="text-button danger"
                disabled={busy}
                onClick={() => void save(me.alts.filter((x) => x.id !== a.id).map(keep))}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <form
          className="alt-form"
          onSubmit={(e) => {
            e.preventDefault();
            const rest = me.alts.map(keep);
            void save(editing.id ? rest.map((a) => (a.id === editing.id ? editing : a)) : [...rest, editing]);
          }}
        >
          <label className="field">
            <span>Alt’s name</span>
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              maxLength={32}
              autoComplete="off"
              autoFocus
            />
          </label>
          <ClassPicker
            classes={classes}
            cls={editing.cls}
            specs={editing.specs}
            idPrefix="alt"
            onChange={(cls, specs) => setEditing({ ...editing, cls, specs })}
          />
          <div className="team-actions">
            <button type="submit" className="button small primary" disabled={busy}>
              {busy ? 'saving…' : editing.id ? 'save the alt' : 'add the alt'}
            </button>
            <button type="button" className="text-button" onClick={() => setEditing(null)}>
              cancel
            </button>
          </div>
        </form>
      ) : (
        me.alts.length < ALT_LIMIT && (
          <button type="button" className="button small" onClick={() => setEditing({ id: '', name: '', cls: '', specs: [] })}>
            add an alt
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
