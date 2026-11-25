import { type FormEvent, useMemo, useState } from 'react';
import type { Mode, PollSettings, SlotSize } from '../core/types';
import { SLOT_SIZES, validateSettings } from '../core/validate';
import { WEEK_ORDER, slotKeys } from '../core/slots';
import { formatDuration, formatMinute, weekdayName } from '../core/format';
import { today, windowLength } from '../core/time';
import { DatePicker } from './DatePicker';
import { ZonePicker } from './ZonePicker';
import { detectedZone } from './store';

export const DEFAULT_SETTINGS: PollSettings = {
  title: '',
  notes: '',
  mode: 'weekly',
  days: [...WEEK_ORDER],
  start: 18 * 60,
  end: 60,
  slot: 30,
  tz: detectedZone(),
  roles: ['tank', 'healer', 'dps'],
  length: 180,
};

const LENGTHS = Array.from({ length: 16 }, (_, i) => (i + 1) * 30);

export function PollForm({
  initial,
  submitLabel,
  busyLabel,
  onSubmit,
  editing = false,
  answered = false,
}: {
  initial: PollSettings;
  submitLabel: string;
  busyLabel: string;
  onSubmit: (settings: PollSettings) => Promise<void>;
  /** Editing a poll: weekly or dates is fixed. */
  editing?: boolean;
  /** Someone has answered: slot size is fixed. */
  answered?: boolean;
}) {
  const [title, setTitle] = useState(initial.title);
  const [notes, setNotes] = useState(initial.notes);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [weekdays, setWeekdays] = useState<string[]>(initial.mode === 'weekly' ? initial.days : [...WEEK_ORDER]);
  const [dates, setDates] = useState<string[]>(initial.mode === 'dates' ? initial.days : []);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [slot, setSlot] = useState<SlotSize>(initial.slot);
  const [tz, setTz] = useState(initial.tz);
  const [rolesOn, setRolesOn] = useState(initial.roles.length > 0);
  const [rolesText, setRolesText] = useState((initial.roles.length ? initial.roles : DEFAULT_SETTINGS.roles).join(', '));
  const [length, setLength] = useState(initial.length);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const settings: PollSettings = {
    title,
    notes,
    mode,
    days: mode === 'weekly' ? WEEK_ORDER.filter((d) => weekdays.includes(d)) : dates,
    start,
    end,
    slot,
    tz,
    roles: rolesOn ? rolesText.split(',').map((r) => r.trim()).filter(Boolean) : [],
    length,
  };

  const times = useMemo(() => Array.from({ length: 1440 / slot }, (_, i) => i * slot), [slot]);
  const span = windowLength(start, end);
  const cells = slotKeys(settings).length;

  const changeSlot = (next: SlotSize) => {
    setSlot(next);
    setStart((s) => Math.floor(s / next) * next);
    setEnd((e) => Math.floor(e / next) * next);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const checked = validateSettings(settings);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onSubmit(checked.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleWeekday = (d: string) =>
    setWeekdays((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]));

  return (
    <form className="poll-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="poll-title">What’s it for?</label>
        <input
          id="poll-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Raid nights"
          maxLength={80}
          autoComplete="off"
          required
        />
      </div>

      {!editing && (
        <fieldset className="field">
          <legend>Which days?</legend>
          <div className="segmented" role="radiogroup" aria-label="Kind of poll">
            <button type="button" role="radio" aria-checked={mode === 'weekly'} onClick={() => setMode('weekly')}>
              every week
            </button>
            <button type="button" role="radio" aria-checked={mode === 'dates'} onClick={() => setMode('dates')}>
              specific dates
            </button>
          </div>
        </fieldset>
      )}

      {mode === 'weekly' ? (
        <fieldset className="field">
          <legend className={editing ? '' : 'visually-hidden'}>Days of the week</legend>
          <div className="day-chips week-chips">
            {WEEK_ORDER.map((d) => (
              <button
                type="button"
                key={d}
                className="chip"
                aria-pressed={weekdays.includes(d)}
                onClick={() => toggleWeekday(d)}
              >
                {weekdayName(Number(d.slice(1)))}
              </button>
            ))}
          </div>
          <p className="hint">Everyone answers for a typical week. Good for a standing raid schedule.</p>
        </fieldset>
      ) : (
        <fieldset className="field">
          <legend className={editing ? '' : 'visually-hidden'}>Dates</legend>
          <DatePicker value={dates} onChange={setDates} today={today(tz)} />
        </fieldset>
      )}

      <fieldset className="field">
        <legend>What times?</legend>
        <div className="time-row">
          <label className="select">
            <span className="visually-hidden">From</span>
            <select value={start} onChange={(e) => setStart(Number(e.target.value))}>
              {times.map((t) => (
                <option key={t} value={t}>
                  {formatMinute(t)}
                </option>
              ))}
            </select>
          </label>
          <span className="to">to</span>
          <label className="select">
            <span className="visually-hidden">Until</span>
            <select value={end} onChange={(e) => setEnd(Number(e.target.value))}>
              {times.map((t) => (
                <option key={t} value={t}>
                  {formatMinute(t)}
                  {t <= start ? ' (next day)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="hint">
          {formatDuration(span)} a night{end <= start && end !== 0 ? ', running past midnight' : ''}. Times are
          in this zone, and everyone sees them in their own:
        </p>
        <ZonePicker value={tz} onChange={setTz} detected={detectedZone()} />
      </fieldset>

      <fieldset className="field">
        <legend>How long is a raid?</legend>
        <div className="time-row">
          <label className="select">
            <span className="visually-hidden">Raid length</span>
            <select value={length} onChange={(e) => setLength(Number(e.target.value))}>
              {LENGTHS.map((m) => (
                <option key={m} value={m}>
                  {formatDuration(m)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="hint">Best times looks for windows this long. Anyone can try other lengths later.</p>
      </fieldset>

      <fieldset className="field">
        <legend>Roles</legend>
        <label className="check">
          <input type="checkbox" checked={rolesOn} onChange={(e) => setRolesOn(e.target.checked)} />
          <span>Ask what everyone plays, and count each role in best times</span>
        </label>
        {rolesOn && (
          <input
            aria-label="Roles, separated by commas"
            value={rolesText}
            onChange={(e) => setRolesText(e.target.value)}
            placeholder="tank, healer, dps"
            autoComplete="off"
          />
        )}
      </fieldset>

      <details className="field more" open={editing || undefined}>
        <summary>More options</summary>
        <fieldset className="field">
          <legend>Slot size</legend>
          <div className="segmented" role="radiogroup" aria-label="Slot size">
            {SLOT_SIZES.map((s) => (
              <button
                type="button"
                role="radio"
                key={s}
                aria-checked={slot === s}
                disabled={answered && s !== initial.slot}
                onClick={() => changeSlot(s)}
              >
                {s} min
              </button>
            ))}
          </div>
          {answered && <p className="hint">Slot size is fixed once people have answered.</p>}
        </fieldset>
        <div className="field">
          <label htmlFor="poll-notes">Note for everyone</label>
          <textarea
            id="poll-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={600}
            placeholder="Mark every night you could make it, even if it’s not ideal."
          />
        </div>
      </details>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {cells > 1000 && !error && <p className="error">That’s {cells} slots: pick fewer days, a shorter window or bigger slots.</p>}

      <button className="button primary wide" type="submit" disabled={busy}>
        {busy ? busyLabel : submitLabel}
      </button>
    </form>
  );
}
