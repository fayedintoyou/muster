import { ID_PATTERN } from './crypto';
import { auth, error, fromFailure, json } from './http';
import { botReady, discord } from './discord-api';
import { parseCustomId } from '../src/core/card';

// Discord sends slash commands and button presses here as web requests (POST /discord/interactions), so no
// bot program has to keep running. Each request is signed with the app's Ed25519 key, checked against the
// raw body before anything else is read.

const PING = 1;
const COMMAND = 2;
const COMPONENT = 3;
const PONG = 1;
const REPLY = 4;
const UPDATE = 7;
const EPHEMERAL = 64;

function hex(text: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(text)) return null;
  return new Uint8Array(text.match(/../g)!.map((h) => parseInt(h, 16)));
}

async function verified(env: Env, request: Request, body: string): Promise<boolean> {
  const signature = hex(request.headers.get('x-signature-ed25519') ?? '');
  const timestamp = request.headers.get('x-signature-timestamp') ?? '';
  const key = hex(env.DISCORD_PUBLIC_KEY ?? '');
  if (!signature || !timestamp || !key) return false;
  // Discord sends each interaction as it happens; an old one is a replay.
  if (!(Math.abs(Date.now() / 1000 - Number(timestamp)) <= 5 * 60)) return false;
  try {
    const publicKey = await crypto.subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, publicKey, signature, new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

const say = (content: string) => json({ type: REPLY, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });

interface Interaction {
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: { id: string } };
  user?: { id: string };
  data?: { name?: string; custom_id?: string; options?: { name: string; value?: string; options?: { name: string; value?: string }[] }[] };
}

function origin(env: Env, url: URL): string {
  return env.SITE_ORIGIN ?? url.origin;
}

export async function interactions(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'POST') return error(405, 'Method not allowed.');
  const body = await request.text();
  if (!(await verified(env, request, body))) return new Response('Bad signature.', { status: 401 });
  let i: Interaction;
  try {
    i = JSON.parse(body);
  } catch {
    return error(400, 'Expected JSON.');
  }
  if (i.type === PING) return json({ type: PONG });
  const user = i.member?.user?.id ?? i.user?.id;
  if (!user) return say('Something went wrong. Try again.');

  if (i.type === COMMAND && i.data?.name === 'muster') {
    const sub = i.data.options?.[0];
    if (sub?.name !== 'connect') return say('Try `/muster connect` with the code from your poll’s organizer tab.');
    if (!i.guild_id || !i.channel_id) return say('Use this in the server channel where raid posts should go.');
    const code = String(sub.options?.find((o) => o.name === 'code')?.value ?? '').trim();
    const m = code.match(/^([a-z0-9]{8})-([\w-]{12})$/);
    if (!m || !ID_PATTERN.test(m[1])) return say('That doesn’t look like a muster code. Copy it again from the poll’s organizer tab.');
    // Names for the organizer tab. A channel the bot can't see means it can't post there either.
    let guildName = '';
    let channelName = '';
    try {
      const [g, c] = await Promise.all([discord.guild(env, i.guild_id), discord.channel(env, i.channel_id)]);
      guildName = g.name;
      channelName = c.name ?? '';
    } catch {
      return say('muster can’t see this channel. Give the muster role permission to view the channel, send messages and embed links here, then try again.');
    }
    const result = await env.POLLS.getByName(m[1]).botConnect(
      m[2],
      { guild: i.guild_id, guildName, channel: i.channel_id, channelName, by: user },
      origin(env, url),
    );
    if (!result.ok) return say(result.error);
    return json({
      type: REPLY,
      data: {
        content: `Connected: raid posts for **${result.title.replace(/[*_~`|]/g, '')}** go here. Each night’s post goes up ahead of time with sign-up buttons; change when, reminders and who gets pinged on the poll’s organizer tab.`,
        allowed_mentions: { parse: [] },
      },
    });
  }

  if (i.type === COMPONENT && i.data?.custom_id) {
    const parsed = parseCustomId(i.data.custom_id);
    if (!parsed) return say('That button is from an older muster. Open the poll instead.');
    const result = await env.POLLS.getByName(parsed.poll).press(user, parsed.owner, parsed.night, parsed.press);
    if ('card' in result) return json({ type: UPDATE, data: result.card });
    // A reply to a press on someone's own "how late?" row replaces that row.
    const own = parsed.press.startsWith('late') && parsed.press !== 'late' && !result.reply.flags;
    return json({ type: own ? UPDATE : REPLY, data: result.reply });
  }

  return say('muster doesn’t know that one.');
}

/** /api/polls/:id/bot…, for organizers: the code, the settings and roles, posting now, disconnecting. */
export async function botApi(request: Request, env: Env, id: string, rest: string[], body: () => Promise<Record<string, unknown> | Response>): Promise<Response> {
  const poll = env.POLLS.getByName(id);
  const admin = auth(request).admin;
  const method = request.method;
  if (rest.length === 0) {
    if (method === 'GET') {
      const info = await poll.botInfo(admin);
      if (!info.ok) return fromFailure(info);
      let roles: { id: string; name: string }[] = [];
      if (info.link && botReady(env)) {
        try {
          roles = (await discord.roles(env, info.link.guild))
            .filter((r) => !r.managed && r.id !== info.link!.guild)
            .sort((a, b) => b.position - a.position)
            .map((r) => ({ id: r.id, name: r.name }));
        } catch {
          // The roles are a convenience: without them, pings still go to the raid's people.
        }
      }
      return json({ link: info.link, problem: info.problem, roles, ready: botReady(env), invite: invite(env) });
    }
    if (method === 'PUT') {
      const input = await body();
      if (input instanceof Response) return input;
      const result = await poll.botSettings(admin, input);
      return result.ok ? json({ link: result.link }) : fromFailure(result);
    }
    if (method === 'DELETE') {
      const result = await poll.botDisconnect(admin);
      return result.ok ? json({ ok: true }) : fromFailure(result);
    }
    return error(405, 'Method not allowed.');
  }
  if (rest.length === 1 && rest[0] === 'code' && method === 'POST') {
    const result = await poll.botCode(admin);
    return result.ok ? json({ code: result.code }) : fromFailure(result);
  }
  return error(404, 'Not found.');
}

/**
 * Adding the bot to a server: view channels, send messages, embed links, read message history (to edit its
 * own posts), and mention roles that aren't mentionable by everyone.
 */
const PERMISSIONS = (1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 16n) | (1n << 17n);

function invite(env: Env): string {
  const u = new URL('/oauth2/authorize', 'https://discord.com');
  u.search = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    scope: 'bot applications.commands',
    permissions: String(PERMISSIONS),
  }).toString();
  return u.toString();
}
