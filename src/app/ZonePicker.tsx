import { useMemo } from 'react';
import { zoneCity, zoneName } from '../core/format';
import { tzOffset } from '../core/time';

const FALLBACK = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Helsinki', 'Europe/Moscow', 'Asia/Dubai',
  'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland', 'UTC',
];

function allZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (list?.length) return list.includes('UTC') ? list : [...list, 'UTC'];
  } catch {
    // Older browsers: the short list.
  }
  return FALLBACK;
}

function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** A native select (good on phones) of every zone, by offset then city, with the current one marked. */
export function ZonePicker({
  value,
  onChange,
  detected,
  id,
  label = 'Time zone',
}: {
  value: string;
  onChange: (tz: string) => void;
  detected?: string;
  id?: string;
  label?: string;
}) {
  const options = useMemo(() => {
    const now = Date.now();
    const zones = allZones();
    if (!zones.includes(value)) zones.push(value);
    return zones
      .map((tz) => ({ tz, offset: tzOffset(now, tz) }))
      .sort((a, b) => a.offset - b.offset || zoneCity(a.tz).localeCompare(zoneCity(b.tz)))
      .map(({ tz, offset }) => ({
        tz,
        label: `${offsetLabel(offset)} ${zoneCity(tz)}${tz === detected ? ' (yours)' : ''}`,
      }));
  }, [value, detected]);

  return (
    <label className="zone-picker">
      <span className="visually-hidden">{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.tz} value={o.tz}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="zone-current" aria-hidden="true">
        {zoneCity(value)} <span className="muted">{zoneName(value, Date.now(), 'short')}</span>
      </span>
    </label>
  );
}
