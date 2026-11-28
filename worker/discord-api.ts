import type { DiscordMessage } from '../src/core/card';

// The bot's side of Discord's REST API, with its own token. Discord limits each channel to about five
// edits every five seconds; on a 429 this waits as long as Discord asks (a few seconds at most) and tries
// once more.

export class DiscordError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function botReady(env: Env): boolean {
  return Boolean(env.DISCORD_BOT_TOKEN);
}

async function call<T>(env: Env, method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const url = new URL(`/api/v10/${path}`, env.DISCORD_ORIGIN);
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'DiscordBot (https://muster.fayelore.com, 1)',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 429 && retry) {
    const wait = Number(((await response.json().catch(() => ({}))) as { retry_after?: number }).retry_after ?? 1);
    await new Promise((resolve) => setTimeout(resolve, Math.min(5, Math.max(0.2, wait)) * 1000));
    return call(env, method, path, body, false);
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { message?: string };
    throw new DiscordError(response.status, detail.message ?? `Discord said ${response.status}.`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const discord = {
  post(env: Env, channel: string, message: DiscordMessage) {
    return call<{ id: string }>(env, 'POST', `channels/${channel}/messages`, message);
  },
  edit(env: Env, channel: string, message: string, body: DiscordMessage) {
    return call<{ id: string }>(env, 'PATCH', `channels/${channel}/messages/${message}`, body);
  },
  async dm(env: Env, user: string, message: DiscordMessage) {
    const channel = await call<{ id: string }>(env, 'POST', 'users/@me/channels', { recipient_id: user });
    return call<{ id: string }>(env, 'POST', `channels/${channel.id}/messages`, message);
  },
  channel(env: Env, channel: string) {
    return call<{ id: string; name?: string; guild_id?: string }>(env, 'GET', `channels/${channel}`);
  },
  guild(env: Env, guild: string) {
    return call<{ id: string; name: string }>(env, 'GET', `guilds/${guild}`);
  },
  roles(env: Env, guild: string) {
    return call<{ id: string; name: string; managed?: boolean; position: number }[]>(env, 'GET', `guilds/${guild}/roles`);
  },
};
