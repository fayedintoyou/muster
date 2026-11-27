import type { Marks, Person, PollSettings, PollState } from '../core/types';
import type { Raid } from '../core/raid';
import type { Team } from '../core/team';
import type { Move, SignupStatus } from '../core/signup';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly extra: { exists?: boolean; hasPassword?: boolean; discord?: boolean } = {},
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
  lockRaid(id: string, admin: string, raid: Pick<Raid, 'start' | 'minutes' | 'skips'>) {
    return call<PollState>(`/api/polls/${id}/raid`, { method: 'PUT', admin, body: JSON.stringify(raid) });
  },
  unlockRaid(id: string, admin: string) {
    return call<PollState>(`/api/polls/${id}/raid`, { method: 'DELETE', admin });
  },
  saveTeam(id: string, admin: string, team: Pick<Team, 'name' | 'members' | 'size' | 'makeup'>, teamId?: string) {
    return call<PollState>(teamId ? `/api/polls/${id}/teams/${teamId}` : `/api/polls/${id}/teams`, {
      method: teamId ? 'PUT' : 'POST',
      admin,
      body: JSON.stringify(team),
    });
  },
  deleteTeam(id: string, admin: string, teamId: string) {
    return call<PollState>(`/api/polls/${id}/teams/${teamId}`, { method: 'DELETE', admin });
  },
  lockTeamRaid(id: string, admin: string, teamId: string, raid: Pick<Raid, 'start' | 'minutes' | 'skips'> | null) {
    return call<PollState>(`/api/polls/${id}/teams/${teamId}/raid`, {
      method: raid ? 'PUT' : 'DELETE',
      admin,
      ...(raid ? { body: JSON.stringify(raid) } : {}),
    });
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
      cls?: string;
      specs?: string[];
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
    input: {
      marks?: Marks;
      roles?: string[];
      cls?: string;
      specs?: string[];
      spec?: string;
      note?: string;
      name?: string;
      password?: string;
      discord?: null;
    },
    keepalive = false,
  ) {
    return call<{ person: Person; version: number }>(`/api/polls/${id}/people/${personId}`, {
      method: 'PUT',
      ...auth,
      keepalive,
      body: JSON.stringify(input),
    });
  },
  /** One person's answer for one raid night; status null takes it back. */
  signUp(
    id: string,
    event: { owner: string; night: string },
    personId: string,
    auth: { token?: string; admin?: string },
    signup: { status: SignupStatus | null; late?: number },
  ) {
    return call<PollState>(`/api/polls/${id}/signups/${event.owner}/${event.night}/${personId}`, {
      method: 'PUT',
      ...auth,
      body: JSON.stringify(signup),
    });
  },
  /** An organizer seats or benches someone for one night; null leaves it to the usual order. */
  move(id: string, admin: string, event: { owner: string; night: string }, personId: string, move: Move | null) {
    return call<PollState>(`/api/polls/${id}/moves/${event.owner}/${event.night}/${personId}`, {
      method: 'PUT',
      admin,
      body: JSON.stringify({ move }),
    });
  },
  /** Where to send the browser to sign in with Discord, or with a person and their token, to link it. */
  discord(id: string, link?: { person: string; token?: string }) {
    return call<{ url: string }>(`/api/polls/${id}/discord`, {
      method: 'POST',
      token: link?.token,
      body: JSON.stringify(link ? { person: link.person } : {}),
    });
  },
  remove(id: string, personId: string, auth: { token?: string; admin?: string }) {
    return call<{ version: number }>(`/api/polls/${id}/people/${personId}`, { method: 'DELETE', ...auth });
  },
};
