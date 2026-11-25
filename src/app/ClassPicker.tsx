import type { CSSProperties } from 'react';
import { specsFor } from '../core/classes';
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

/** "protection paladin" in the paladin's colour; or the spec alone, for people without a class. */
export function ClassName({ cls, spec }: { cls: string; spec: string }) {
  if (!cls) return spec ? <span className="person-spec">{spec}</span> : null;
  return (
    <span className="class-name" style={classStyle(cls)}>
      {spec ? `${spec} ${cls}` : cls}
    </span>
  );
}

/** One class from the poll's list, then one of that class's specs (or a typed one for a class without a list). */
export function ClassPicker({
  classes,
  cls,
  spec,
  onChange,
  idPrefix,
}: {
  classes: string[];
  cls: string;
  spec: string;
  onChange: (cls: string, spec: string) => void;
  idPrefix: string;
}) {
  const specs = specsFor(cls);
  return (
    <div className="class-picker">
      <fieldset className="field">
        <legend>
          Class <span className="muted">(optional)</span>
        </legend>
        <div className="day-chips">
          {classes.map((c) => (
            <button
              type="button"
              key={c}
              className="chip class-chip icon-chip"
              style={classStyle(c)}
              aria-pressed={cls === c}
              onClick={() => {
                const next = cls === c ? '' : c;
                // A spec that the new class doesn't have goes with the old class.
                onChange(next, specsFor(next).includes(spec) || (!specsFor(next).length && next) ? spec : '');
              }}
            >
              <ClassIcon cls={c} />
              {c}
            </button>
          ))}
        </div>
      </fieldset>
      {cls && specs.length > 0 && (
        <fieldset className="field">
          <legend>Spec</legend>
          <div className="day-chips">
            {specs.map((s) => (
              <button
                type="button"
                key={s}
                className="chip class-chip"
                style={classStyle(cls)}
                aria-pressed={spec === s}
                onClick={() => onChange(cls, spec === s ? '' : s)}
              >
                {s}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {cls && specs.length === 0 && (
        <div className="field">
          <label htmlFor={`${idPrefix}-spec`}>
            Spec <span className="muted">(optional)</span>
          </label>
          <input
            key={cls}
            id={`${idPrefix}-spec`}
            defaultValue={spec}
            maxLength={40}
            autoComplete="off"
            onBlur={(e) => e.target.value.trim() !== spec && onChange(cls, e.target.value.trim())}
          />
        </div>
      )}
    </div>
  );
}
