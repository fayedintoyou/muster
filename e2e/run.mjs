// End-to-end run in real Chrome against `wrangler dev` (started here on a fresh store unless BASE is set):
// a phone in New York makes a poll and paints with touch, a desktop in Berlin answers with a mouse, two
// more people answer through the API, then the group view, best times and Discord copy are checked.
// Screenshots land in e2e/shots/. Needs a built UI (npm run build) and Chrome (CHROME=/path/to/chrome).

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const CHROME =
  process.env.CHROME ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome');
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let BASE = process.env.BASE;
let server;
let store;
if (!BASE) {
  store = mkdtempSync(join(tmpdir(), 'muster-e2e-'));
  const port = 8790 + Math.floor(Math.random() * 200);
  BASE = `http://127.0.0.1:${port}`;
  server = spawn('npx', ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', store], {
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so stopping it stops wrangler and workerd under npx too.
    detached: true,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('wrangler dev did not start')), 60_000);
    const onData = (d) => {
      if (String(d).includes('Ready on')) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
  });
}

const errors = [];
const watch = (page, who) => {
  page.on('console', (m) => m.type() === 'error' && errors.push(`${who}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
};
const shot = (page, name, fullPage = true) => page.screenshot({ path: `${SHOTS}${name}.png`, fullPage });

async function touch(client, type, point) {
  await client.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] });
}
// Centre the element first: near the window's edges a held drag scrolls the page by design.
async function centre(page, selector) {
  const el = page.locator(selector);
  await el.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'center' }));
  const box = await el.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function box(page, selector) {
  const b = await page.locator(selector).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function touchDrag(page, client, from, to) {
  await page.locator(from).evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'center' }));
  const a = await box(page, from);
  const b = await box(page, to);
  await touch(client, 'touchStart', a);
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    await touch(client, 'touchMove', { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  await touch(client, 'touchEnd');
}
async function tap(page, client, selector) {
  const p = await centre(page, selector);
  await touch(client, 'touchStart', p);
  await touch(client, 'touchEnd');
}
const marks = (page, prefix) =>
  page.$$eval(`.paint .cell[data-key^="${prefix}"]`, (els) =>
    Object.fromEntries(els.filter((e) => e.dataset.mark !== '0').map((e) => [e.dataset.key, Number(e.dataset.mark)])),
  );

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
  // ---- A phone in New York makes the poll ----
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    timezoneId: 'America/New_York',
    locale: 'en-US',
  });
  await phone.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const p1 = await phone.newPage();
  watch(p1, 'phone');
  await p1.goto(`${BASE}/`);
  await p1.waitForSelector('.street .window');
  assert.equal(await p1.locator('.street .house').count(), 7, 'the home street has a house for each night');
  await p1.waitForTimeout(2500);
  await shot(p1, '01-home-phone');

  await p1.fill('#poll-title', 'Raid nights');
  for (const d of ['Mon', 'Fri', 'Sat', 'Sun']) await p1.click(`.day-chips button:text-is("${d}")`);
  const times = p1.locator('.poll-form .time-row select');
  await times.nth(0).selectOption(String(20 * 60));
  await times.nth(1).selectOption('60');
  // Classes are buttons to switch on and off; there's no separate question about roles.
  assert.equal(await p1.locator('.poll-form [aria-label="Roles to ask about"]').count(), 0, 'roles aren’t asked separately');
  assert.equal(await p1.locator('.poll-form [aria-label="Classes to offer"] .chip[aria-pressed="true"]').count(), 9, 'all nine classes start on');
  assert.equal(await p1.locator('.poll-form [aria-label="Classes to offer"] .chip .class-icon').count(), 9, 'each class has its icon');
  assert.equal(await p1.locator('.poll-form .class-chip').first().isVisible(), false);
  await p1.click('.poll-form .more summary');
  await p1.click('.poll-form .class-chip:text-is("druid")');
  await p1.click('button:text("make the poll")');
  await p1.waitForURL(/\/e\/[a-z0-9]{8}$/);
  const pollUrl = p1.url();
  const pollId = pollUrl.split('/').pop();
  await p1.waitForSelector('.share-panel');
  assert.match(await p1.locator('.share-panel').innerText(), /Mark your own times first/, 'the maker is told what to do next');
  // Someone opening the poll marks their times first, then says who they are.
  assert.ok(await p1.locator('.panel-mine .first-steps').isVisible(), 'a first-time visitor sees how answering works');
  assert.ok(await p1.locator('.panel-mine .paint .cell').first().isVisible(), 'the grid to mark is there before joining');
  assert.ok(await p1.locator('.how.first').isVisible(), 'the first-time drag hint shows before any marks');
  assert.equal(await p1.locator('.next-step').count(), 0, 'no next step before any marks');
  await shot(p1, '02-made-phone');

  const cdp = await phone.newCDPSession(p1);
  // Drag Tue 8pm → Wed 10:30pm: two nights, six half hours each.
  await touchDrag(p1, cdp, '.paint .cell[data-key="w2/1200"]', '.paint .cell[data-key="w3/1350"]');
  // Then Thu 9pm and 9:30pm as "if needed", by tapping.
  await p1.click('.tool button:text("if needed")');
  await tap(p1, cdp, '.paint .cell[data-key="w4/1260"]');
  await tap(p1, cdp, '.paint .cell[data-key="w4/1290"]');
  // Starting on an "if needed" slot with that tool clears it.
  await tap(p1, cdp, '.paint .cell[data-key="w4/1290"]');
  await p1.click('.tool button:text("available")');
  await shot(p1, '02b-marked-before-joining-phone');

  await p1.fill('#join-name', 'Faye');
  assert.equal(await p1.locator('.join legend:text("What do you play?")').count(), 0, 'no separate roles question');
  // Class and spec are required: saving without them says which is missing, and saves nothing.
  await p1.click('button:text("save my times")');
  assert.match(await p1.locator('#join-class-missing').innerText(), /Pick your class/);
  // Classes come as buttons in WoW's class colours; picking one offers its specs.
  assert.equal(await p1.locator('.join .class-picker fieldset:first-of-type .class-chip').count(), 8, 'a class switched off isn’t offered');
  await p1.click('.join .class-chip:text-is("paladin")');
  assert.deepEqual(await p1.locator('.join .class-picker fieldset:nth-of-type(2) .class-chip').allInnerTexts(), ['holy', 'protection', 'retribution'], 'a paladin picks from paladin specs');
  await p1.click('button:text("save my times")');
  assert.match(await p1.locator('#join-spec-missing').innerText(), /Pick your spec/);
  assert.equal(await p1.locator('.me-line').count(), 0, 'nothing saved without a spec');
  // Up to two specs: once two are picked, the third waits.
  await p1.click('.join .class-chip:text-is("protection")');
  await p1.click('.join .class-chip:text-is("retribution")');
  assert.equal(await p1.locator('.join .class-chip:text-is("holy")').isDisabled(), true, 'at most two specs');
  await p1.fill('#join-note', 'Fridays I might be late');
  await p1.click('button:text("save my times")');
  await p1.waitForSelector('.me-line');
  // What shows now is the saved copy from the server, so this checks the times went along with the join.
  const mine = { ...(await marks(p1, 'w2')), ...(await marks(p1, 'w3')), ...(await marks(p1, 'w4')) };
  assert.equal(Object.values(mine).filter((m) => m === 2).length, 12, 'touch drag filled a 2×6 rectangle, saved on join');
  assert.deepEqual(
    Object.entries(mine).filter(([, m]) => m === 1).map(([k]) => k),
    ['w4/1260'],
    'a tap marked "if needed" and a second tap cleared one',
  );
  assert.equal(await p1.locator('.how.first').count(), 0, 'the first-time hint goes once times are marked');
  assert.ok(await p1.locator('.next-step').isVisible(), 'the next step shows once times are marked');
  assert.deepEqual(await p1.locator('.my-class .class-chip[aria-pressed="true"]').allInnerTexts(), ['paladin', 'protection', 'retribution'], 'the class and both specs were saved');
  await shot(p1, '03-painted-phone');
  await p1.click('.next-step button:text("see who else is free")');
  assert.equal(await p1.locator('#tab-group').getAttribute('aria-selected'), 'true', 'the next step opens everyone');
  assert.equal(await p1.locator('.people-list .class-name').innerText(), 'protection / retribution paladin', 'everyone sees the class and specs');
  assert.equal(await p1.locator('.people-list .person-roles').innerText(), 'tank, dps', 'the roles come from the specs');
  assert.equal(await p1.locator('.person-note').innerText(), 'Fridays I might be late', 'everyone sees the note');
  await p1.click('#tab-mine');
  // The note can be changed after joining; it saves when the field loses focus.
  await p1.fill('.my-note textarea', 'Fridays I’m 30 minutes late');
  await p1.locator('.my-note textarea').blur();
  await p1.waitForFunction(
    async (url) => (await (await fetch(url)).json()).people.some((p) => p.note === 'Fridays I’m 30 minutes late'),
    `${BASE}/api/polls/${pollId}`,
  );

  // US zones go by their region, and the map switches between them.
  assert.match(await p1.locator('.poll-when').innerText(), /in Eastern time/, 'New York reads as Eastern time');
  assert.match(await p1.locator('.poll-when').innerText(), /\(7pm–12am server time\)/, 'with the realm’s Central time beside it');
  assert.equal(await p1.locator('.topbar .zone-current').innerText(), 'Eastern time');
  assert.match(await p1.locator('.paint .row-head').first().innerText(), /^8pm/);
  await p1.click('.topbar .zone-trigger');
  await p1.waitForSelector('.zone-panel .zone-map');
  assert.equal(await p1.locator('.zone-region[aria-pressed="true"]').getAttribute('aria-label').then((l) => l.split(' ')[0]), 'Eastern', 'the map shows Eastern as chosen');
  await shot(p1, '03b-zone-map-phone', false);
  await p1.click('.zone-region[aria-label^="Pacific"]');
  assert.equal(await p1.locator('.zone-panel').count(), 0, 'choosing a zone closes the map');
  assert.equal(await p1.locator('.topbar .zone-current').innerText(), 'Pacific time');
  assert.match(await p1.locator('.paint .row-head').first().innerText(), /^5pm/, 'Pacific shows the 8pm Eastern start as 5pm');
  await p1.click('.topbar .zone-trigger');
  await p1.click('.zone-region[aria-label^="Eastern"]');
  assert.match(await p1.locator('.paint .row-head').first().innerText(), /^8pm/, 'and back to Eastern');

  // ---- A desktop in Berlin, 24-hour clock ----
  const desk = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    timezoneId: 'Europe/Berlin',
    locale: 'en-GB',
  });
  const p2 = await desk.newPage();
  watch(p2, 'desk');
  await p2.goto(pollUrl);
  await p2.waitForSelector('.paint .cell');
  // One view at a time on a wide screen too: your grid first, everyone's behind its own tab.
  assert.equal(await p2.locator('.panel-group').isVisible(), false, 'everyone’s grid is its own view');
  assert.equal(await p2.locator('.panel-best').isVisible(), false, 'and best times too');
  await shot(p2, '04a-desk-before-answering', false);
  await p2.click('.tabs button:text("everyone (1)")');
  assert.ok(await p2.locator('.panel-group .heat .cell').first().isVisible(), 'you can look at everyone’s first');
  assert.equal(await p2.locator('.panel-mine').isVisible(), false, 'without your own grid beside it');
  await p2.click('.tabs button:text("mark your times")');
  const rowLabel = await p2.locator('.paint .row-head').first().innerText();
  assert.match(rowLabel, /^02:00/, `Berlin sees the 8pm ET start as 02:00 (got ${rowLabel})`);
  assert.match(await p2.locator('.topbar .zone-current').innerText(), /^Berlin/, 'zones outside the US keep their city');
  const from = await centre(p2, '.paint .cell[data-key="w2/1260"]');
  const to = await box(p2, '.paint .cell[data-key="w4/1410"]');
  await p2.mouse.move(from.x, from.y);
  await p2.mouse.down();
  await p2.mouse.move(to.x, to.y, { steps: 12 });
  await p2.mouse.up();
  // Saving without a name says so and puts the cursor in the name field, rather than doing nothing.
  await p2.click('button:text("save my times")');
  assert.match(await p2.locator('#join-name-missing').innerText(), /Add your name/, 'saving without a name says what’s missing');
  assert.equal(await p2.evaluate(() => document.activeElement?.id), 'join-name', 'and focuses the name field');
  assert.equal(await p2.locator('.me-line').count(), 0, 'nothing is saved without a name');
  await p2.fill('#join-name', 'Bo');
  await p2.click('.join .class-chip:text-is("priest")');
  await p2.click('.join .class-chip:text-is("holy")');
  assert.equal(await p2.locator('#join-name-missing').count(), 0, 'typing a name clears the message');
  await p2.click('button:text("save my times")');
  await p2.waitForSelector('.me-line');
  const bo = { ...(await marks(p2, 'w2')), ...(await marks(p2, 'w3')), ...(await marks(p2, 'w4')) };
  assert.equal(Object.keys(bo).length, 18, 'mouse drag filled a 3×6 rectangle');

  // ---- Two more people, straight through the API ----
  const join = async (name, cls, specs, keys, mark = 2) => {
    const r = await fetch(`${BASE}/api/polls/${pollId}/people`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, cls, specs }),
    }).then((x) => x.json());
    await fetch(`${BASE}/api/polls/${pollId}/people/${r.person.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${r.token}` },
      body: JSON.stringify({ marks: Object.fromEntries(keys.map((k) => [k, mark])) }),
    });
  };
  const span = (day, from, to) => {
    const out = [];
    for (let m = from; m < to; m += 30) out.push(`${day}/${m}`);
    return out;
  };
  await join('Cy', 'mage', ['frost'], [...span('w3', 1230, 1440), ...span('w4', 1200, 1500)]);
  await join('Dee', 'priest', ['holy', 'shadow'], [...span('w4', 1200, 1440), ...span('w2', 1290, 1500)]);
  // The server holds the same rules: no class, no answer.
  const noClass = await fetch(`${BASE}/api/polls/${pollId}/people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Eve' }),
  });
  assert.equal(noClass.status, 400, 'joining a poll with classes needs a class');
  const threeSpecs = await fetch(`${BASE}/api/polls/${pollId}/people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Eve', cls: 'priest', specs: ['holy', 'shadow', 'discipline'] }),
  });
  assert.equal(threeSpecs.status, 400, 'and at most two specs');

  await p2.reload();
  await p2.waitForSelector('.heat .cell');
  await p2.locator('.heat .cell[data-key="w4/1290"]').hover();
  await p2.waitForSelector('.slot-detail-head');
  await shot(p2, '04-desk-berlin');
  await p2.click('.tabs button:text("best times")');
  await shot(p2, '04b-desk-best');
  await p2.click('.tabs button:text("everyone")');

  // ---- Back on the phone: everyone, then best times ----
  await p1.reload();
  await p1.waitForSelector('.tabs');
  await p1.click('.tabs button:text("everyone")');
  await tap(p1, cdp, '.heat .cell[data-key="w4/1290"]');
  const detail = await p1.locator('.slot-detail').innerText();
  assert.match(detail, /3 of 4 free/, `slot detail counts (got ${detail})`);
  assert.equal(await p1.locator('.composition').innerText(), 'Of the 4: 2 priests, 1 paladin, 1 mage', 'everyone shows the class makeup');
  await shot(p1, '05-everyone-phone');

  await p1.click('.tabs button:text("best times")');
  await p1.waitForSelector('.best-item');
  const top = await p1.locator('.best-item').first().innerText();
  assert.match(top, /Thursday/, `best window is Thursday (got ${top})`);
  assert.equal(await p1.locator('.best-item').first().locator('.best-classes').innerText(), '2 priests, 1 mage', 'a best window shows the classes of who can come');
  assert.match(await p1.locator('.best-item').first().locator('.best-server').innerText(), /server time$/, 'and its time on the server');
  assert.match(await p1.locator('.best-item').first().locator('.roles-count').innerText(), /0\s*tank\s+2\s*healer\s+2\s*dps/, 'and its roles, counted from specs');
  await shot(p1, '06-best-phone');
  await p1.locator('.best-item').first().locator('button:text("copy for discord")').click();
  await p1.waitForSelector('.best-item button:text("copied")');
  const clip = await p1.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /^\*\*Raid nights\*\* · <t:\d+:F> – <t:\d+:t> \(<t:\d+:R>\)$/, `discord text (got ${clip})`);

  // "Must come": only windows with Cy.
  await p1.click('.tabs button:text("everyone")');
  await p1.locator('.people-list li', { hasText: 'Cy' }).locator('button:text("must come")').click();
  await p1.click('.tabs button:text("best times")');
  const withCy = await p1.locator('.best-item').allInnerTexts();
  assert.ok(withCy.length > 0 && withCy.every((t) => !/Not free:[^.]*Cy/.test(t)), 'every window includes Cy');

  // ---- Lock it in: the maker picks the top time, and it becomes the raid ----
  await p1.locator('.best-item').first().locator('button:text("lock in this time")').click();
  await p1.waitForSelector('.raid-banner');
  assert.match(await p1.locator('.raid-when').innerText(), /^Thursdays, /, 'the raid repeats on its night');
  assert.match(await p1.locator('.raid-server').innerText(), /server time$/);
  assert.match(await p1.locator('.raid-next').innerText(), /^Next: Thu .+, in \d+ (days|hours|minutes)\.$/, 'with the next night and how long until it');
  assert.equal(await p1.locator('.raid-nights li').count(), 4, 'and the nights coming up');
  assert.equal(await p1.locator('.best-item').first().locator('button:text("locked in")').count(), 1, 'best times marks the time locked in');
  await p1.locator('.raid-nights li').first().locator('button:text("call off")').click();
  await p1.waitForSelector('.raid-nights li[data-off]');
  assert.match(await p1.locator('.raid-next').innerText(), /^Next: Thu /, 'calling a night off moves next to the one after');
  const [download] = await Promise.all([p1.waitForEvent('download'), p1.click('.raid-actions button:text("add to calendar")')]);
  const ics = readFileSync(await download.path(), 'utf8');
  assert.match(ics, /RRULE:FREQ=WEEKLY/, 'the calendar file repeats weekly');
  assert.match(ics, /EXDATE;TZID=America\/New_York:/, 'without the night called off');
  await shot(p1, '06b-raid-phone');
  await p2.reload();
  await p2.waitForSelector('.raid-banner');
  assert.match(await p2.locator('.raid-when').innerText(), /^[A-Z][a-z]+days, \d{2}:\d{2}/, 'Berlin sees the raid on its own night and 24-hour clock');
  assert.equal(await p2.locator('.raid-banner button:text("call off"), .raid-banner button:text("unlock")').count(), 0, 'only the maker can change the raid');

  await shot(p2, '07-desk-full');

  // ---- The unfurl ----
  const html = await fetch(pollUrl).then((r) => r.text());
  assert.match(html, /<meta property="og:title" content="Raid nights"/);
  assert.match(html, /4 people answered/);

  // ---- Home on a desktop ----
  const p3 = await desk.newPage();
  watch(p3, 'desk-home');
  await p3.goto(`${BASE}/`);
  await p3.waitForTimeout(2500);
  await shot(p3, '08-home-desk');

  // ---- Seven nights in 15-minute slots on a phone: the densest common case ----
  const dense = await fetch(`${BASE}/api/polls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Mythic+ pushes',
      notes: '',
      mode: 'weekly',
      days: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w0'],
      start: 19 * 60,
      end: 120,
      slot: 15,
      tz: 'America/Chicago',
      roles: [],
      length: 120,
    }),
  }).then((r) => r.json());
  const p4 = await phone.newPage();
  watch(p4, 'phone-dense');
  await p4.goto(`${BASE}/e/${dense.id}`);
  // Saving a name before marking anything works too: the times then save as they're marked.
  await p4.fill('#join-name', 'Faye');
  await p4.click('button:text("save my times")');
  await p4.waitForSelector('.me-line');
  const cdp4 = await phone.newCDPSession(p4);
  await touchDrag(p4, cdp4, '.paint .cell[data-key="w1/1200"]', '.paint .cell[data-key="w5/1305"]');
  await p4.waitForSelector('.save-state.saved');
  const denseMarks = await p4.$$eval('.paint .cell[data-mark="2"]', (els) => els.length);
  assert.equal(denseMarks, 5 * 8, 'dense drag filled five nights of two hours');

  // Nights with the same hours and the same people make one best-times entry, copied as one line a night.
  const sameNights = {};
  for (const d of [1, 2, 3, 4, 5]) for (let m = 1200; m < 1320; m += 15) sameNights[`w${d}/${m}`] = 2;
  await fetch(`${BASE}/api/polls/${dense.id}/people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Bo', cls: 'mage', specs: ['frost'], marks: sameNights }),
  });
  await p4.reload();
  await p4.waitForSelector('.tabs');
  await p4.click('.tabs button:text("best times")');
  await p4.waitForSelector('.best-item');
  const grouped = p4.locator('.best-item').first();
  assert.match(await grouped.locator('h3').innerText(), /^Mon, Tue, Wed, Thu and Fri, /, 'the five same nights are one entry');
  assert.equal(await p4.locator('.best-item').count(), 1, 'and the only one');
  assert.equal(await grouped.locator('.best-classes').count(), 0, 'with everyone there, no repeat of the class list');
  await grouped.locator('button:text("copy for discord")').click();
  const nightsClip = await p4.evaluate(() => navigator.clipboard.readText());
  assert.equal(nightsClip.split('\n').length, 5, `one discord line a night (got ${nightsClip})`);
  await shot(p4, '09b-grouped-best-phone');
  await p4.click('.tabs button:text("your times")');

  // ---- A raid of 10: everyone takes one seat, in a role they play ----
  const ten = await fetch(`${BASE}/api/polls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Barrow Deeps', notes: '', mode: 'weekly', days: ['w3'], start: 20 * 60, end: 23 * 60, slot: 30,
      tz: 'America/Chicago', roles: ['tank', 'healer', 'dps'], classes: ['warrior', 'paladin', 'priest', 'mage'], length: 180, size: 10, makeup: { tank: 2, healer: 3 },
    }),
  }).then((r) => r.json());
  const wed = (mark) => Object.fromEntries([1200, 1230, 1260, 1290, 1320, 1350].map((m) => [`w3/${m}`, mark]));
  for (const [name, cls, specs, mark] of [
    ['Ana', 'warrior', ['protection'], 2],
    ['Ben', 'paladin', ['protection', 'retribution'], 2],
    ['Cat', 'priest', ['holy'], 2],
    ['Dan', 'mage', ['frost'], 1],
  ]) {
    await fetch(`${BASE}/api/polls/${ten.id}/people`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, cls, specs, marks: wed(mark) }),
    });
  }
  const p6 = await phone.newPage();
  watch(p6, 'phone-seats');
  await p6.goto(`${BASE}/e/${ten.id}`);
  await p6.waitForSelector('.tabs');
  await p6.click('.tabs button:text("best times")');
  await p6.waitForSelector('.best-item');
  const seated = p6.locator('.best-item').first();
  assert.match(await seated.locator('.best-count').innerText(), /4\s*\/10\s*seated, needs 2 healers, 4 dps/, 'a window says what the 10 still needs');
  assert.match(await seated.locator('.roles-count').innerText(), /2\/2\s*tank\s+1\/3\s*healer\s+1\/5\s*dps/, 'seat by seat');
  assert.equal(await seated.locator('.best-seating').innerText(), 'Counting Ben as tank, Dan only if needed.', 'and who the lineup counts on');
  await shot(p6, '09c-seats-phone');
  await p6.close();
  await shot(p4, '09-dense-phone');

  // Holding a drag at the bottom edge scrolls the page and keeps painting.
  await p4.evaluate(() => window.scrollTo(0, 0));
  await p4.click('.tool button:text("if needed")');
  const startAt = await centre(p4, '.paint .cell[data-key="w6/1140"]');
  await p4.evaluate(() => window.scrollTo(0, 0));
  const scrolledFrom = await p4.evaluate(() => window.scrollY);
  const s0 = await box(p4, '.paint .cell[data-key="w6/1140"]');
  await touch(cdp4, 'touchStart', s0);
  const edge = { x: s0.x, y: 844 - 12 };
  for (let i = 1; i <= 6; i++) await touch(cdp4, 'touchMove', { x: s0.x, y: s0.y + ((edge.y - s0.y) * i) / 6 });
  await p4.waitForTimeout(900);
  await touch(cdp4, 'touchMove', edge);
  await touch(cdp4, 'touchEnd');
  const scrolledTo = await p4.evaluate(() => window.scrollY);
  assert.ok(scrolledTo > scrolledFrom + 50, `edge scrolling moved the page (${scrolledFrom} → ${scrolledTo}, start ${JSON.stringify(startAt)})`);
  await p4.waitForSelector('.save-state.saved');
  const satMaybe = await p4.$$eval('.paint .cell[data-key^="w6/"][data-mark="1"]', (els) => els.length);
  const visibleRows = Math.floor((844 - 12 - s0.y) / 31);
  assert.ok(satMaybe > visibleRows, `the drag kept painting past the first screen (${satMaybe} slots, ${visibleRows} visible)`);

  // ---- Specific dates, made on a desktop with the calendar, then edited ----
  const p5 = await desk.newPage();
  watch(p5, 'desk-dates');
  await p5.goto(`${BASE}/`);
  await p5.fill('#poll-title', 'Launch week');
  await p5.click('.segmented button:text("specific dates")');
  await p5.click('button[aria-label="Next month"]');
  for (const d of ['1', '2', '3', '8', '9']) await p5.click(`.calendar-day:text-is("${d}")`);
  await p5.click('.segmented[aria-label="Raid size"] button:text("10 players")');
  assert.equal(await p5.locator('.makeup-rest').innerText(), '5 dps', 'a 10 starts as 2 tanks, 3 healers and 5 dps');
  await shot(p5, '10-dates-form-desk');
  await p5.click('button:text("make the poll")');
  await p5.waitForURL(/\/e\/[a-z0-9]{8}$/);
  await p5.waitForSelector('.share-panel');
  const heads = await p5.locator('.paint-wrap .col-head, .join').count();
  assert.ok(heads > 0);
  await p5.click('.admin summary');
  await p5.fill('.admin #poll-title', 'Launch week raids');
  await p5.click('.admin button:text("save changes")');
  await p5.waitForSelector('.admin button:text("saved")');
  assert.equal(await p5.locator('h1.title').innerText(), 'Launch week raids', 'editing renames the poll');
  await shot(p5, '11-dates-admin-desk');

  console.log(`ok: ${pollUrl}`);
} finally {
  await browser.close();
  if (server) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
    server.stdout.destroy();
    server.stderr.destroy();
    server.unref();
  }
  if (store) rmSync(store, { recursive: true, force: true });
}

if (errors.length) {
  console.error(`Console errors:\n${errors.join('\n')}`);
  process.exit(1);
}
