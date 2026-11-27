// Small helpers for the Worker's responses and requests.

import type { Failure } from './poll-object';

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function error(status: number, message: string, extra: object = {}): Response {
  return json({ error: message, ...extra }, status);
}

export function fromFailure(f: Failure): Response {
  const { ok: _ok, status, error: message, ...extra } = f;
  return error(status, message, extra);
}

export function auth(request: Request) {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  return { token: bearer ?? undefined, admin: request.headers.get('x-admin-token') ?? undefined };
}
