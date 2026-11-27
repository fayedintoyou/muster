import { RAID_SIZES, seatsFor, usualMakeup } from '../core/seating';

/** Any size, 10, 20 or 40 players, and with a size its tanks and healers (dps are the rest). */
export function RaidSize({
  size,
  makeup,
  onChange,
}: {
  size: number;
  makeup: Record<string, number>;
  onChange: (size: number, makeup: Record<string, number>) => void;
}) {
  const seats = seatsFor(size, makeup);
  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="Raid size">
        {[0, ...RAID_SIZES].map((n) => (
          <button type="button" role="radio" key={n} aria-checked={size === n} onClick={() => onChange(n, usualMakeup(n))}>
            {n ? `${n} players` : 'any size'}
          </button>
        ))}
      </div>
      {size > 0 && (
        <div className="makeup">
          {(['tank', 'healer'] as const).map((role) => (
            <label key={role} className="select">
              <select
                aria-label={role === 'tank' ? 'Tanks' : 'Healers'}
                value={makeup[role] ?? 0}
                onChange={(e) => onChange(size, { ...makeup, [role]: Number(e.target.value) })}
              >
                {Array.from({ length: size + 1 }, (_, n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span>{role === 'tank' ? 'tanks' : 'healers'}</span>
            </label>
          ))}
          <span className="makeup-rest">{seats.dps} dps</span>
        </div>
      )}
    </>
  );
}
