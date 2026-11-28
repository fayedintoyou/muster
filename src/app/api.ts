import type { Marks, Person, PollSettings, PollState } from '../core/types';
import type { Raid } from '../core/raid';
import type { Team } from '../core/team';
import type { Move, SignupStatus } from '../core/signup';
import type { Absence } from '../core/absence';
import type { GroupMove } from '../core/groups';
import type { BotLink, BotSettings } from '../core/bot';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly extra: { exists?: boolean; hasPassword?: boolean; discord?: boolean; discordOnly?: boolean; closed?: boolean } = {},
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
      level60?: boolean;
      marks?: Marks;
      claim?: boolean;
      discordTicket?: string;
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
      level60?: boolean;
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
  /** Someone seated into a group, out of one, or swapped with someone else. */
  group(id: string, admin: string, event: { owner: string; night: string }, personId: string, move: GroupMove) {
    return call<PollState>(`/api/polls/${id}/groups/${event.owner}/${event.night}/${personId}`, {
      method: 'PUT',
      admin,
      body: JSON.stringify(move),
    });
  },
  /** The raid's template laid over one night, or with `clear`, the night's groups emptied. */
  groups(id: string, admin: string, event: { owner: string; night: string }, clear = false) {
    return call<PollState>(`/api/polls/${id}/groups/${event.owner}/${event.night}`, {
      method: clear ? 'DELETE' : 'PUT',
      admin,
      body: clear ? undefined : JSON.stringify({ template: true }),
    });
  },
  /** One night's groups saved as the raid's template. */
  saveLayout(id: string, admin: string, event: { owner: string; night: string }) {
    return call<PollState>(`/api/polls/${id}/layouts/${event.owner}`, {
      method: 'PUT',
      admin,
      body: JSON.stringify({ night: event.night }),
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
  /** An officer's organizer token, from their own sign-in. */
  organize(id: string, token: string) {
    return call<{ admin: string }>(`/api/polls/${id}/organize`, { method: 'POST', token });
  },
  /** The maker makes someone an officer, or stands them down. */
  officer(id: string, personId: string, admin: string, officer: boolean) {
    return call<PollState>(`/api/polls/${id}/officers/${personId}`, { method: officer ? 'PUT' : 'DELETE', admin });
  },
  /** Takes off someone's password and Discord link, for an organizer helping them back in. */
  unlock(id: string, personId: string, admin: string) {
    return call<PollState>(`/api/polls/${id}/people/${personId}/unlock`, { method: 'POST', admin });
  },
  /** The dated absences this browser may see: everyone's for an organizer, or just your own. */
  absences(id: string, auth: { token?: string; admin?: string }) {
    return call<{ absences: Record<string, Absence[]> }>(`/api/polls/${id}/absences`, auth);
  },
  /** Someone's whole list of dated absences, replaced. */
  setAbsences(id: string, personId: string, auth: { token?: string; admin?: string }, absences: Absence[]) {
    return call<{ absences: Absence[]; version: number }>(`/api/polls/${id}/people/${personId}/absences`, {
      method: 'PUT',
      ...auth,
      body: JSON.stringify({ absences }),
    });
  },
  /** Where the bot posts, the guild's choices, the server's roles, and how to add the bot. */
  bot(id: string, admin: string) {
    return call<{ link: BotLink | null; problem: string | null; roles: { id: string; name: string }[]; ready: boolean; invite: string }>(
      `/api/polls/${id}/bot`,
      { admin },
    );
  },
  botCode(id: string, admin: string) {
    return call<{ code: string }>(`/api/polls/${id}/bot/code`, { method: 'POST', admin });
  },
  botSettings(id: string, admin: string, settings: Partial<BotSettings>) {
    return call<{ link: BotLink }>(`/api/polls/${id}/bot`, { method: 'PUT', admin, body: JSON.stringify(settings) });
  },
  botDisconnect(id: string, admin: string) {
    return call<{ ok: true }>(`/api/polls/${id}/bot`, { method: 'DELETE', admin });
  },
  remove(id: string, personId: string, auth: { token?: string; admin?: string }) {
    return call<{ version: number }>(`/api/polls/${id}/people/${personId}`, { method: 'DELETE', ...auth });
  },
};
