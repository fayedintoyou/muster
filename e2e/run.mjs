// End-to-end run in real Chrome against `wrangler dev` (started here on a fresh store unless BASE is set):
// a phone in New York makes a poll and paints with touch, a desktop in Berlin answers with a mouse, two
// more people answer through the API, then the group view, best times and Discord copy are checked.
// Screenshots land in e2e/shots/. Needs a built UI (npm run build) and Chrome (CHROME=/path/to/chrome).

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
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
// A stand-in for Discord's OAuth2, which says whoever `discordUser` is when the Worker asks.
let discord;
let discordUser = null;
if (!BASE) {
  discord = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/oauth2/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', discordUser.id);
      back.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { location: back.toString() }).end();
    } else if (url.pathname === '/api/v10/oauth2/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const code = new URLSearchParams(body).get('code');
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: `at-${code}` }));
      });
    } else if (url.pathname === '/api/v10/users/@me') {
      const id = req.headers.authorization?.replace('Bearer at-', '');
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...discordUser, id }));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => discord.listen(0, '127.0.0.1', resolve));

  store = mkdtempSync(join(tmpdir(), 'muster-e2e-'));
  const port = 8790 + Math.floor(Math.random() * 200);
  BASE = `http://127.0.0.1:${port}`;
  const discordVars = [
    '--var',
    `DISCORD_ORIGIN:http://127.0.0.1:${discord.address().port}`,
    '--var',
    'DISCORD_CLIENT_SECRET:e2e-secret',
    '--var',
    `SITE_ORIGIN:${BASE}`,
  ];
  server = spawn('npx', ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', store, ...discordVars], {
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
  // ---- A first-time tour, once: the grid, available vs if needed, the time zone, who you are, the tabs ----
  await p1.waitForSelector('.tour-card');
  assert.equal(await p1.locator('.tour-count').innerText(), '1 of 5');
  await p1.waitForTimeout(1200);
  await shot(p1, '02a-tour-grid-phone', false);
  await p1.click('.tour-card button:text("next")');
  assert.match(await p1.locator('.tour-title').innerText(), /Available, or if needed/);
  await p1.waitForTimeout(1200);
  await shot(p1, '02a-tour-if-needed-phone', false);
  for (let n = 0; n < 3; n++) await p1.click('.tour-card button:text("next")');
  await p1.click('.tour-card button:text("got it")');
  assert.equal(await p1.locator('.tour-card').count(), 0, 'the tour closes');
  assert.equal(await p1.evaluate(() => localStorage.getItem('muster:tour')), 'done', 'and is remembered, so it doesn’t come back');
  await p1.click('.how.first button:text("show me how")');
  await p1.click('.tour-card button:text("skip")');
  assert.equal(await p1.locator('.tour-card').count(), 0, 'but can be replayed, and skipped');
  await p1.evaluate(() => window.scrollTo(0, 0));
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
  await p1.check('.join-level input');
  await p1.locator('.join').screenshot({ path: `${SHOTS}02c-join-level-phone.png` });
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
  await desk.addInitScript(() => localStorage.setItem('muster:tour', 'done'));
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
  assert.match(await p2.locator('#join-name-missing').innerText(), /Add your character’s name/, 'saving without a name says what’s missing');
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

  // ---- Keeping answers yours: a password, then Discord ----
  if (discord) {
    assert.match(await p2.locator('.my-lock').innerText(), /Anyone who types your name/, 'unlocked to start with');
    // While unlocked, someone else claims Bo on their own browser…
    const impostor = await fetch(`${BASE}/api/polls/${pollId}/people`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bo', claim: true }),
    }).then((r) => r.json());
    const asImpostor = () =>
      fetch(`${BASE}/api/polls/${pollId}/people/${impostor.person.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${impostor.token}` },
        body: JSON.stringify({ note: 'not Bo' }),
      }).then((r) => r.status);
    assert.equal(await asImpostor(), 200, 'an unlocked name is anyone’s');
    await p2.click('.my-lock button:text("lock with a password")');
    await p2.fill('.my-lock input[type="password"]', 'healz4days');
    await p2.click('.my-lock button:text("save password")');
    await p2.waitForSelector('.my-lock :text("locked with a password")');
    assert.equal(await asImpostor(), 403, '…and locking it signs every other browser out');
    const claimBo = (password) =>
      fetch(`${BASE}/api/polls/${pollId}/people`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Bo', claim: true, password }),
      });
    assert.equal((await claimBo('nope')).status, 403, 'a wrong password is refused');

    await p2.locator('.my-lock').screenshot({ path: `${SHOTS}04b-desk-link-discord.png` });
    discordUser = { id: '208123456789012345', username: 'bo_heals', global_name: 'Bo the Holy' };
    await p2.click('.my-lock button:text("link discord")');
    await p2.waitForSelector('.notice');
    assert.match(await p2.locator('.notice').innerText(), /Linked to Discord as Bo the Holy/, 'back from Discord, linked');
    assert.equal(new URL(p2.url()).hash, '', 'and the hash is cleared');
    assert.match(await p2.locator('.my-lock').innerText(), /password, and linked to Discord/);
    await shot(p2, '04c-desk-locked');
    await p2.click('.my-lock button:text("remove password")');
    await p2.waitForSelector('.my-lock :text("linked to Discord: sign in")');
    const byName = await claimBo(undefined);
    assert.equal(byName.status, 401, 'linked to Discord, a name alone no longer signs in');
    assert.equal((await byName.json()).discord, true);

    // A new browser signs in as Bo with Discord, and someone not linked is told so.
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago' });
    await fresh.addInitScript(() => localStorage.setItem('muster:tour', 'done'));
    const p7 = await fresh.newPage();
    watch(p7, 'fresh');
    await p7.goto(pollUrl);
    await p7.click('.join button:text("sign in with discord")');
    // Back from Discord first: until then the old page's "mark your times" tab matches too.
    await p7.waitForSelector('.notice:has-text("Signed in with Discord")');
    // Someone who has answered opens on everyone's times, as on any return.
    await p7.click('.tabs button:text-is("your times")');
    await p7.waitForSelector('.me-line');
    assert.match(await p7.locator('.me-line').innerText(), /Answering as Bo/, 'Discord signs a new device in as Bo');
    assert.match(await p7.locator('.notice').innerText(), /Signed in with Discord/);
    await shot(p7, '04d-phone-signed-in-with-discord');
    await p7.click('.me-line button:text("not you?")');
    discordUser = { id: '308123456789012345', username: 'stranger' };
    await p7.click('.notice button:text("ok")');
    await p7.click('.join button:text("sign in with discord")');
    // Not in the poll yet: the join form says so, with their Discord name filled in, and saving links it.
    await p7.waitForSelector('.discord-joined');
    assert.match(await p7.locator('.discord-joined').innerText(), /Signed in with Discord as stranger/);
    assert.equal(await p7.locator('.join button:text("lock my answers with a password")').count(), 0, 'Discord is the lock');
    await p7.fill('#join-name', 'Strangerdk');
    assert.equal(await p7.locator('.join button:text("sign in with discord")').count(), 0, 'no second sign-in button');
    await shot(p7, '04e-phone-discord-not-linked');
    await p7.click('.join .class-chip:text-is("mage")');
    await p7.click('.join .class-chip:text-is("frost")');
    await p7.click('button:text("save my times")');
    await p7.waitForSelector('.me-line');
    assert.match(await p7.locator('.my-lock').innerText(), /linked to Discord/, 'saved, and linked to Discord');
    const strangerId = await p7.evaluate((id) => JSON.parse(localStorage.getItem(`muster:poll:${id}`)).personId, pollId);
    const strangerToken = await p7.evaluate((id) => JSON.parse(localStorage.getItem(`muster:poll:${id}`)).token, pollId);
    await fetch(`${BASE}/api/polls/${pollId}/people/${strangerId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${strangerToken}` },
    });
    await fresh.close();

    // Ten wrong passwords for one person, and the next try waits, even with the right one.
    const gus = await fetch(`${BASE}/api/polls/${pollId}/people`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Gus', cls: 'warrior', specs: ['protection'], password: 'right-one' }),
    }).then((r) => r.json());
    const claimGus = (password) =>
      fetch(`${BASE}/api/polls/${pollId}/people`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Gus', claim: true, password }),
      }).then((r) => r.status);
    for (let i = 0; i < 10; i++) assert.equal(await claimGus(`wrong-${i}`), 403);
    assert.equal(await claimGus('right-one'), 429, 'too many wrong passwords and claiming waits');
    await fetch(`${BASE}/api/polls/${pollId}/people/${gus.person.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${gus.token}` },
    });
  }

  // ---- A poll where everyone answers through Discord ----
  if (discord) {
    const locked = await fetch(`${BASE}/api/polls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Discord only',
        mode: 'weekly',
        days: ['w4'],
        start: 1200,
        end: 1380,
        slot: 30,
        tz: 'America/Chicago',
        classes: ['mage', 'priest'],
        discordOnly: true,
      }),
    }).then((r) => r.json());
    const byName = await fetch(`${BASE}/api/polls/${locked.id}/people`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Zed', cls: 'mage', specs: ['frost'] }),
    });
    assert.equal(byName.status, 403, 'a name alone can’t answer');
    const only = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago' });
    await only.addInitScript(() => localStorage.setItem('muster:tour', 'done'));
    const p8 = await only.newPage();
    watch(p8, 'discord-only');
    await p8.goto(`${BASE}/e/${locked.id}`);
    await p8.locator('.paint .cell[data-key="w4/1200"]').click();
    assert.equal(await p8.locator('#join-name').count(), 0, 'no name field, only Discord');
    assert.match(await p8.locator('.join').innerText(), /asks everyone to sign in with Discord/);
    await shot(p8, '04f-phone-discord-only');
    discordUser = { id: '408123456789012345', username: 'zed', global_name: 'Zed' };
    await p8.click('.join button:text("sign in with discord")');
    await p8.waitForSelector('.discord-joined');
    assert.deepEqual(await marks(p8, 'w4'), { 'w4/1200': 2 }, 'the times marked before Discord are kept');
    await p8.fill('#join-name', 'Zedfrost');
    await p8.click('.join .class-chip:text-is("mage")');
    await p8.click('.join .class-chip:text-is("frost")');
    await p8.click('button:text("save my times")');
    await p8.waitForSelector('.me-line');
    assert.match(await p8.locator('.my-lock').innerText(), /linked to Discord/);
    await only.close();
  }

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
  // Level 60 or not: Faye ticked it on saving, Bo didn't, so Bo shows as levelling until they tick it.
  assert.equal(await p2.locator('.people-list li', { hasText: 'Faye' }).locator('.levelling').count(), 0, 'a 60 isn’t marked');
  assert.equal(await p2.locator('.people-list li', { hasText: 'Bo' }).locator('.levelling').innerText(), 'levelling', 'not 60 yet shows');
  await p2.locator('.people-list').screenshot({ path: `${SHOTS}04h-desk-levelling.png` });
  await p2.click('#tab-mine');
  assert.equal(await p2.locator('.my-level input').isChecked(), false);
  await p2.check('.my-level input');
  await p2.waitForFunction(
    async (url) => (await (await fetch(url)).json()).people.some((p) => p.name === 'Bo' && p.level60 === true),
    `${BASE}/api/polls/${pollId}`,
  );
  await p2.click('.tabs button:text("everyone")');
  assert.equal(await p2.locator('.people-list li', { hasText: 'Bo' }).locator('.levelling').count(), 0, 'ticked on their own tab later');

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
  assert.match(await p1.locator('.raid-next').innerText(), /^Next: Thu .+, (in \d+ (days?|hours?|minutes?)|on now)\.$/, 'with the next night and how long until it');
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

  // ---- Teams: the maker splits everyone into raid teams, each with its own time ----
  await p1.click('.tabs button:text("teams")');
  await p1.click('.teams button:text("new team")');
  await p1.fill('.team-form input[id^="team-name"]', 'Thursday 10');
  await p1.click('.team-form .segmented[aria-label="Raid size"] button:text("10 players")');
  for (const name of ['Bo', 'Cy', 'Dee']) await p1.locator('.team-pick li', { hasText: name }).locator('input').check();
  assert.match(await p1.locator('.team-form legend', { hasText: 'Who’s on it?' }).innerText(), /3 of 10/, 'the picker counts toward the size');
  await p1.click('.team-form button:text("make the team")');
  await p1.waitForSelector('.team h3:text("Thursday 10")');
  const team = p1.locator('.team[aria-label="Thursday 10"]');
  assert.equal(await team.locator('.team-roster li').count(), 3, 'the team has the three picked');
  await team.locator('button:text("find a time")').click();
  await team.locator('.best-item').first().waitFor();
  assert.match(await team.locator('.best-item').first().locator('.best-count').innerText(), /3\s*\/10\s*seated/, 'best times for the team reads only its members');
  await team.locator('.best-item').first().locator('button:text("lock in this time")').click();
  await team.locator('.raid-banner .raid-label:text("Thursday 10’s raid")').waitFor();
  // A second team sharing Bo, locked in at the same time, is flagged.
  await p1.click('.teams button:text("new team")');
  await p1.fill('.team-form input[id^="team-name"]', 'Alt run');
  for (const name of ['Bo', 'Cy']) await p1.locator('.team-pick li', { hasText: name }).locator('input').check();
  assert.match(await p1.locator('.team-pick li', { hasText: 'Bo' }).innerText(), /on Thursday 10/, 'the picker shows who is already on a team');
  await p1.click('.team-form button:text("make the team")');
  const alt = p1.locator('.team[aria-label="Alt run"]');
  await alt.locator('button:text("find a time")').click();
  // Bo and Cy share Wednesday and Thursday, so that entry offers a button for each night.
  await alt.locator('.best-item').first().locator('.best-lock button:text-is("Thu")').click();
  await alt.locator('.raid-banner').waitFor();
  assert.match(await alt.locator('.team-clash').innerText(), /Bo and Cy are also on Thursday 10, which raids at the same time\./, 'a clash is flagged');
  await shot(p1, '06c-teams-phone');
  await p2.reload();
  await p2.waitForSelector('.raid-line .raid-label:text("your team, Thursday 10:")');
  await p2.click('.tabs button:text("teams")');
  assert.equal(await p2.locator('.team button:text("change team")').count(), 0, 'only the maker changes teams');
  await shot(p2, '06d-teams-desk');

  // ---- Sign-ups: Bo says in from the line at the top; Faye, not on the team, signs up from its card ----
  const boLine = p2.locator('.raid-line', { hasText: 'your team, Thursday 10:' });
  await boLine.locator('.signup button:text-is("in")').click();
  await p2.waitForSelector('.raid-line:has-text("Thursday 10") .signup button[aria-pressed="true"]:text-is("in")');
  const t10 = p2.locator('.team[aria-label="Thursday 10"]');
  assert.match(await t10.locator('.event-roster').innerText(), /Bo \(you\)/, 'Bo is seated');
  assert.match(await t10.locator('.event-quiet').innerText(), /Cy.*Dee|Dee.*Cy/, 'and Cy and Dee haven’t answered');
  assert.equal(await t10.locator('.event button:text("bench")').count(), 0, 'only the maker moves people');
  await p1.reload();
  await p1.click('.tabs button:text("teams")');
  const t10Maker = p1.locator('.team[aria-label="Thursday 10"]');
  await t10Maker.locator('.event-me button:text-is("in")').click();
  await t10Maker.locator('.event-roster :text("Faye")').waitFor();
  assert.match(await t10Maker.locator('.event-roster').innerText(), /Faye \(you\) guild/, 'anyone in the guild can sign up, marked as such');
  // Late, by how much.
  await boLine.locator('.signup button:text-is("late")').click();
  await p2.waitForSelector('.raid-line:has-text("Thursday 10") select[aria-label="How late"]');
  await p2.selectOption('.raid-line:has-text("Thursday 10") select[aria-label="How late"]', '30');
  await p2.waitForSelector('.team[aria-label="Thursday 10"] .event-roster :text("30 min late")');
  // The maker benches Faye for the night, and puts her back.
  await p1.reload();
  await p1.click('.tabs button:text("teams")');
  await t10Maker.locator('.event-person', { hasText: 'Faye' }).locator('button:text("bench")').click();
  await t10Maker.locator('.event-line:has-text("standby") :text("Faye")').waitFor();
  await shot(p1, '06e-signups-phone');
  await t10Maker.locator('.event-person', { hasText: 'Faye' }).locator('button:text("undo bench")').click();
  await t10Maker.locator('.event-roster :text("Faye")').waitFor();
  await shot(p2, '06f-signups-desk');

  // ---- Dated absences: Bo is away for the next four weeks, so every night counts him out ----
  const nyDate = (days) => {
    const d = new Date(Date.now() + days * 86_400_000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
  };
  await p2.click('.tabs button:text("your times")');
  await p2.click('.my-away button:text("add dates away")');
  await p2.fill('.my-away-form input[type="date"] >> nth=0', nyDate(0));
  assert.equal(await p2.locator('.my-away-form input[type="date"]').nth(1).inputValue(), nyDate(0), 'the last night follows the first');
  await p2.fill('.my-away-form input[type="date"] >> nth=1', nyDate(27));
  await p2.fill('.my-away-form .my-away-note input', 'family');
  await p2.click('.my-away-form button:text("save")');
  await p2.waitForSelector('.my-away-list li:has-text("family")');
  // Changing one: the note.
  await p2.click('.my-away-list li button:text("change")');
  await p2.fill('.my-away-form .my-away-note input', 'holidays');
  await p2.click('.my-away-form button:text("save")');
  await p2.waitForSelector('.my-away-list li:has-text("holidays")');
  assert.equal(await p2.locator('.my-away-list li').count(), 1, 'changing keeps one absence');
  // Longer than 60 days is two absences, and the page says so before the Worker does.
  await p2.click('.my-away button:text("add dates away")');
  await p2.fill('.my-away-form input[type="date"] >> nth=0', nyDate(30));
  await p2.fill('.my-away-form input[type="date"] >> nth=1', nyDate(100));
  await p2.click('.my-away-form button:text("save")');
  assert.match(await p2.locator('.my-away .error').innerText(), /at most 60 days/);
  await p2.click('.my-away-form button:text("cancel")');
  await p2.locator('.my-away').screenshot({ path: `${SHOTS}06g-away-desk.png` });

  // The organizer sees him away on a night he hasn't answered, with the note, and not as unanswered.
  await p1.reload();
  await p1.click('.tabs button:text("teams")');
  await t10Maker.locator('.event-nights button').nth(1).click();
  await t10Maker.locator('.event-line:has-text("away")').waitFor();
  assert.match(await t10Maker.locator('.event-line:has-text("away")').innerText(), /Bo\s[\s\S]*holidays/, 'Bo is away, with his note');
  assert.doesNotMatch(await t10Maker.locator('.event-quiet').innerText(), /Bo/, 'and not among those who haven’t answered');
  await shot(p1, '06h-away-phone');
  // On the first night he said late before he went away, and what he said for a night wins.
  await t10Maker.locator('.event-nights button').nth(0).click();
  assert.match(await t10Maker.locator('.event-roster').innerText(), /Bo/, 'an answer for the night wins over the absence');

  // Nobody else sees it: not a browser that isn't signed in, and not the poll's state.
  const outsider = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: 'Europe/Berlin' });
  await outsider.addInitScript(() => localStorage.setItem('muster:tour', 'done'));
  const pub = await outsider.newPage();
  watch(pub, 'outsider');
  await pub.goto(pollUrl);
  await pub.click('.tabs button:text("teams")');
  const t10Pub = pub.locator('.team[aria-label="Thursday 10"]');
  await t10Pub.locator('.event-nights button').nth(1).click();
  await t10Pub.locator('.event-quiet').waitFor();
  assert.equal(await t10Pub.locator('.event-line:has-text("away")').count(), 0, 'no away line for the public');
  assert.doesNotMatch(await pub.locator('body').innerText(), /holidays/, 'nor the note');
  const publicState = await fetch(`${BASE}/api/polls/${pollId}`).then((r) => r.text());
  assert.doesNotMatch(publicState, /holidays|absences/, 'the poll’s state carries no absences');
  assert.deepEqual(await fetch(`${BASE}/api/polls/${pollId}/absences`).then((r) => r.json()), { absences: {} }, 'and asking without signing in gets none');
  await outsider.close();

  // Bo comes back early: signing up for a night inside the absence counts.
  await p2.click('.tabs button:text("teams")');
  const t10Bo = p2.locator('.team[aria-label="Thursday 10"]');
  await t10Bo.locator('.event-nights button').nth(1).click();
  assert.match(await t10Bo.locator('.event-me').innerText(), /away \(holidays\), unless you sign up/, 'Bo is told he counts as away');
  await t10Bo.locator('.event-me button:text-is("in")').click();
  await t10Bo.locator('.event-roster :text("Bo")').waitFor();
  assert.equal(await t10Bo.locator('.event-line:has-text("away")').count(), 0, 'and is no longer away that night');
  await p1.reload();
  await p1.click('.tabs button:text("teams")');
  await t10Maker.locator('.event-nights button').nth(1).click();
  await t10Maker.locator('.event-roster :text("Bo")').waitFor();
  assert.equal(await t10Maker.locator('.event-line:has-text("away")').count(), 0, 'the organizer sees him seated');
  // A phone's view of adding one.
  await p1.click('.tabs button:text("your times")');
  await p1.click('.my-away button:text("add dates away")');
  await p1.locator('.my-away').screenshot({ path: `${SHOTS}06i-away-form-phone.png` });
  await p1.click('.my-away-form button:text("cancel")');
  // And taking it off.
  await p2.click('.tabs button:text("your times")');
  await p2.click('.my-away-list li button:text("remove")');
  await p2.waitForSelector('.my-away-list', { state: 'detached' });
  await p2.click('.tabs button:text("everyone")');

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

  // ---- The organizer tab: helping someone locked out, renaming, closing to new answers ----
  const joinPoll = (body) =>
    fetch(`${BASE}/api/polls/${pollId}/people`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const hal = await (await joinPoll({ name: 'Hal', cls: 'mage', specs: ['frost'], password: 'forgotten' })).json();
  await p1.reload();
  await p1.waitForSelector('.tabs');
  await p1.click('#tab-organizer');
  const halRow = p1.locator('.org-people li', { hasText: 'Hal' });
  assert.match(await halRow.locator('.org-meta').innerText(), /password/, 'the organizer sees who’s locked');
  assert.match(await p1.locator('.organizer').innerText(), /No times yet: .*Hal/, 'and who hasn’t marked times');
  await halRow.locator('.org-person-actions button:text("unlock")').click();
  assert.match(await halRow.locator('.org-do').innerText(), /Take off Hal’s password/);
  await halRow.locator('.org-do button:text("unlock")').click();
  await halRow.locator('.org-person-actions').waitFor();
  assert.doesNotMatch(await halRow.locator('.org-meta').innerText(), /password/, 'unlocked');
  const halSaves = await fetch(`${BASE}/api/polls/${pollId}/people/${hal.person.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${hal.token}` },
    body: JSON.stringify({ note: 'still me?' }),
  });
  assert.equal(halSaves.status, 403, 'unlocking signs them out everywhere');
  assert.equal((await joinPoll({ name: 'Hal', claim: true })).status, 201, 'then they sign back in by name');
  await halRow.locator('button:text("rename")').click();
  await halRow.locator('.org-do input').fill('Halric');
  await halRow.locator('.org-do button:text("rename")').click();
  await p1.locator('.org-name', { hasText: 'Halric' }).waitFor();
  // Closed: no one new, but people who've answered still sign in.
  await p1.click('.org-closed button:text("close to new answers")');
  await p1.locator('.org-status').waitFor();
  const ivy = await joinPoll({ name: 'Ivy', cls: 'rogue', specs: ['combat'] });
  assert.equal(ivy.status, 403, 'a closed poll takes no new answers');
  assert.equal((await ivy.json()).closed, true);
  assert.equal((await joinPoll({ name: 'Halric', claim: true })).status, 201, 'but someone who answered can still sign in');
  await shot(p1, '12-organizer-phone');
  await p1.click('.org-closed button:text("open to new answers")');
  await p1.locator('.org-closed button:text("close to new answers")').waitFor();
  assert.equal((await joinPoll({ name: 'Ivy', cls: 'rogue', specs: ['combat'] })).status, 201, 'opened again');

  // ---- Officers: picked by the maker from people linked to Discord ----
  if (discord) {
    const bo = (await (await fetch(`${BASE}/api/polls/${pollId}`)).json()).people.find((p) => p.name === 'Bo');
    assert.ok(bo.discord, 'Bo is linked to Discord');
    assert.deepEqual(await p1.locator('.org-officers li').count(), 0);
    assert.equal(await p1.locator('select[aria-label="Make an officer"] option').allInnerTexts().then((o) => o.includes('Halric')), false, 'only people linked to Discord can be picked');
    await p1.selectOption('select[aria-label="Make an officer"]', bo.id);
    await p1.click('button:text("make officer")');
    await p1.locator('.org-officers li', { hasText: 'Bo' }).waitFor();
    await shot(p1, '12b-officers-phone');
    // Bo, signed in on their own browser, organizes too: everything but picking officers and deleting.
    await p2.reload();
    await p2.locator('#tab-organizer').click();
    assert.match(await p2.locator('.organizer .hint').first().innerText(), /you’re an officer/);
    assert.equal(await p2.locator('.organizer :text("delete this poll"), .organizer :text("copy private link"), #org-officers').count(), 0, 'officers can’t delete or pick officers');
    await p2.click('.org-closed button:text("close to new answers")');
    await p2.locator('.org-status').waitFor();
    await p2.click('.org-closed button:text("open to new answers")');
    await p2.locator('.org-closed button:text("close to new answers")').waitFor();
    const officerToken = await p2.evaluate((id) => JSON.parse(localStorage.getItem(`muster:poll:${id}`)).admin, pollId);
    const asOfficer = (method, path, body) =>
      fetch(`${BASE}/api/polls/${pollId}${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-admin-token': officerToken },
        body: body && JSON.stringify(body),
      }).then((r) => r.status);
    assert.equal(await asOfficer('DELETE', ''), 403, 'an officer can’t delete the poll');
    assert.equal(await asOfficer('PUT', `/officers/${bo.id}`), 403, 'or pick officers');
    // Stood down: the tab goes, and the token stops working.
    await p1.locator('.org-officers li', { hasText: 'Bo' }).locator('button:text("stand down")').click();
    await p1.locator('.org-officers li').waitFor({ state: 'detached' });
    assert.equal(await asOfficer('PATCH', '', { closed: true }), 403, 'a stood-down officer can’t organize');
    await p2.reload();
    await p2.waitForSelector('.tabs');
    await p2.waitForFunction((id) => !JSON.parse(localStorage.getItem(`muster:poll:${id}`)).admin, pollId);
    assert.equal(await p2.locator('#tab-organizer').count(), 0, 'and the organizer tab goes');
  }

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
  await p5.click('#tab-organizer');
  await p5.click('.org-edit summary');
  await p5.fill('.org-edit #poll-title', 'Launch week raids');
  await p5.click('.org-edit button:text("save changes")');
  await p5.waitForSelector('.org-edit button:text("saved")');
  assert.equal(await p5.locator('h1.title').innerText(), 'Launch week raids', 'editing renames the poll');
  await shot(p5, '11-dates-admin-desk');

  console.log(`ok: ${pollUrl}`);
} finally {
  await browser.close();
  discord?.close();
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
