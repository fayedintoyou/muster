import { PollObject, type Failure } from './poll-object';
import { ID_PATTERN, randomId, randomToken, sha256 } from './crypto';
import { validateSettings } from '../src/core/validate';
import { describePoll } from './describe';

export { PollObject };

const MAX_BODY = 64 * 1024;

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function error(status: number, message: string, extra: object = {}): Response {
  return json({ error: message, ...extra }, status);
}

function fromFailure(f: Failure): Response {
  const { ok: _ok, status, error: message, ...extra } = f;
  return error(status, message, extra);
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY) return error(413, 'That request is too large.');
  const text = await request.text();
  if (text.length > MAX_BODY) return error(413, 'That request is too large.');
  try {
    const body = JSON.parse(text || '{}');
    return body && typeof body === 'object' && !Array.isArray(body) ? body : error(400, 'Expected a JSON object.');
  } catch {
    return error(400, 'Expected JSON.');
  }
}

function auth(request: Request) {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  return { token: bearer ?? undefined, admin: request.headers.get('x-admin-token') ?? undefined };
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'polls', id?, 'people'?, personId?]
  if (parts[1] !== 'polls') return error(404, 'Not found.');
  const method = request.method;

  if (parts.length === 2) {
    if (method !== 'POST') return error(405, 'Method not allowed.');
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const settings = validateSettings(body);
    if (!settings.ok) return error(400, settings.error);
    const admin = randomToken();
    const adminHash = await sha256(admin);
    for (let attempt = 0; attempt < 4; attempt++) {
      const id = randomId();
      if (await env.POLLS.getByName(id).create(id, settings.value, adminHash)) {
        return json({ id, admin }, 201);
      }
    }
    return error(503, 'Couldn’t find a free address for the poll. Try again.');
  }

  const id = parts[2];
  if (!ID_PATTERN.test(id)) return error(404, 'This poll doesn’t exist.');
  const poll = env.POLLS.getByName(id);

  if (parts.length === 3) {
    if (method === 'GET') {
      const since = url.searchParams.has('since') ? Number(url.searchParams.get('since')) : undefined;
      const state = await poll.read(Number.isFinite(since) ? since : undefined);
      if (state === 'unchanged') return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
      return state ? json(state) : error(404, 'This poll doesn’t exist.');
    }
    if (method === 'PATCH') {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      const result = await poll.update(auth(request).admin, body);
      return result.ok ? json(result.state) : fromFailure(result);
    }
    if (method === 'DELETE') {
      const result = await poll.destroy(auth(request).admin);
      return result.ok ? json({ ok: true }) : fromFailure(result);
    }
    return error(405, 'Method not allowed.');
  }

  if (parts[3] !== 'people') return error(404, 'Not found.');

  if (parts.length === 4) {
    if (method !== 'POST') return error(405, 'Method not allowed.');
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const result = await poll.join(body);
    return result.ok ? json({ person: result.person, token: result.token, state: result.state }, 201) : fromFailure(result);
  }

  const personId = parts[4];
  if (parts.length !== 5 || !ID_PATTERN.test(personId)) return error(404, 'Not found.');
  if (method === 'PUT') {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const result = await poll.save(personId, auth(request), body);
    return result.ok ? json({ person: result.person, version: result.version }) : fromFailure(result);
  }
  if (method === 'DELETE') {
    const result = await poll.removePerson(personId, auth(request));
    return result.ok ? json({ version: result.version }) : fromFailure(result);
  }
  return error(405, 'Method not allowed.');
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A poll's page: the app's own HTML, with the poll's name and times in its tags so the link unfurls
 *  in Discord (and anywhere else) as something worth clicking. */
async function pollPage(request: Request, env: Env, url: URL): Promise<Response> {
  const shell = await env.ASSETS.fetch(new Request(new URL('/', url), request));
  const id = url.pathname.split('/')[2] ?? '';
  const summary = ID_PATTERN.test(id) ? await env.POLLS.getByName(id).summary() : null;
  const headers = new Headers(shell.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-robots-tag', 'noindex');
  if (!summary) {
    return new Response(shell.body, { status: 404, headers });
  }
  const { title, description } = describePoll(summary.poll, summary.count);
  const setContent = (value: string) => ({
    element(el: Element) {
      el.setAttribute('content', escapeAttr(value));
    },
  });
  const rewritten = new HTMLRewriter()
    .on('title', { element: (el) => void el.setInnerContent(`${title} · muster`) })
    .on('meta[name="description"]', setContent(description))
    .on('meta[property="og:title"]', setContent(title))
    .on('meta[property="og:description"]', setContent(description))
    .on('meta[property="og:url"]', setContent(`https://${url.host}/e/${id}`))
    .on('meta[name="twitter:title"]', setContent(title))
    .on('meta[name="twitter:description"]', setContent(description))
    .transform(new Response(shell.body, { status: 200, headers }));
  return rewritten;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(request, env, url);
      if (url.pathname.startsWith('/e/') && (request.method === 'GET' || request.method === 'HEAD')) {
        return await pollPage(request, env, url);
      }
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return error(500, 'Something went wrong. Try again in a moment.');
    }
  },
} satisfies ExportedHandler<Env>;
