import { ID_PATTERN, randomToken, signed, unsigned } from './crypto';
import { auth, error, json } from './http';

// Signing in with Discord: OAuth2 with only the `identify` scope, so muster learns someone's Discord id
// and name and nothing else. A person links their account from a browser that's already them in the poll;
// after that, "sign in with Discord" makes any browser them.
//
// The round trip carries a signed state (which poll, which person if linking, a nonce, an expiry), and the
// nonce is also in a short-lived cookie, so a callback only counts in the browser that started it.

const COOKIE = 'muster_discord';
const STATE_MS = 10 * 60_000;

interface State {
  poll: string;
  /** Set when linking: the person to link the account to. */
  person?: string;
  nonce: string;
  exp: number;
}

function origin(env: Env, url: URL): string {
  return env.SITE_ORIGIN ?? url.origin;
}

function redirectUri(env: Env, url: URL): string {
  return `${origin(env, url)}/auth/discord/callback`;
}

/** POST /api/polls/:id/discord with { person? }: where to send the browser, and the cookie for its return. */
export async function discordStart(
  request: Request,
  env: Env,
  url: URL,
  pollId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  if (!env.DISCORD_CLIENT_SECRET) return error(503, 'Discord sign-in isn’t set up here.');
  const poll = env.POLLS.getByName(pollId);
  const person = typeof body.person === 'string' ? body.person : undefined;
  if (person !== undefined) {
    if (!ID_PATTERN.test(person) || !(await poll.owns(person, auth(request).token))) {
      return error(403, 'Sign in as this person to link their Discord account.');
    }
  } else if (!(await poll.summary())) {
    return error(404, 'This poll doesn’t exist.');
  }
  const nonce = randomToken();
  const state = await signed({ poll: pollId, person, nonce, exp: Date.now() + STATE_MS } satisfies State, env.DISCORD_CLIENT_SECRET);
  const authorize = new URL('/oauth2/authorize', env.DISCORD_ORIGIN);
  authorize.search = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(env, url),
    scope: 'identify',
    state,
    // Someone who has already allowed muster goes straight back, without the consent screen again.
    prompt: 'none',
  }).toString();
  const secure = origin(env, url).startsWith('https:') ? '; Secure' : '';
  return json({ url: authorize.toString() }, 200, {
    'set-cookie': `${COOKIE}=${nonce}; Path=/auth/discord; Max-Age=${STATE_MS / 1000}; HttpOnly; SameSite=Lax${secure}`,
  });
}

/** Back to the poll, with the outcome in the hash, where the page reads it and then clears it. */
function back(env: Env, url: URL, pollId: string | null, outcome: Record<string, string>): Response {
  const target = new URL(pollId ? `/e/${pollId}` : '/', origin(env, url));
  target.hash = new URLSearchParams(outcome).toString();
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      'cache-control': 'no-store',
      'set-cookie': `${COOKIE}=; Path=/auth/discord; Max-Age=0; HttpOnly; SameSite=Lax`,
    },
  });
}

/** Who Discord says this is, from the code it sent back. */
async function discordUser(env: Env, url: URL, code: string): Promise<{ id: string; name: string } | null> {
  const api = new URL('/api/v10/', env.DISCORD_ORIGIN);
  const tokenResponse = await fetch(new URL('oauth2/token', api), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${btoa(`${env.DISCORD_CLIENT_ID}:${env.DISCORD_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(env, url) }),
  });
  if (!tokenResponse.ok) return null;
  const { access_token: accessToken } = (await tokenResponse.json()) as { access_token?: string };
  if (!accessToken) return null;
  const me = await fetch(new URL('users/@me', api), { headers: { authorization: `Bearer ${accessToken}` } });
  if (!me.ok) return null;
  const user = (await me.json()) as { id?: string; username?: string; global_name?: string | null };
  if (!user.id || !/^\d{5,25}$/.test(user.id)) return null;
  return { id: user.id, name: (user.global_name || user.username || 'Discord').slice(0, 40) };
}

/** GET /auth/discord/callback?code&state, where Discord sends the browser back. */
export async function discordCallback(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.DISCORD_CLIENT_SECRET) return back(env, url, null, { discord: 'error' });
  const state = await unsigned<State>(url.searchParams.get('state') ?? '', env.DISCORD_CLIENT_SECRET);
  const pollId = state && ID_PATTERN.test(state.poll) ? state.poll : null;
  const nonce = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([\\w-]+)`))?.[1];
  if (!state || !pollId || state.exp < Date.now() || !nonce || nonce !== state.nonce) {
    return back(env, url, pollId, { discord: 'error' });
  }
  // They said no, or closed the consent screen.
  const code = url.searchParams.get('code');
  if (!code) return back(env, url, pollId, { discord: 'cancelled' });
  const user = await discordUser(env, url, code);
  if (!user) return back(env, url, pollId, { discord: 'error' });

  const poll = env.POLLS.getByName(pollId);
  if (state.person) {
    const linked = await poll.linkDiscord(state.person, user);
    return back(env, url, pollId, linked.ok ? { discord: 'linked', as: user.name } : { discord: 'taken' });
  }
  const signedIn = await poll.discordSignIn(user.id);
  return back(
    env,
    url,
    pollId,
    signedIn.ok ? { discord: 'signedin', person: signedIn.personId, token: signedIn.token } : { discord: 'none' },
  );
}
