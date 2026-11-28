import { type DragEvent, useState } from 'react';
import type { Person, PollState } from '../core/types';
import type { Seat } from '../core/seating';
import { type GroupMove, type Groups as GroupList, GROUP_SIZE, arrange, groupCount, groupHints, moveInGroups } from '../core/groups';
import { api } from './api';
import { classStyle } from './ClassPicker';

// One night's groups of five. Everyone sees them; the organizer arranges them by hand: drag someone onto a
// group or onto someone to swap, or on a phone tap someone, then tap a free place or another person.

export function Groups({
  pollId,
  owner,
  night,
  seated,
  size,
  byId,
  stored,
  layout,
  me,
  admin,
  onState,
}: {
  pollId: string;
  owner: string;
  night: string;
  seated: Seat[];
  size: number;
  byId: Map<string, Person>;
  stored: GroupList | undefined;
  layout: GroupList | undefined;
  me?: Person;
  admin?: string;
  onState: (state: PollState) => void;
}) {
  // The move just made, shown at once while the Worker saves it.
  const [pending, setPending] = useState<GroupList | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ids = seated.map((s) => s.id);
  const count = groupCount(size, ids.length);
  const { groups, unplaced } = arrange(pending ?? stored, ids, count);
  const placed = groups.some((g) => g.length > 0);
  if (!admin && !placed) return null;
  const roleOf = new Map(seated.map((s) => [s.id, s.role]));
  const event = { owner, night };
  const asTemplate =
    layout !== undefined && JSON.stringify(arrange(layout, ids, count).groups) === JSON.stringify(groups) && placed;

  const send = async (call: () => Promise<PollState>) => {
    setBusy(true);
    setError('');
    try {
      onState(await call());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
      setBusy(false);
    }
  };
  const move = (id: string, to: GroupMove) => {
    setPicked(null);
    if (!admin) return;
    const next = moveInGroups(groups, id, to);
    if (!next.ok) {
      setError(next.error);
      return;
    }
    setPending(next.value);
    void send(() => api.group(pollId, admin, event, id, to));
  };

  // Tapping: the first tap picks someone up, the next puts them down.
  const tapPerson = (id: string) => {
    if (!picked) setPicked(id);
    else if (picked === id) setPicked(null);
    else if (!groups.some((g) => g.includes(picked)) && !groups.some((g) => g.includes(id))) setPicked(id);
    else move(picked, { swap: id });
  };
  const dragStart = (id: string) => (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setPicked(null);
  };
  const dropOn = (to: (dragged: string) => GroupMove | null) => ({
    onDragOver: (e: DragEvent) => {
      if (admin) e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const dragged = e.dataTransfer.getData('text/plain');
      const target = to(dragged);
      if (dragged && target) move(dragged, target);
    },
  });

  const person = (id: string) => {
    const p = byId.get(id);
    const meta = [p?.cls, roleOf.get(id)].filter(Boolean).join(' · ');
    const body = (
      <>
        <span className="roster-name" style={classStyle(p?.cls ?? '')}>
          {p?.name ?? 'someone'}
          {id === me?.id && <span className="muted"> (you)</span>}
        </span>
        {meta && <span className="group-meta">{meta}</span>}
      </>
    );
    if (!admin) return <span className="group-person">{body}</span>;
    return (
      <button
        type="button"
        className="group-person"
        data-person={id}
        aria-pressed={picked === id}
        draggable
        disabled={busy}
        onDragStart={dragStart(id)}
        {...dropOn((dragged) => (dragged === id ? null : { swap: id }))}
        onClick={() => tapPerson(id)}
      >
        {body}
      </button>
    );
  };

  return (
    <section className="groups" aria-label="Groups">
      <p className="groups-head">
        <span className="event-role">groups</span>
        {admin && (
          <span className="muted">
            {picked ? `moving ${byId.get(picked)?.name ?? 'someone'}: tap a free place, or someone to swap` : 'drag, or tap someone then where they go'}
          </span>
        )}
      </p>
      <ol className="group-grid">
        {groups.map((group, g) => {
          const hints = groupHints(group.map((id) => byId.get(id)?.cls ?? ''));
          const free = GROUP_SIZE - group.length;
          return (
            <li key={g} className="group" data-group={g + 1} {...dropOn(() => ({ group: g }))}>
              <span className="group-name">
                group {g + 1}
                {hints.length > 0 && <span className="group-hints">{hints.join(' · ')}</span>}
              </span>
              {group.map((id) => (
                <span key={id} className="group-slot">
                  {person(id)}
                </span>
              ))}
              {admin &&
                Array.from({ length: free }, (_, i) =>
                  picked && i === 0 ? (
                    <button key={i} type="button" className="group-slot group-free" disabled={busy} onClick={() => move(picked, { group: g })}>
                      here
                    </button>
                  ) : (
                    <span key={i} className="group-slot group-empty" aria-hidden="true" />
                  ),
                )}
              {!admin && group.length === 0 && <span className="group-slot muted">empty</span>}
            </li>
          );
        })}
      </ol>
      {(unplaced.length > 0 || picked) && (
        <p className="event-line groups-unplaced" {...dropOn(() => ({ group: null }))}>
          <span className="event-role">unplaced</span>
          {unplaced.map((id) => (
            <span key={id} className="event-person">
              {person(id)}
            </span>
          ))}
          {picked && groups.some((g) => g.includes(picked)) && (
            <button type="button" className="text-button" disabled={busy} onClick={() => move(picked, { group: null })}>
              take {byId.get(picked)?.name ?? 'them'} out
            </button>
          )}
        </p>
      )}
      {admin && (
        <p className="groups-actions">
          {asTemplate ? (
            <span className="muted">matches the template</span>
          ) : (
            placed && (
              <button type="button" className="text-button" disabled={busy} onClick={() => void send(() => api.saveLayout(pollId, admin, event))}>
                save as template
              </button>
            )
          )}
          {layout && !asTemplate && (
            <button type="button" className="text-button" disabled={busy} onClick={() => void send(() => api.groups(pollId, admin, event))}>
              use the template
            </button>
          )}
          {placed && (
            <button type="button" className="text-button" disabled={busy} onClick={() => void send(() => api.groups(pollId, admin, event, true))}>
              clear
            </button>
          )}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
