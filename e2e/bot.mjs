// End-to-end run of the Discord bot against `wrangler dev`, with a stand-in for Discord: it signs
// interactions with its own Ed25519 key, the way Discord does, and records every post, edit and private
// message the bot sends. An organizer connects a channel with a code, raid nights post with sign-up buttons
// and pings, taps sign people up, the web and the card stay in step, and changes are announced. The
// organizer tab's Discord section is checked in Chrome. Screenshots go to e2e/shots/.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const POLL_RAID = 'raid';
import { chromium } from 'playwright-core';

const CHROME =
  process.env.CHROME ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome');
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const GUILD = '900000000000000001';
const CHANNEL = '900000000000000002';
const ROLE = '900000000000000003';
const ANA = '100000000000000001';
const BO = '100000000000000002';
const CY = '100000000000000003';
const STRANGER = '100000000000000009';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUBLIC_HEX = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');

// ---- The stand-in for Discord ----
const sent = []; // { method, path, body }
let discordUser = null;
let nextMessage = 1;
const deleted = new Set(); // posts someone deleted in Discord: editing them is a 404
const fake = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const reply = (status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    const path = url.pathname.replace('/api/v10/', '');
    // OAuth2, for linking people the way the page does.
    if (url.pathname === '/oauth2/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', discordUser.id);
      back.searchParams.set('state', url.searchParams.get('state'));
      return res.writeHead(302, { location: back.toString() }).end();
    }
    if (path === 'oauth2/token') return reply(200, { access_token: `at-${new URLSearchParams(raw).get('code')}` });
    if (path === 'users/@me') return reply(200, { ...discordUser, id: req.headers.authorization.replace('Bearer at-', '') });
    // The bot's own calls.
    assert.equal(req.headers.authorization, 'Bot e2e-bot-token', `the bot uses its token for ${path}`);
    const body = raw ? JSON.parse(raw) : undefined;
    sent.push({ method: req.method, path, body });
    if (path === `guilds/${GUILD}`) return reply(200, { id: GUILD, name: 'Lamplight' });
    if (path === `channels/${CHANNEL}`) return reply(200, { id: CHANNEL, name: 'raids', guild_id: GUILD });
    if (path === `guilds/${GUILD}/roles`) {
      return reply(200, [
        { id: GUILD, name: '@everyone', position: 0 },
        { id: ROLE, name: 'Thursday 10', position: 2 },
        { id: '900000000000000004', name: 'muster', managed: true, position: 1 },
      ]);
    }
    if (path === 'users/@me/channels') return reply(200, { id: `dm-${body.recipient_id}` });
    if (req.method === 'POST' && /^channels\/[\w-]+\/messages$/.test(path)) return reply(200, { id: `m${nextMessage++}` });
    if (req.method === 'PATCH' && deleted.has(path.split('/').pop())) return reply(404, { message: 'Unknown Message', code: 10008 });
    if (req.method === 'PATCH') return reply(200, { id: path.split('/').pop() });
    reply(404, { message: 'Unknown' });
  });
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));

const store = mkdtempSync(join(tmpdir(), 'muster-bot-e2e-'));
const port = 9000 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${port}`;
const vars = {
  DISCORD_ORIGIN: `http://127.0.0.1:${fake.address().port}`,
  DISCORD_CLIENT_SECRET: 'e2e-secret',
  DISCORD_BOT_TOKEN: 'e2e-bot-token',
  DISCORD_PUBLIC_KEY: PUBLIC_HEX,
  SITE_ORIGIN: BASE,
};
const server = spawn(
  'npx',
  ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', store, ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])],
  { env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
);
let logs = '';
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('wrangler dev did not start')), 60_000);
  const onData = (d) => {
    logs += d;
    if (String(d).includes('Ready on')) {
      clearTimeout(timer);
      resolve();
    }
  };
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
});

// ---- Helpers ----
const api = async (method, path, body, headers = {}) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text}`);
  return json;
};

/** An interaction, signed with the stand-in's key as Discord signs them. */
async function interact(payload, { badSignature = false, at = Date.now() } = {}) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(at / 1000));
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
  const r = await fetch(`${BASE}/discord/interactions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature-ed25519': badSignature ? signature.replace(/^./, (c) => (c === '0' ? '1' : '0')) : signature,
      'x-signature-timestamp': timestamp,
    },
    body,
  });
  return { status: r.status, body: r.status === 200 ? await r.json() : await r.text() };
}
const press = (user, customId) =>
  interact({ type: 3, guild_id: GUILD, channel_id: CHANNEL, member: { user: { id: user } }, data: { custom_id: customId, component_type: 2 } });

/** Waits for the bot to send something matching, from `after` on in the record. */
async function waitFor(what, test, after = 0, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const hit = sent.slice(after).find(test);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`the bot never sent ${what}.\nSent: ${JSON.stringify(sent.map((s) => `${s.method} ${s.path}`))}\n${logs.slice(-3000)}`);
}
const embedText = (m) => JSON.stringify(m.body?.embeds ?? m.embeds ?? []);
const buttonsOf = (body) => body.components.flatMap((row) => row.components);

/** Links a new person to a Discord account the way the page does: sign in with Discord, then answer. */
async function joinLinked(pollId, user, who) {
  discordUser = { id: user, username: who.name.toLowerCase(), global_name: who.name };
  const start = await fetch(`${BASE}/api/polls/${pollId}/discord`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const { url } = await start.json();
  const toCallback = await fetch(url, { redirect: 'manual' });
  const back = await fetch(toCallback.headers.get('location'), { redirect: 'manual', headers: { cookie } });
  const hash = new URLSearchParams(new URL(back.headers.get('location')).hash.slice(1));
  assert.equal(hash.get('discord'), 'none', 'not in the poll yet');
  return api('POST', `/api/polls/${pollId}/people`, { ...who, discordTicket: hash.get('ticket') });
}

// Dates in the realm's time: a night tomorrow at 8pm, and one starting about an hour from now.
const TZ = 'America/Chicago';
const local = (instant) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
};
const now = Date.now();
const days = [0, 1, 2].map((d) => local(now + d * 86_400_000).date);
const tomorrow = days[1];
const soon = local(now + 75 * 60_000);
const soonSlot = `${soon.date}/${soon.minute - (soon.minute % 15)}`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
  // ---- A poll, three people linked to Discord and one who isn't ----
  const { id: pollId, admin } = await api('POST', '/api/polls', {
    title: 'Barrow Deeps',
    mode: 'dates',
    days,
    start: 0,
    end: 0,
    slot: 15,
    tz: TZ,
    realm: TZ,
    roles: ['tank', 'healer', 'dps'],
    classes: ['warrior', 'priest', 'mage', 'rogue'],
    size: 10,
    makeup: { tank: 2, healer: 3 },
  });
  const adminHeaders = { 'x-admin-token': admin };
  const ana = await joinLinked(pollId, ANA, { name: 'Ana', cls: 'warrior', specs: ['protection'] });
  const bo = await joinLinked(pollId, BO, { name: 'Bo', cls: 'priest', specs: ['holy'] });
  const cy = await joinLinked(pollId, CY, { name: 'Cy', cls: 'mage', specs: ['frost'] });
  const dee = await api('POST', `/api/polls/${pollId}/people`, { name: 'Dee', cls: 'rogue', specs: ['combat'] });

  // ---- Discord's checks: a bad signature is turned away, a PING answered ----
  assert.equal((await interact({ type: 1 }, { badSignature: true })).status, 401, 'a bad signature is refused');
  assert.equal((await interact({ type: 1 }, { at: Date.now() - 3_600_000 })).status, 401, 'an old one, replayed, is refused');
  assert.deepEqual((await interact({ type: 1 })).body, { type: 1 }, 'PING gets PONG');

  // ---- Connecting: the organizer gets a code, and /muster connect in the channel uses it ----
  const before = await api('GET', `/api/polls/${pollId}/bot`, undefined, adminHeaders);
  assert.equal(before.link, null, 'not connected yet');
  assert.match(before.invite, /scope=bot\+applications\.commands/, 'an invite to add the bot');
  await assert.rejects(api('GET', `/api/polls/${pollId}/bot`), /403/, 'only organizers see the settings');
  const { code } = await api('POST', `/api/polls/${pollId}/bot/code`, undefined, adminHeaders);
  const connect = (c) =>
    interact({
      type: 2,
      guild_id: GUILD,
      channel_id: CHANNEL,
      member: { user: { id: ANA } },
      data: { name: 'muster', options: [{ type: 1, name: 'connect', options: [{ type: 3, name: 'code', value: c }] }] },
    });
  const wrong = await connect(`${pollId}-xxxxxxxxxxxx`);
  assert.match(wrong.body.data.content, /expired or was already used/, 'a wrong code is refused');
  assert.equal(wrong.body.data.flags, 64, 'privately');
  const connected = await connect(code);
  assert.match(connected.body.data.content, /Connected: raid posts for \*\*Barrow Deeps\*\* go here/);
  assert.match((await connect(code)).body.data.content, /already used/, 'a code works once');
  const info = await api('GET', `/api/polls/${pollId}/bot`, undefined, adminHeaders);
  assert.equal(info.link.channelName, 'raids');
  assert.equal(info.link.guildName, 'Lamplight');
  assert.deepEqual(info.roles, [{ id: ROLE, name: 'Thursday 10' }], 'roles to ping, without @everyone or the bot’s own');

  // ---- A team that pings its role, and its raid tomorrow: posted at once, inside the 6-day lead ----
  let state = await api('POST', `/api/polls/${pollId}/teams`, { name: 'Thursday 10', members: [ana.person.id, bo.person.id], size: 10, makeup: { tank: 2, healer: 3 } }, adminHeaders);
  const team = state.teams[0];
  await api('PUT', `/api/polls/${pollId}/bot`, { pings: { [team.id]: ROLE } }, adminHeaders);
  let mark = sent.length;
  await api('PUT', `/api/polls/${pollId}/teams/${team.id}/raid`, { start: `${tomorrow}/1200`, minutes: 180 }, adminHeaders);
  const teamPost = await waitFor('the team’s raid post', (m) => m.method === 'POST' && m.path === `channels/${CHANNEL}/messages` && embedText(m).includes('Thursday 10'), mark);
  assert.equal(teamPost.body.content, `<@&${ROLE}>`, 'the new post pings the team’s role');
  assert.deepEqual(teamPost.body.allowed_mentions, { roles: [ROLE] }, 'and only that role');
  const teamButtons = buttonsOf(teamPost.body);
  assert.deepEqual(teamButtons.map((b) => b.label), ['in', 'late', 'maybe', 'out', 'muster', 'change spec', 'on my alt']);
  assert.match(embedText(teamPost), /<t:\d+:F>/, 'times as Discord timestamps');
  assert.match(embedText(teamPost), /8–11pm server time/, 'and in server time');
  const teamMessage = `m${nextMessage - 1}`;
  const button = (label) => teamButtons.find((b) => b.label === label).custom_id;

  // ---- The poll's own raid, which pings everyone here linked to Discord ----
  mark = sent.length;
  await api('PUT', `/api/polls/${pollId}/raid`, { start: `${tomorrow}/1140`, minutes: 120 }, adminHeaders);
  const pollPost = await waitFor('the poll raid’s post', (m) => m.method === 'POST' && embedText(m).includes('Barrow Deeps'), mark);
  assert.deepEqual(pollPost.body.allowed_mentions.users.sort(), [ANA, BO, CY], 'each linked person, by mention');
  assert.equal((await api('GET', `/api/polls/${pollId}`)).signups[`raid/${tomorrow}`], undefined, 'posting signs no one up');

  // ---- Taps: in, late with how late, someone muster doesn't know ----
  const anaIn = await press(ANA, button('in'));
  assert.equal(anaIn.body.type, 7, 'a tap edits the card in place');
  assert.match(embedText(anaIn.body.data), /Tanks 1\/2.*Ana · warrior/, 'Ana is seated as a tank');
  state = await api('GET', `/api/polls/${pollId}`);
  assert.equal(state.signups[`${team.id}/${tomorrow}`].people[ana.person.id].status, 'in', 'the page sees the tap');

  const boLate = await press(BO, button('late'));
  assert.equal(boLate.body.type, 4);
  assert.equal(boLate.body.data.flags, 64, 'how late is asked privately');
  const steps = buttonsOf(boLate.body.data);
  assert.deepEqual(steps.map((b) => b.label), ['15 min', '30 min', '45 min', '1 hour', '1.5 hours']);
  mark = sent.length;
  const boThirty = await press(BO, steps[1].custom_id);
  assert.equal(boThirty.body.type, 7, 'the private row is replaced');
  assert.match(boThirty.body.data.content, /30 minutes late/);
  const edited = await waitFor('the card edited for Bo', (m) => m.method === 'PATCH' && m.path === `channels/${CHANNEL}/messages/${teamMessage}` && embedText(m).includes('Bo'), mark);
  assert.match(embedText(edited), /Bo · priest \(30m late\)/, 'the card shows Bo, late');

  const stranger = await press(STRANGER, button('in'));
  assert.equal(stranger.body.data.flags, 64);
  assert.match(stranger.body.data.content, /doesn’t know your Discord account/, 'someone not linked is told how to link');
  assert.equal(buttonsOf(stranger.body.data)[0].url, `${BASE}/e/${pollId}`);

  // ---- The web and the card stay in step: Cy signs up on the page ----
  mark = sent.length;
  await api('PUT', `/api/polls/${pollId}/signups/${team.id}/${tomorrow}/${cy.person.id}`, { status: 'in' }, { authorization: `Bearer ${cy.token}` });
  await waitFor('the card edited for Cy', (m) => m.method === 'PATCH' && m.path.endsWith(teamMessage) && embedText(m).includes('Cy · mage'), mark);

  // ---- An organizer benches Cy: Cy hears privately ----
  mark = sent.length;
  await api('PUT', `/api/polls/${pollId}/moves/${team.id}/${tomorrow}/${cy.person.id}`, { move: 'bench' }, adminHeaders);
  const dm = await waitFor('a private message to Cy', (m) => m.path === `channels/dm-${CY}/messages`, mark);
  assert.match(dm.body.content, /on standby for \*\*Thursday 10/);
  await waitFor('the card showing Cy on standby', (m) => m.method === 'PATCH' && m.path.endsWith(teamMessage) && /Standby 1/.test(embedText(m)), mark);

  // ---- A raid within the hour: a reminder to those coming, and a private nudge to who hasn't answered ----
  state = await api('POST', `/api/polls/${pollId}/teams`, { name: 'Alt run', members: [ana.person.id, bo.person.id, cy.person.id, dee.person.id], size: 10, makeup: {} }, adminHeaders);
  // Cy is away these days, so isn't nudged.
  await api('PUT', `/api/polls/${pollId}/people/${cy.person.id}/absences`, { absences: [{ from: days[0], to: days[2], note: '' }] }, { authorization: `Bearer ${cy.token}` });
  const alt = state.teams.find((t) => t.name === 'Alt run');
  await api('PUT', `/api/polls/${pollId}/bot`, { pings: { [alt.id]: 'none' } }, adminHeaders);
  mark = sent.length;
  await api('PUT', `/api/polls/${pollId}/teams/${alt.id}/raid`, { start: soonSlot, minutes: 60 }, adminHeaders);
  const altPost = await waitFor('the alt run’s post', (m) => m.method === 'POST' && embedText(m).includes('Alt run'), mark);
  assert.equal(altPost.body.content, undefined, 'a raid set to ping no one pings no one');
  assert.deepEqual(altPost.body.allowed_mentions, { parse: [] });
  await press(ANA, buttonsOf(altPost.body).find((b) => b.label === 'in').custom_id);
  mark = sent.length;
  await api('PUT', `/api/polls/${pollId}/bot`, { remind: 120, nudge: 12 }, adminHeaders);
  const reminder = await waitFor('the reminder', (m) => m.method === 'POST' && /Alt run.*starts <t:\d+:R>/.test(m.body?.content ?? ''), mark);
  assert.deepEqual(reminder.body.allowed_mentions, { users: [ANA] }, 'the reminder pings only those coming');
  const nudge = await waitFor('a nudge to Bo', (m) => m.path === `channels/dm-${BO}/messages` && /Alt run/.test(m.body?.content ?? ''), mark);
  assert.match(nudge.body.content, /Coming\?/);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(sent.slice(mark).filter((m) => /starts <t:/.test(m.body?.content ?? '')).length, 1, 'one reminder, not one per alarm');
  assert.equal(sent.slice(mark).filter((m) => m.path === `channels/dm-${ANA}/messages`).length, 0, 'no nudge for someone who answered');
  assert.equal(sent.slice(mark).filter((m) => m.path === `channels/dm-${CY}/messages`).length, 0, 'no nudge for someone away');
  assert.equal(sent.slice(mark).filter((m) => m.path.includes('dm-') && m.path.includes('Dee')).length, 0, 'Dee isn’t on Discord');

  // ---- Calling a night off, moving a raid, and unlocking one: cards change and people are told ----
  mark = sent.length;
  await api('PUT', `/api/polls/${pollId}/teams/${team.id}/raid`, { start: `${tomorrow}/1200`, minutes: 180, skips: [tomorrow] }, adminHeaders);
  await waitFor('the called-off card', (m) => m.method === 'PATCH' && m.path.endsWith(teamMessage) && /Called off/.test(embedText(m)), mark);
  const off = await waitFor('the called-off notice', (m) => m.method === 'POST' && /is called off/.test(m.body?.content ?? ''), mark);
  assert.deepEqual(off.body.allowed_mentions.users.sort(), [ANA, BO, CY], 'everyone signed up hears, standby too, by name rather than the role');

  await press(BO, pollPost.body.components[0].components[0].custom_id);
  mark = sent.length;
  await api('PUT', `/api/polls/${pollId}/raid`, { start: `${tomorrow}/1170`, minutes: 120 }, adminHeaders);
  const moved = await waitFor('the moved notice', (m) => m.method === 'POST' && /has moved/.test(m.body?.content ?? ''), mark);
  assert.deepEqual(moved.body.allowed_mentions, { users: [BO] });

  mark = sent.length;
  await api('DELETE', `/api/polls/${pollId}/teams/${alt.id}/raid`, undefined, adminHeaders);
  await waitFor('the unlocked card', (m) => m.method === 'PATCH' && /Moved: Alt run/.test(embedText(m)), mark);
  await waitFor('the unlocked notice', (m) => m.method === 'POST' && /Alt run.*no longer on/.test(m.body?.content ?? ''), mark);

  // ---- Change spec for a night: Bo, a holy priest, plays shadow ----
  const pollButton = (label) => buttonsOf(pollPost.body).find((b) => b.label === label).custom_id;
  const specs = await press(BO, pollButton('change spec'));
  assert.equal(specs.body.data.flags, 64, 'which spec is asked privately');
  assert.deepEqual(buttonsOf(specs.body.data).map((b) => b.label), ['discipline', 'holy', 'shadow', 'my usual'], 'the priest’s specs');
  mark = sent.length;
  const shadow = await press(BO, buttonsOf(specs.body.data)[2].custom_id);
  assert.equal(shadow.body.type, 7, 'the private row is replaced');
  assert.match(shadow.body.data.content, /in on your main, shadow priest/);
  const shadowCard = await waitFor('the card with Bo as shadow', (m) => m.method === 'PATCH' && embedText(m).includes('Barrow Deeps') && embedText(m).includes('shadow'), mark);
  assert.match(embedText(shadowCard), /DPS 1\/5[^}]*Bo · shadow priest/, 'Bo is seated as dps for the night');
  state = await api('GET', `/api/polls/${pollId}`);
  assert.deepEqual(state.signups[`raid/${tomorrow}`].people[bo.person.id].specs, ['shadow'], 'the page sees the spec');

  // ---- On an alt: Ana has none, adds one on the page, then picks it ----
  const noAlt = await press(ANA, pollButton('on my alt'));
  assert.match(noAlt.body.data.content, /haven’t added an alt/, 'no alts yet: told where to add one');
  const saved = await api('PUT', `/api/polls/${pollId}/people/${ana.person.id}`, { alts: [{ name: 'Anabel', cls: 'priest', specs: ['holy'] }] }, { authorization: `Bearer ${ana.token}` });
  const anabel = saved.person.alts[0];
  assert.match(anabel.id, /^[a-z0-9]{4}$/, 'the alt gets an id');
  assert.deepEqual(anabel.roles, ['healer'], 'and roles from its spec');
  const which = await press(ANA, pollButton('on my alt'));
  assert.deepEqual(buttonsOf(which.body.data).map((b) => b.label), ['Anabel · priest', 'Ana (main)']);
  mark = sent.length;
  const onAlt = await press(ANA, buttonsOf(which.body.data)[0].custom_id);
  assert.match(onAlt.body.data.content, /in on Anabel, holy priest/, 'picking an alt signs Ana in on it');
  const altCard = await waitFor('the card with Anabel', (m) => m.method === 'PATCH' && embedText(m).includes('Barrow Deeps') && embedText(m).includes('Anabel'), mark);
  assert.match(embedText(altCard), /Healers 1\/3[^}]*Anabel \(Ana\) · priest/, 'Anabel heals, and the card says whose she is');
  await assert.rejects(
    api('PUT', `/api/polls/${pollId}/signups/${POLL_RAID}/${tomorrow}/${cy.person.id}`, { status: 'in', as: 'zzzz' }, { authorization: `Bearer ${cy.token}` }),
    /400/,
    'an alt that isn’t yours is refused',
  );

  // Ana removes the alt: what she says next is on her main, and "out" still works.
  await api('PUT', `/api/polls/${pollId}/people/${ana.person.id}`, { alts: [] }, { authorization: `Bearer ${ana.token}` });
  assert.equal((await press(ANA, pollButton('out'))).body.type, 7, 'out, after the alt she was on is gone');
  state = await api('GET', `/api/polls/${pollId}`);
  assert.equal(state.signups[`raid/${tomorrow}`].people[ana.person.id].status, 'out');
  assert.equal(state.signups[`raid/${tomorrow}`].people[ana.person.id].as, undefined, 'and back on her main');

  // ---- Team only: a closed run turns away anyone not on it ----
  state = await api('POST', `/api/polls/${pollId}/teams`, { name: 'Closed run', members: [ana.person.id], size: 10, makeup: {}, closed: true }, adminHeaders);
  const closed = state.teams.find((t) => t.name === 'Closed run');
  assert.equal(closed.closed, true);
  mark = sent.length;
  await api('PUT', `/api/polls/${pollId}/teams/${closed.id}/raid`, { start: `${days[2]}/1200`, minutes: 120 }, adminHeaders);
  const closedPost = await waitFor('the closed run’s post', (m) => m.method === 'POST' && embedText(m).includes('Closed run'), mark);
  assert.deepEqual(closedPost.body.allowed_mentions, { users: [ANA] }, 'it pings only its own people');
  const boClosed = await press(BO, buttonsOf(closedPost.body).find((b) => b.label === 'in').custom_id);
  assert.equal(boClosed.body.data.flags, 64);
  assert.match(boClosed.body.data.content, /team only, and Bo isn’t on Closed run/, 'Bo is turned away');
  await assert.rejects(
    api('PUT', `/api/polls/${pollId}/signups/${closed.id}/${days[2]}/${bo.person.id}`, { status: 'in' }, { authorization: `Bearer ${bo.token}` }),
    /403/,
    'on the page too',
  );
  assert.equal((await press(ANA, buttonsOf(closedPost.body).find((b) => b.label === 'in').custom_id)).body.type, 7, 'its own people sign up');

  // ---- /muster event: a one-off pug night, made in the channel, posted at once ----
  const makeEvent = (options) =>
    interact({
      type: 2,
      guild_id: GUILD,
      channel_id: CHANNEL,
      member: { user: { id: ANA } },
      data: { name: 'muster', options: [{ type: 1, name: 'event', options: Object.entries(options).map(([name, value]) => ({ name, value })) }] },
    });
  assert.match((await makeEvent({ name: 'Pug night', date: 'someday', time: '9pm' })).body.data.content, /can’t read “someday” as a date/);
  assert.match((await makeEvent({ name: 'Pug night', date: 'saturn', time: '9pm' })).body.data.content, /can’t read “saturn” as a date/, 'only real day names');
  assert.match((await makeEvent({ name: 'Pug night', date: days[2], time: 'nine' })).body.data.content, /can’t read “nine” as a time/);
  assert.match((await makeEvent({ name: 'Pug night', date: days[2], time: '9pm', team: 'Nope' })).body.data.content, /no team called “Nope”/);
  mark = sent.length;
  const made = await makeEvent({ name: 'Pug night', date: days[2], time: '9pm', length: 120, size: 10, note: 'Bring fire resistance' });
  assert.equal(made.body.data.flags, 64, 'the maker hears privately');
  assert.match(made.body.data.content, /Made \*\*Pug night\*\* for <t:\d+:F>/);
  const eventPost = await waitFor('the event’s post', (m) => m.method === 'POST' && embedText(m).includes('Pug night'), mark);
  assert.match(embedText(eventPost), /9–11pm server time/, 'at 9pm server time, for two hours');
  assert.match(embedText(eventPost), /Open to the guild\\nBring fire resistance/, 'who it’s for, and the note');
  assert.deepEqual(eventPost.body.allowed_mentions.users.sort(), [ANA, BO, CY], 'a guild event pings as the guild’s raid does');
  state = await api('GET', `/api/polls/${pollId}`);
  const pug = state.events.find((o) => o.name === 'Pug night');
  assert.equal(pug.size, 10);
  assert.equal(pug.note, 'Bring fire resistance');
  const cyIn = await press(CY, buttonsOf(eventPost.body).find((b) => b.label === 'in').custom_id);
  assert.match(embedText(cyIn.body.data), /Cy · mage/, 'a tap signs up for the event');
  // The organizer calls it off on the page: the post changes and Cy hears.
  mark = sent.length;
  await api('PUT', `/api/polls/${pollId}/events/${pug.id}`, { ...pug, off: true }, adminHeaders);
  await waitFor('the called-off event', (m) => m.method === 'PATCH' && /Called off: Pug night/.test(embedText(m)), mark);
  const pugOff = await waitFor('the event’s called-off notice', (m) => m.method === 'POST' && /Pug night.*is called off/.test(m.body?.content ?? ''), mark);
  assert.deepEqual(pugOff.body.allowed_mentions, { users: [CY] });

  // ---- A night under way, or over, isn't "no longer on" when it leaves the coming nights ----
  state = await api('POST', `/api/polls/${pollId}/teams`, { name: 'Late run', members: [ana.person.id], size: 10, makeup: {} }, adminHeaders);
  const lateRun = state.teams.find((t) => t.name === 'Late run');
  const started = local(Date.now());
  mark = sent.length;
  await api('PUT', `/api/polls/${pollId}/teams/${lateRun.id}/raid`, { start: `${started.date}/${started.minute - (started.minute % 15)}`, minutes: 60 }, adminHeaders);
  const latePost = await waitFor('the late run’s post', (m) => m.method === 'POST' && embedText(m).includes('Late run'), mark);
  await press(ANA, buttonsOf(latePost.body).find((b) => b.label === 'in').custom_id);
  mark = sent.length;
  await api('DELETE', `/api/polls/${pollId}/teams/${lateRun.id}/raid`, undefined, adminHeaders);
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(sent.slice(mark).filter((m) => /Late run.*no longer on/.test(m.body?.content ?? '')).length, 0, 'no notice for a night already under way');

  // ---- One post deleted in Discord doesn't hold up the rest, and is left alone after ----
  deleted.add(teamMessage);
  mark = sent.length;
  state = await api('POST', `/api/polls/${pollId}/teams`, { name: 'Friday 10', members: [ana.person.id, cy.person.id], size: 10, makeup: {} }, adminHeaders);
  const friday = state.teams.find((t) => t.name === 'Friday 10');
  // A new team edits every card, the deleted one before Friday's is posted.
  await api('PUT', `/api/polls/${pollId}/teams/${friday.id}/raid`, { start: `${days[2]}/1200`, minutes: 120 }, adminHeaders);
  await waitFor('the Friday post, past the deleted card', (m) => m.method === 'POST' && embedText(m).includes('Friday 10'), mark);
  const fridayMessage = `m${nextMessage - 1}`;
  await waitFor('a try at the deleted card', (m) => m.method === 'PATCH' && m.path.endsWith(`/${teamMessage}`), mark);
  mark = sent.length;
  await api('POST', `/api/polls/${pollId}/teams`, { name: 'Spare', members: [], size: 10, makeup: {} }, adminHeaders);
  await waitFor('the other cards edited', (m) => m.method === 'PATCH' && m.path.endsWith(`/${fridayMessage}`), mark);
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(sent.slice(mark).filter((m) => m.path.endsWith(`/${teamMessage}`)).length, 0, 'the deleted post isn’t tried again');
  assert.equal((await api('GET', `/api/polls/${pollId}/bot`, undefined, adminHeaders)).problem, null, 'and the bot isn’t stuck on it');

  // ---- The organizer tab, connected and not, on a phone and a desktop ----
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1280, height: 900 }],
  ]) {
    const context = await browser.newContext({ viewport, timezoneId: TZ, deviceScaleFactor: 2 });
    await context.addInitScript(() => localStorage.setItem('muster:tour', 'done'));
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/e/${pollId}#admin=${admin}`);
    await page.click('.tabs button:text("organizer")');
    await page.waitForSelector('.org-discord .org-bot');
    assert.match(await page.locator('.org-discord').innerText(), /Raid posts go to #raids in Lamplight/);
    const ping = page.locator('.org-discord label', { hasText: 'New posts for Thursday 10 ping' }).locator('select');
    assert.equal(await ping.inputValue(), ROLE, 'the team’s role is picked');
    await page.locator('.org-discord').scrollIntoViewIfNeeded();
    await page.locator('.org-discord').screenshot({ path: `${SHOTS}bot-connected-${name}.png` });

    const { id: freshId, admin: freshAdmin } = await api('POST', '/api/polls', { title: 'Onyxia', mode: 'weekly', days: ['w4'], start: 1200, end: 1380, slot: 30, tz: TZ });
    await page.goto(`${BASE}/e/${freshId}#admin=${freshAdmin}`);
    await page.click('.tabs button:text("organizer")');
    await page.click('.org-discord button:text("get a code to connect a channel")');
    const command = await page.locator('.org-command code').innerText();
    assert.match(command, new RegExp(`^/muster connect code:${freshId}-[\\w-]{12}$`), 'the command to send in Discord');
    await page.locator('.org-discord').screenshot({ path: `${SHOTS}bot-connect-${name}.png` });
    if (name === 'phone') {
      // Sending it in Discord: the tab notices on its own.
      const fresh = await connect(command.replace('/muster connect code:', ''));
      assert.match(fresh.body.data.content, /Onyxia/);
      await page.waitForSelector('.org-discord .org-bot', { timeout: 10_000 });
    }
    assert.deepEqual(errors, [], `no page errors on the ${name}`);
    await context.close();
  }

  console.log('bot e2e: all checks passed');
} finally {
  await browser.close();
  fake.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
  rmSync(store, { recursive: true, force: true });
}
