// Renders the link-preview image (public/og.png, 1200×630) and the home-screen icon
// (public/apple-touch-icon.png, 180×180) in Chrome, from the same fonts and glow as the app.
// Run after changing either: node scripts/art.mjs (CHROME=/path/to/chrome if it isn't /usr/bin/google-chrome).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const font = (p) => `file://${root}node_modules/${p}`;
const CHROME =
  process.env.CHROME ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome');

// The glow ramp from src/app/glow.ts, and a week of evenings with Thursday at nine the warmest.
const STOPS = [
  [0, [23, 19, 29]], [0.12, [44, 26, 29]], [0.3, [92, 42, 27]], [0.5, [156, 75, 28]],
  [0.7, [218, 123, 42]], [0.88, [255, 168, 76]], [1, [255, 194, 122]],
];
function glow(level) {
  for (let i = 1; i < STOPS.length; i++) {
    const [a, ca] = STOPS[i - 1];
    const [b, cb] = STOPS[i];
    if (level <= b) {
      const k = (level - a) / (b - a);
      return `rgb(${ca.map((v, j) => Math.round(v + (cb[j] - v) * k)).join(' ')})`;
    }
  }
  return 'rgb(255 194 122)';
}
const NIGHTS = [
  [0.15, 0.3, 0.45, 0.4, 0.25, 0.08],
  [0.25, 0.55, 0.8, 0.75, 0.5, 0.18],
  [0.2, 0.45, 0.65, 0.6, 0.4, 0.12],
  [0.3, 0.7, 1, 0.95, 0.65, 0.25],
  [0.1, 0.25, 0.35, 0.4, 0.35, 0.28],
  [0.18, 0.22, 0.3, 0.38, 0.32, 0.22],
  [0.25, 0.4, 0.5, 0.45, 0.28, 0.08],
];
const panes = NIGHTS[0]
  .map((_, row) =>
    NIGHTS.map((night) => {
      const level = night[row];
      const bg = level === 1 ? '#ffe1b0' : glow(level);
      const shadow = `0 0 ${Math.round(level * 26)}px rgba(255,150,60,${(level * level * 0.5).toFixed(2)})`;
      return `<i style="background:${bg};box-shadow:${shadow}"></i>`;
    }).join(''),
  )
  .join('');

const og = `<!doctype html><html><head><style>
@font-face { font-family: Fraunces; src: url('${font('@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2')}') format('woff2'); font-weight: 100 900; }
@font-face { font-family: Plex; src: url('${font('@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2')}') format('woff2'); }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; background: #07060b; color: #e9e2d6; font-family: Fraunces; overflow: hidden; position: relative; }
body::before { content: ''; position: absolute; inset: -260px -240px auto auto; width: 900px; height: 760px;
  background: radial-gradient(closest-side, rgba(255,179,92,0.14), transparent); }
.text { position: absolute; left: 80px; top: 84px; width: 680px; }
.mark { display: flex; align-items: center; gap: 16px; font-size: 40px; font-variation-settings: 'SOFT' 100, 'WONK' 1, 'opsz' 72; }
.mark svg { width: 34px; height: 34px; }
h1 { margin-top: 84px; font-size: 76px; line-height: 1; font-weight: 300; letter-spacing: -0.02em;
  font-variation-settings: 'SOFT' 100, 'WONK' 1, 'opsz' 144; }
p { margin-top: 34px; font-family: Plex; font-size: 22px; color: #8f8698; letter-spacing: 0.03em; }
.grid { position: absolute; right: 80px; top: 196px; display: grid; grid-template-columns: repeat(7, 44px); gap: 8px; }
.grid i { display: block; height: 44px; border-radius: 5px; }
.days { position: absolute; right: 80px; top: 162px; display: grid; grid-template-columns: repeat(7, 44px); gap: 8px;
  font-family: Plex; font-size: 17px; color: #5a5262; text-align: center; }
</style></head><body>
<div class="text">
  <div class="mark"><svg viewBox="0 0 20 20"><rect x="2" y="2" width="7" height="7" rx="1" fill="#262030"/><rect x="11" y="2" width="7" height="7" rx="1" fill="#ffb35c"/><rect x="2" y="11" width="7" height="7" rx="1" fill="#ffb35c"/><rect x="11" y="11" width="7" height="7" rx="1" fill="#8a5a2b"/></svg>muster</div>
  <h1>Find the night<br>everyone can raid.</h1>
  <p>muster.fayelore.com</p>
</div>
<div class="days"><span>m</span><span>t</span><span>w</span><span>t</span><span>f</span><span>s</span><span>s</span></div>
<div class="grid">${panes}</div>
</body></html>`;

const icon = `<!doctype html><html><head><style>
* { margin: 0; } body { width: 180px; height: 180px; background: #07060b; display: grid; place-items: center; }
svg { width: 124px; height: 124px; }
</style></head><body><svg viewBox="0 0 20 20">
<rect x="2" y="2" width="7.2" height="7.2" rx="1.2" fill="#262030"/><rect x="10.8" y="2" width="7.2" height="7.2" rx="1.2" fill="#ffb35c"/>
<rect x="2" y="10.8" width="7.2" height="7.2" rx="1.2" fill="#ffb35c"/><rect x="10.8" y="10.8" width="7.2" height="7.2" rx="1.2" fill="#8a5a2b"/>
</svg></body></html>`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
try {
  // From files, not setContent: a page from about:blank may not load fonts from disk.
  const dir = mkdtempSync(join(tmpdir(), 'muster-art-'));
  writeFileSync(join(dir, 'og.html'), og);
  writeFileSync(join(dir, 'icon.html'), icon);
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(`file://${join(dir, 'og.html')}`);
  await page.evaluate(() => document.fonts.ready);
  const families = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
  if (!families.includes('Fraunces') || !families.includes('Plex')) throw new Error(`fonts not loaded: ${families}`);
  await page.screenshot({ path: `${root}public/og.png` });
  await page.setViewportSize({ width: 180, height: 180 });
  await page.goto(`file://${join(dir, 'icon.html')}`);
  await page.screenshot({ path: `${root}public/apple-touch-icon.png` });
  rmSync(dir, { recursive: true, force: true });
} finally {
  await browser.close();
}
console.log('wrote public/og.png and public/apple-touch-icon.png');
