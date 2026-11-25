import type { CSSProperties } from 'react';
import { glow } from './glow';

// The home page's picture: a week of evenings as lit windows, the way every poll's group grid looks.
// Thursday around nine is the warmest.

const NIGHTS = [
  [0.15, 0.3, 0.45, 0.4, 0.25, 0.08],
  [0.25, 0.55, 0.8, 0.75, 0.5, 0.18],
  [0.2, 0.45, 0.65, 0.6, 0.4, 0.12],
  [0.3, 0.7, 1, 0.95, 0.65, 0.25],
  [0.1, 0.25, 0.35, 0.4, 0.35, 0.28],
  [0.18, 0.22, 0.3, 0.38, 0.32, 0.22],
  [0.25, 0.4, 0.5, 0.45, 0.28, 0.08],
];
const DAYS = ['m', 't', 'w', 't', 'f', 's', 's'];

export function Panes() {
  return (
    <figure className="panes" aria-hidden="true">
      <div className="panes-grid">
        {DAYS.map((d, i) => (
          <span key={`d${i}`} className="panes-day">
            {d}
          </span>
        ))}
        {NIGHTS[0].map((_, row) =>
          NIGHTS.map((night, col) => {
            const level = night[row];
            return (
              <span
                key={`${row}-${col}`}
                className="pane-cell"
                data-full={level === 1 || undefined}
                style={
                  {
                    '--level': level,
                    '--pane': glow(level),
                    '--delay': `${Math.round(180 + ((col * 7 + row * 13) % 17) * 55 + (1 - level) * 300)}ms`,
                  } as CSSProperties
                }
              />
            );
          }),
        )}
      </div>
      <figcaption>Each pane is a half hour. The more of the guild that’s free, the brighter it glows.</figcaption>
    </figure>
  );
}
