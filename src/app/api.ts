import type { Marks, Person, PollSettings, PollState } from '../core/types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly extra: { exists?: boolean; hasPassword?: boolean } = {},
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit & { token?: string; admin?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  if (init.admin) headers.set('x-admin-token', init.admin);
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError('Couldn’t reach muster. Check your connection and try again.', 0);
  }
  if (response.status === 204) return undefined as T;
  let body: Record<string, unknown> = {};
  try {
    body = await response.json();
  } catch {
    // An empty or non-JSON error body falls through to the generic message.
  }
  if (!response.ok) {
    const { error, ...extra } = body as { error?: string };
    throw new ApiError(error ?? `Something went wrong (${response.status}).`, response.status, extra);
  }
  return body as T;
}

export const api = {
  create(settings: PollSettings) {
    return call<{ id: string; admin: string }>('/api/polls', { method: 'POST', body: JSON.stringify(settings) });
  },
  /** Resolves to undefined when nothing changed since `since`. */
  read(id: string, since?: number) {
    const query = since === undefined ? '' : `?since=${since}`;
    return call<PollState | undefined>(`/api/polls/${id}${query}`);
  },
  update(id: string, admin: string, patch: Partial<PollSettings>) {
    return call<PollState>(`/api/polls/${id}`, { method: 'PATCH', admin, body: JSON.stringify(patch) });
  },
  destroy(id: string, admin: string) {
    return call<{ ok: true }>(`/api/polls/${id}`, { method: 'DELETE', admin });
  },
  join(
    id: string,
    input: {
      name: string;
      password?: string;
      roles?: string[];
      spec?: string;
      note?: string;
      marks?: Marks;
      claim?: boolean;
    },
  ) {
    return call<{ person: Person; token: string; state: PollState }>(`/api/polls/${id}/people`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  save(
    id: string,
    personId: string,
    auth: { token?: string; admin?: string },
    input: { marks?: Marks; roles?: string[]; spec?: string; note?: string; name?: string; password?: string },
    keepalive = false,
  ) {
    return call<{ person: Person; version: number }>(`/api/polls/${id}/people/${personId}`, {
      method: 'PUT',
      ...auth,
      keepalive,
      body: JSON.stringify(input),
    });
  },
  remove(id: string, personId: string, auth: { token?: string; admin?: string }) {
    return call<{ version: number }>(`/api/polls/${id}/people/${personId}`, { method: 'DELETE', ...auth });
  },
};
