import { useEffect, useState, type CSSProperties } from 'react';
import { glow } from './glow';

// The home page's picture: a street of seven houses, one for each night of the week, with a window for
// each half hour of the evening. A window glows brighter the more of the guild is free then, the way
// every poll's group grid looks. Thursday around nine is the warmest.

const NIGHTS = [
  [0.15, 0.3, 0.45, 0.4, 0.25, 0.08],
  [0.25, 0.55, 0.8, 0.75, 0.5, 0.18],
  [0.2, 0.45, 0.65, 0.6, 0.4, 0.12],
  [0.3, 0.7, 1, 0.95, 0.65, 0.25],
  [0.1, 0.25, 0.35, 0.4, 0.35, 0.28],
  [0.18, 0.22, 0.3, 0.38, 0.32, 0.22],
  [0.25, 0.4, 0.5, 0.45, 0.28, 0.08],
];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
// Each house gets its own roof, so the row reads as a street rather than a chart.
const ROOFS = ['gable', 'flat', 'steep', 'gable', 'chimney', 'flat', 'steep'];
const TIMES = ['8pm', '', '9pm', '', '10pm', ''];

function daysToLaunch() {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return (Date.UTC(2026, 11, 9) - today) / 86_400_000;
}

export function Panes() {
  const [days, setDays] = useState(daysToLaunch);
  useEffect(() => {
    const update = () => setDays(daysToLaunch());
    const timer = window.setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  // Bring three more windows on each day in the fortnight before launch.
  const lit = Math.max(3, 42 - days * 3);
  return (
    <figure className="street">
      <div className="street-row" aria-hidden="true">
        <div className="street-times">
          {TIMES.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
        {NIGHTS.map((night, col) => (
          <div key={col} className="house" data-roof={ROOFS[col]}>
            <span className="roof" />
            <span className="house-body">
              {night.map((warmth, row) => {
                const level = days >= 0 && (col * 6 + row) * 17 % 42 >= lit ? 0 : warmth;
                return (
                <span
                  key={row}
                  className="window"
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
              })}
              <span className="door">{DAYS[col]}</span>
            </span>
          </div>
        ))}
      </div>
      {days >= 0 && (
        <figcaption><time dateTime="2026-12-09">Dec 9</time> · {days === 0 ? 'Launch day' : `${days} ${days === 1 ? 'day' : 'days'} until launch`}</figcaption>
      )}
    </figure>
  );
}
