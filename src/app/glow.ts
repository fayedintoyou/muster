// How a pane glows for a share of the guild being free: from an unlit window through ember to
// lamplight. Shared by the group grid, its legend and the home page's picture.

const STOPS: [number, [number, number, number]][] = [
  [0, [23, 19, 29]],
  [0.12, [44, 26, 29]],
  [0.3, [92, 42, 27]],
  [0.5, [156, 75, 28]],
  [0.7, [218, 123, 42]],
  [0.88, [255, 168, 76]],
  [1, [255, 194, 122]],
];

export function glow(level: number): string {
  const t = Math.max(0, Math.min(1, level));
  for (let i = 1; i < STOPS.length; i++) {
    const [a, ca] = STOPS[i - 1];
    const [b, cb] = STOPS[i];
    if (t <= b) {
      const k = (t - a) / (b - a);
      const c = ca.map((v, j) => Math.round(v + (cb[j] - v) * k));
      return `rgb(${c[0]} ${c[1]} ${c[2]})`;
    }
  }
  return 'rgb(255 194 122)';
}

export const GLOW_GRADIENT = `linear-gradient(90deg, ${STOPS.map(
  ([at, [r, g, b]]) => `rgb(${r} ${g} ${b}) ${Math.round(at * 100)}%`,
).join(', ')})`;
