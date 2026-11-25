import { useState } from 'react';
import { LIMITS } from '../core/validate';
import { type YMD, addDays, compareDates, dateKey, parseDate, weekdayOf } from '../core/time';
import { weekdayName } from '../core/format';

/** A month at a time; tap dates to add or remove them. Monday first, like the weekly days. */
export function DatePicker({
  value,
  onChange,
  today,
}: {
  value: string[];
  onChange: (dates: string[]) => void;
  today: YMD;
}) {
  const first = value.map(parseDate).filter((d): d is YMD => d !== null).sort(compareDates)[0];
  const [month, setMonth] = useState<YMD>(() => ({ ...(first ?? today), d: 1 }));
  const chosen = new Set(value);

  const lead = (weekdayOf(month) + 6) % 7;
  const days: (YMD | null)[] = Array.from({ length: lead }, () => null);
  for (let d = month; d.m === month.m; d = addDays(d, 1)) days.push(d);

  const shift = (n: number) => {
    const t = new Date(Date.UTC(month.y, month.m - 1 + n, 1));
    setMonth({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: 1 });
  };

  const toggle = (d: YMD) => {
    const key = dateKey(d);
    const next = new Set(chosen);
    if (next.has(key)) next.delete(key);
    else if (next.size < LIMITS.dates) next.add(key);
    onChange([...next].sort());
  };

  const monthName = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(month.y, month.m - 1, 1)),
  );

  return (
    <div className="calendar">
      <div className="calendar-head">
        <button type="button" className="icon-button" onClick={() => shift(-1)} aria-label="Previous month">
          ‹
        </button>
        <span className="calendar-month">{monthName}</span>
        <button type="button" className="icon-button" onClick={() => shift(1)} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="calendar-grid" role="group" aria-label={`Dates in ${monthName}`}>
        {[1, 2, 3, 4, 5, 6, 0].map((w) => (
          <span key={w} className="calendar-weekday" aria-hidden="true">
            {weekdayName(w).slice(0, 2)}
          </span>
        ))}
        {days.map((d, i) =>
          d ? (
            <button
              type="button"
              key={dateKey(d)}
              className="calendar-day"
              aria-pressed={chosen.has(dateKey(d))}
              data-past={compareDates(d, today) < 0 || undefined}
              data-today={compareDates(d, today) === 0 || undefined}
              onClick={() => toggle(d)}
            >
              {d.d}
            </button>
          ) : (
            <span key={`blank-${i}`} />
          ),
        )}
      </div>
      <p className="hint">
        {value.length === 0 ? 'Tap the dates to offer.' : `${value.length} ${value.length === 1 ? 'date' : 'dates'} picked.`}
        {value.length > 0 && (
          <>
            {' '}
            <button type="button" className="text-button" onClick={() => onChange([])}>
              clear
            </button>
          </>
        )}
      </p>
    </div>
  );
}
