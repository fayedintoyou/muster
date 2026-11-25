import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatTime, zoneCity, zoneName, zonePlace } from '../core/format';
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

// ---- The map: the lower 48, drawn from rough longitude and latitude, split into its four zones ----

type LonLat = [number, number];
const project = ([lon, lat]: LonLat) => `${Math.round((lon + 125) * 17.5)},${Math.round((50 - lat) * 22)}`;
const path = (points: LonLat[]) => `M${points.map(project).join('L')}Z`;

const OUTLINE: LonLat[] = [
  [-124.7, 48.4], [-123, 49], [-95.2, 49], [-89.6, 48], [-84.8, 46.5], [-82.5, 45.3], [-82.4, 43],
  [-83.1, 42], [-79, 42.9], [-76.2, 43.5], [-74.9, 45], [-71.5, 45], [-70, 46.7], [-67.8, 47.1], [-67, 44.8],
  [-70.6, 43.1], [-70, 41.8], [-71.9, 41.3], [-74, 40.6], [-74.9, 38.9], [-76, 37], [-75.5, 35.2],
  [-77.9, 33.9], [-79.9, 32.7], [-81.4, 30.4], [-80, 26.8], [-80.4, 25.2], [-81.8, 26], [-82.8, 27.9],
  [-84.3, 30], [-86.5, 30.4], [-89.6, 30.2], [-89.4, 29], [-91, 29.5], [-93.8, 29.7], [-95, 29.2],
  [-97.2, 27.7], [-97.4, 25.9], [-99.5, 27.5], [-101.4, 29.8], [-103.3, 29], [-104.5, 29.6], [-106.5, 31.8],
  [-108.2, 31.8], [-108.2, 31.3], [-111.1, 31.3], [-114.8, 32.5], [-117.1, 32.5], [-118.5, 34],
  [-120.6, 34.6], [-121.9, 36.6], [-122.5, 37.8], [-123.8, 39.8], [-124.4, 42], [-124, 46.3],
];

// Zone borders from north to south, simplified from the real ones.
const PACIFIC_MOUNTAIN: LonLat[] = [[-116.5, 49], [-116.5, 45.5], [-117.2, 44.3], [-117, 42], [-114, 42], [-114, 36], [-114.6, 35], [-114.7, 32.5]];
const MOUNTAIN_CENTRAL: LonLat[] = [[-101, 49], [-101, 46], [-100.5, 45], [-100.5, 43], [-101.5, 42.5], [-101.5, 40], [-102, 37], [-103, 37], [-103, 32], [-104.8, 32], [-104.8, 29.5]];
const CENTRAL_EASTERN: LonLat[] = [[-87, 49], [-87, 41], [-87.5, 38], [-86, 37.5], [-85.5, 36.5], [-85.3, 35], [-85.1, 32], [-85, 31], [-85.2, 29.5]];

// Each zone reaches just past the map's edges, so the outline trims it and its middle stays on land.
const reach = (line: LonLat[]): LonLat[] => [[line[0][0], 49.6], ...line, [line[line.length - 1][0], 24.4]];
const between = (west: LonLat[], east: LonLat[]): LonLat[] => [...reach(west), ...reach(east).reverse()];

interface Region {
  name: string;
  tz: string;
  shape: string;
  /** Where its label sits, as longitude and latitude. */
  at: LonLat;
}

const REGIONS: Region[] = [
  { name: 'Pacific', tz: 'America/Los_Angeles', shape: path([[-125, 49.6], ...reach(PACIFIC_MOUNTAIN), [-125, 24.4]]), at: [-120.9, 40.5] },
  { name: 'Mountain', tz: 'America/Denver', shape: path(between(PACIFIC_MOUNTAIN, MOUNTAIN_CENTRAL)), at: [-109.2, 41.5] },
  { name: 'Central', tz: 'America/Chicago', shape: path(between(MOUNTAIN_CENTRAL, CENTRAL_EASTERN)), at: [-94, 39.5] },
  { name: 'Eastern', tz: 'America/New_York', shape: path([...reach(CENTRAL_EASTERN), [-66.5, 24.4], [-66.5, 49.6]]), at: [-79.6, 38.6] },
];

const OTHER_US = [
  { name: 'Alaska', tz: 'America/Anchorage' },
  { name: 'Hawaii', tz: 'Pacific/Honolulu' },
  { name: 'Arizona', tz: 'America/Phoenix', note: 'no daylight saving' },
];

/**
 * The time zone, shown as "Eastern time" or "Berlin CET". Opening it shows a map of the US zones, each with
 * its time right now, buttons for Alaska, Hawaii and Arizona, and every other zone in a list.
 */
export function ZonePicker({
  value,
  onChange,
  detected,
  label = 'Time zone',
  align = 'start',
}: {
  value: string;
  onChange: (tz: string) => void;
  detected?: string;
  label?: string;
  /** Which edge the map opens from: 'end' for the corner of the top bar. */
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const root = useRef<HTMLDivElement>(null);
  // React's ids carry characters that don't survive inside url(#…), which the map's clip path needs.
  const panelId = `zone-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const place = zonePlace(value);
  const isUs = REGIONS.some((r) => r.name === place) || OTHER_US.some((r) => r.name === place);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>('.zone-trigger')?.focus();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    // Start the keyboard on the zone that's chosen, or the first.
    root.current?.querySelector<SVGElement>('.zone-region[aria-pressed="true"], .zone-region')?.focus();
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const options = useMemo(() => {
    if (!open) return [];
    const zones = allZones();
    if (!zones.includes(value)) zones.push(value);
    return zones
      .map((tz) => ({ tz, offset: tzOffset(now, tz) }))
      .sort((a, b) => a.offset - b.offset || zoneCity(a.tz).localeCompare(zoneCity(b.tz)))
      .map(({ tz, offset }) => ({
        tz,
        label: `${offsetLabel(offset)} ${zoneCity(tz)}${tz === detected ? ' (yours)' : ''}`,
      }));
  }, [open, value, detected, now]);

  const choose = (tz: string) => {
    onChange(tz);
    setOpen(false);
    root.current?.querySelector<HTMLButtonElement>('.zone-trigger')?.focus();
  };
  const detectedPlace = detected ? zonePlace(detected) : undefined;

  return (
    <div className="zone-picker" ref={root} data-align={align}>
      <button
        type="button"
        className="zone-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${label}: ${isUs ? `${place} time` : `${place}, ${zoneName(value, now, 'long')}`}. Change`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="zone-current">
          {isUs ? `${place} time` : place}{' '}
          {!isUs && <span className="muted">{zoneName(value, now, 'short')}</span>}
        </span>
      </button>
      {open && (
        <div className="zone-panel" id={panelId} role="dialog" aria-label={label}>
          <p className="zone-panel-title">Which time are you on?</p>
          <svg className="zone-map" viewBox="0 0 1040 590" role="group" aria-label="US time zones">
            <defs>
              <clipPath id={`${panelId}-us`}>
                <path d={path(OUTLINE)} />
              </clipPath>
            </defs>
            <g clipPath={`url(#${panelId}-us)`}>
              {REGIONS.map((r) => (
                <path
                  key={r.name}
                  className="zone-region"
                  d={r.shape}
                  role="button"
                  tabIndex={0}
                  aria-pressed={place === r.name}
                  aria-label={`${r.name} time, ${formatTime(now, r.tz)} now`}
                  onClick={() => choose(r.tz)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      choose(r.tz);
                    }
                  }}
                />
              ))}
            </g>
            <path className="zone-outline" d={path(OUTLINE)} />
            {REGIONS.map((r) => {
              const [x, y] = project(r.at).split(',').map(Number);
              return (
                <g key={r.name} className="zone-label" data-on={place === r.name || undefined} aria-hidden="true">
                  <text x={x} y={y}>
                    {r.name}
                  </text>
                  <text x={x} y={y + 40} className="zone-label-time">
                    {formatTime(now, r.tz)}
                  </text>
                  {detectedPlace === r.name && place !== r.name && (
                    <text x={x} y={y + 76} className="zone-label-yours">
                      yours
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="zone-others">
            {OTHER_US.map((o) => (
              <button
                key={o.name}
                type="button"
                className="chip small"
                aria-pressed={place === o.name}
                onClick={() => choose(o.tz)}
              >
                {o.name} {formatTime(now, o.tz)}
                {o.note && <span className="zone-note"> {o.note}</span>}
              </button>
            ))}
          </div>
          <label className="zone-elsewhere">
            <span>Somewhere else</span>
            <select value={isUs ? '' : value} onChange={(e) => e.target.value && choose(e.target.value)}>
              {isUs && <option value="">Pick a city…</option>}
              {options.map((o) => (
                <option key={o.tz} value={o.tz}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
