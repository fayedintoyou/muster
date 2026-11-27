import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

// A short guided tour for someone answering for the first time: it lights up one part of the page at a
// time with a card saying what it's for. The page stays usable underneath, so they can try each step.

export interface TourStep {
  /** What to light up: the first element matching this selector. A step whose target is missing is skipped. */
  target: string;
  title: string;
  body: string;
}

const SEEN = 'muster:tour';

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN) === 'done';
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN, 'done');
  } catch {
    // Private browsing: the tour may show again next time, which is harmless.
  }
}

const PAD = 6;
const GAP = 12;

export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const live = steps.filter((s) => document.querySelector(s.target));
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const [cardHeight, setCardHeight] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const titleId = `tour-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const step = live[Math.min(i, live.length - 1)];

  const close = useCallback(() => {
    markSeen();
    onClose();
  }, [onClose]);

  // Bring the step's target into view, then follow it as the page scrolls or resizes.
  useEffect(() => {
    if (!step) return;
    const el = document.querySelector(step.target);
    if (!el) return;
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (window.innerWidth < 560) {
      // On a phone the card sits along the bottom, so the lit part goes near the top, under the sticky tabs.
      const tabs = document.querySelector('.tabs')?.getBoundingClientRect().height ?? 0;
      const top = el.getBoundingClientRect().top + window.scrollY - tabs - 16;
      window.scrollTo({ top: el.matches('.tabs') ? Math.max(0, top - 80) : Math.max(0, top), behavior });
    } else {
      el.scrollIntoView({ block: 'center', behavior });
    }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setBox(el.getBoundingClientRect()));
    };
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [step]);

  useLayoutEffect(() => {
    if (card.current) setCardHeight(card.current.offsetHeight);
  }, [step, box]);

  useEffect(() => {
    next.current?.focus({ preventScroll: true });
  }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!step) return null;
  const last = i >= live.length - 1;

  // The card goes below the lit part if it fits, otherwise above; on a phone, along the bottom.
  const narrow = window.innerWidth < 560;
  const width = Math.min(352, window.innerWidth - 32);
  let top = 0;
  let left = 16;
  if (box && !narrow) {
    const below = box.bottom + PAD + GAP;
    top = below + cardHeight < window.innerHeight - 16 ? below : Math.max(16, box.top - PAD - GAP - cardHeight);
    left = Math.min(Math.max(16, box.left), window.innerWidth - width - 16);
  }

  return (
    <div className="tour">
      {box && (
        <div
          className="tour-spot"
          aria-hidden="true"
          style={{ top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 }}
        />
      )}
      <div
        ref={card}
        className="tour-card"
        data-narrow={narrow || undefined}
        role="dialog"
        aria-labelledby={titleId}
        style={narrow ? undefined : { top, left, width }}
      >
        <p className="tour-count">
          {i + 1} of {live.length}
        </p>
        <h2 className="tour-title" id={titleId}>
          {step.title}
        </h2>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="text-button" onClick={close}>
            skip
          </button>
          <span className="tour-step-buttons">
            {i > 0 && (
              <button type="button" className="button small" onClick={() => setI(i - 1)}>
                back
              </button>
            )}
            <button ref={next} type="button" className="button small primary" onClick={() => (last ? close() : setI(i + 1))}>
              {last ? 'got it' : 'next'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** The tour for someone who hasn't answered yet. */
export const ANSWER_TOUR: TourStep[] = [
  {
    target: '.panel-mine .paint',
    title: 'Light up when you can play',
    body: 'Each column is a night, in your own time zone. Press on an hour and drag down to light up the hours you can play. Tap a night’s name to light the whole night.',
  },
  {
    target: '.panel-mine .tool',
    title: 'Available, or if needed',
    body: 'Available means you can play for sure. If needed means you could at a push. Best times counts people who are sure first, and only leans on if-needed hours when it has to.',
  },
  {
    target: '.topbar .zone-current',
    title: 'Times are in your zone',
    body: 'Everyone sees the same hours in their own time zone, with server time alongside. If this is wrong, change it here.',
  },
  {
    target: '.join',
    title: 'Then, who you are',
    body: 'Add your character’s name, class and spec, and save. Your times save themselves from then on. Signing in with Discord lets you come back from any device.',
  },
  {
    target: '.tabs',
    title: 'See everyone',
    body: 'Once you’ve answered, everyone shows when the guild is free, and best times finds the nights that fill a raid.',
  },
];
