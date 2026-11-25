import type { CSSProperties } from 'react';
import { classLabel, specsFor } from '../core/classes';
import { LIMITS } from '../core/validate';
import { ClassIcon } from './icons';

// WoW's class colours, which every player already reads at a glance. Shaman's blue is lifted a little so
// it stays legible on the night background. A class the poll's maker added has none.
const COLOURS: Record<string, string> = {
  warrior: '#c69b6d',
  paladin: '#f48cba',
  hunter: '#aad372',
  rogue: '#fff468',
  priest: '#ffffff',
  shaman: '#2f8ff0',
  mage: '#3fc7eb',
  warlock: '#8788ee',
  druid: '#ff7c0a',
};

export function classStyle(cls: string): CSSProperties | undefined {
  const colour = COLOURS[cls];
  return colour ? ({ '--class': colour } as CSSProperties) : undefined;
}

/** "holy / protection paladin" in the paladin's colour; or the typed spec alone, from before spec buttons. */
export function ClassName({ cls, specs, spec }: { cls: string; specs: string[]; spec: string }) {
  if (!cls) return spec ? <span className="person-spec">{spec}</span> : null;
  return (
    <span className="class-name" style={classStyle(cls)}>
      {classLabel(cls, specs)}
    </span>
  );
}

/**
 * A class from the poll's list, then one or two of its specs (typed, for a class muster has no specs for).
 * `missing` says which of the two still needs picking, once someone has tried to save without it.
 */
export function ClassPicker({
  classes,
  cls,
  specs,
  onChange,
  idPrefix,
  missing,
}: {
  classes: string[];
  cls: string;
  specs: string[];
  onChange: (cls: string, specs: string[]) => void;
  idPrefix: string;
  missing?: 'class' | 'spec' | null;
}) {
  const known = specsFor(cls);
  const full = specs.length >= LIMITS.specs;
  return (
    <div className="class-picker">
      <fieldset className="field" aria-invalid={missing === 'class' || undefined}>
        <legend>Class</legend>
        <div className="day-chips">
          {classes.map((c) => (
            <button
              type="button"
              key={c}
              className="chip class-chip icon-chip"
              style={classStyle(c)}
              aria-pressed={cls === c}
              // Another class starts its specs afresh.
              onClick={() => onChange(c, c === cls ? specs : [])}
            >
              <ClassIcon cls={c} />
              {c}
            </button>
          ))}
        </div>
        {missing === 'class' && (
          <p className="error" role="alert" id={`${idPrefix}-class-missing`}>
            Pick your class.
          </p>
        )}
      </fieldset>
      {cls && known.length > 0 && (
        <fieldset className="field" aria-invalid={missing === 'spec' || undefined}>
          <legend>
            Spec <span className="muted">(one, or two if you play both)</span>
          </legend>
          <div className="day-chips">
            {known.map((sp) => {
              const on = specs.includes(sp);
              return (
                <button
                  type="button"
                  key={sp}
                  className="chip class-chip"
                  style={classStyle(cls)}
                  aria-pressed={on}
                  disabled={!on && full}
                  onClick={() => onChange(cls, on ? specs.filter((x) => x !== sp) : known.filter((x) => x === sp || specs.includes(x)))}
                >
                  {sp}
                </button>
              );
            })}
          </div>
          {missing === 'spec' && (
            <p className="error" role="alert" id={`${idPrefix}-spec-missing`}>
              Pick your spec.
            </p>
          )}
        </fieldset>
      )}
      {cls && known.length === 0 && (
        <div className="field">
          <label htmlFor={`${idPrefix}-spec`}>Spec</label>
          <input
            key={cls}
            id={`${idPrefix}-spec`}
            defaultValue={specs[0] ?? ''}
            maxLength={LIMITS.spec}
            autoComplete="off"
            onBlur={(e) => onChange(cls, e.target.value.trim() ? [e.target.value.trim()] : [])}
          />
          {missing === 'spec' && (
            <p className="error" role="alert" id={`${idPrefix}-spec-missing`}>
              Pick your spec.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
