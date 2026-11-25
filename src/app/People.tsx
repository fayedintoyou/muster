import { useState } from 'react';
import type { Person } from '../core/types';
import { ClassName } from './ClassPicker';

// Who's answered. Untick someone to leave them out of the glow and the best times (a bench, an alt);
// mark someone "must come" (the raid leader, the only tank) and best times only offers windows with them.

export function People({
  people,
  meId,
  excluded,
  required,
  onExclude,
  onRequire,
  onHighlight,
  canRemove,
  onRemove,
}: {
  people: Person[];
  meId?: string;
  excluded: ReadonlySet<string>;
  required: ReadonlySet<string>;
  onExclude: (id: string, out: boolean) => void;
  onRequire: (id: string, must: boolean) => void;
  onHighlight: (id: string | null) => void;
  canRemove: (id: string) => boolean;
  onRemove: (id: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState('');

  if (people.length === 0) {
    return <p className="empty">No one has answered yet. Share the link and answers show up here as they come in.</p>;
  }

  return (
    <div className="people">
      <ul className="people-list">
        {people.map((p) => {
          const marked = Object.keys(p.marks).length;
          const out = excluded.has(p.id);
          const must = required.has(p.id);
          return (
            <li
              key={p.id}
              data-out={out || undefined}
              onPointerEnter={(e) => e.pointerType === 'mouse' && onHighlight(p.id)}
              onPointerLeave={() => onHighlight(null)}
            >
              <label className="person-count">
                <input type="checkbox" checked={!out} onChange={(e) => onExclude(p.id, !e.target.checked)} />
                <span className="person-name">
                  {p.name}
                  {p.id === meId && <span className="muted"> (you)</span>}
                </span>
              </label>
              <span className="person-meta">
                {p.roles.length > 0 && <span className="person-roles">{p.roles.join(', ')}</span>}
                <ClassName cls={p.cls} spec={p.spec} />
                {marked === 0 && <span className="muted">no times yet</span>}
              </span>
              {p.note && <p className="person-note">{p.note}</p>}
              <span className="person-actions">
                <button
                  type="button"
                  className="toggle"
                  aria-pressed={must}
                  disabled={out}
                  onClick={() => onRequire(p.id, !must)}
                  title={`Only show best times ${p.name} can make`}
                >
                  must come
                </button>
                {canRemove(p.id) &&
                  (confirming === p.id ? (
                    <span className="confirm">
                      <button
                        type="button"
                        className="text-button danger"
                        onClick={() => {
                          setError('');
                          onRemove(p.id)
                            .then(() => setConfirming(null))
                            .catch((err) => setError(err instanceof Error ? err.message : String(err)));
                        }}
                      >
                        remove {p.id === meId ? 'my answers' : p.name}
                      </button>
                      <button type="button" className="text-button" onClick={() => setConfirming(null)}>
                        keep
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setConfirming(p.id)}
                      aria-label={`Remove ${p.name}`}
                    >
                      remove
                    </button>
                  ))}
              </span>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
