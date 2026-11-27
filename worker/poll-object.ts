import { DurableObject } from 'cloudflare:workers';
import type { Person, Poll, PollSettings, PollState } from '../src/core/types';
import { slotKeys } from '../src/core/slots';
import { type Raid, raidNights, validateRaid } from '../src/core/raid';
import { type EventSignups, POLL_RAID, eventKey, nextSignup, validateSignup } from '../src/core/signup';
import { addDays, dateKey, today } from '../src/core/time';
import { TEAM_LIMITS, type Team, validateTeam } from '../src/core/team';
import { REALM_TIME, ROLES, WOW_CLASSES, rolesFor } from '../src/core/classes';
import {
  LIMITS,
  cleanMarks,
  cleanPersonRoles,
  cleanNote,
  cleanSpec,
  nameKey,
  validateName,
  validatePassword,
  validateClass,
  validateSettings,
} from '../src/core/validate';
import { hashPassword, randomId, randomToken, sameHash, sha256 } from './crypto';

// One object per poll. Its storage holds the poll ('poll'), the admin token's hash ('admin'), a version
// that every change bumps ('version'), and one record per person ('p:<id>').
//
// Every read-modify-write below runs without an await between the read and the write (the synchronous
// KV API), so two people saving at once can't lose each other's answers. Hashing happens before.

interface StoredPerson {
  id: string;
  name: string;
  key: string;
  roles: string[];
  /** Missing on people who answered before there were classes. */
  cls?: string;
  /** Missing on people who answered before they picked specs. */
  specs?: string[];
  /** Missing on people who answered before there was a spec. */
  spec?: string;
  /** Missing on people who answered before there were notes. */
  note?: string;
  /** Missing on people who answered before it was asked. */
  level60?: boolean;
  marks: Person['marks'];
  salt?: string;
  pass?: string;
  /** Wrong passwords in a row, and when the first of them was: past a few, claiming waits a while. */
  tries?: { n: number; since: number };
  /** The Discord account linked to this person. With it they sign in with Discord on any device. */
  discord?: { id: string; name: string };
  /** Hashes of this person's sign-in tokens, newest last: one per device. */
  tokens: string[];
  created: number;
  updated: number;
}

export type Failure = {
  ok: false;
  status: number;
  error: string;
  exists?: boolean;
  hasPassword?: boolean;
  discord?: boolean;
  discordOnly?: boolean;
  closed?: boolean;
};
export type Outcome<T> = ({ ok: true } & T) | Failure;

export interface Auth {
  /** A person's sign-in token. */
  token?: string;
  /** The poll's admin token. */
  admin?: string;
}

export interface JoinInput {
  name?: unknown;
  password?: unknown;
  roles?: unknown;
  cls?: unknown;
  specs?: unknown;
  spec?: unknown;
  note?: unknown;
  level60?: unknown;
  /** Times marked before joining, so a new person's answers arrive in one step. */
  marks?: unknown;
  /** Sign in as an existing person of that name. */
  claim?: unknown;
}

export interface SaveInput {
  marks?: unknown;
  roles?: unknown;
  cls?: unknown;
  specs?: unknown;
  spec?: unknown;
  note?: unknown;
  level60?: unknown;
  name?: unknown;
  password?: unknown;
  /** null unlinks their Discord account. */
  discord?: null;
}

const MAX_TOKENS = 8;
/** Wrong passwords allowed for one person before claiming them waits out the window. */
const MAX_TRIES = 10;
const TRY_WINDOW = 15 * 60_000;

function fail(status: number, error: string, extra: Partial<Failure> = {}): Failure {
  return { ok: false, status, error, ...extra };
}

function publicPerson(p: StoredPerson): Person {
  return {
    id: p.id,
    name: p.name,
    roles: p.roles,
    cls: p.cls ?? '',
    specs: p.specs ?? [],
    spec: p.spec ?? '',
    note: p.note ?? '',
    level60: p.level60 ?? null,
    marks: p.marks,
    hasPassword: Boolean(p.pass),
    discord: Boolean(p.discord),
    updated: p.updated,
  };
}

export class PollObject extends DurableObject<Env> {
  private get kv() {
    return this.ctx.storage.kv;
  }

  private poll(): Poll | undefined {
    const poll = this.kv.get<Poll>('poll');
    if (!poll) return undefined;
    // Polls made before there were classes ask for them now (every poll so far is a WoW guild's), with
    // tank, healer and dps counted from the specs if they weren't counting roles already.
    let upgraded = poll;
    if (poll.classes === undefined) {
      upgraded = { ...upgraded, classes: [...WOW_CLASSES], roles: poll.roles.length ? poll.roles : [...ROLES] };
    }
    // And server time, which WoW Forever's US realms keep on Central.
    if (poll.realm === undefined) upgraded = { ...upgraded, realm: REALM_TIME };
    if (poll.size === undefined) upgraded = { ...upgraded, size: 0, makeup: {} };
    if (poll.discordOnly === undefined) upgraded = { ...upgraded, discordOnly: false };
    if (poll.closed === undefined) upgraded = { ...upgraded, closed: false };
    return upgraded;
  }

  private people(): StoredPerson[] {
    const out: StoredPerson[] = [];
    for (const [, p] of this.kv.list<StoredPerson>({ prefix: 'p:' })) out.push(p);
    return out.sort((a, b) => a.created - b.created);
  }

  private teams(): Team[] {
    return this.kv.get<Team[]>('teams') ?? [];
  }

  /** Sign-ups for nights from yesterday on, by event key; older nights stay stored but aren't sent. */
  private signups(tz: string): Record<string, EventSignups> {
    const from = dateKey(addDays(today(tz), -1));
    const out: Record<string, EventSignups> = {};
    for (const [key, value] of this.kv.list<EventSignups>({ prefix: 's:' })) {
      const event = key.slice(2);
      if (event.slice(event.indexOf('/') + 1) >= from) out[event] = value;
    }
    return out;
  }

  /** The raid an event belongs to, and that the night is one of its coming nights that's on. */
  private eventRaid(poll: Poll, owner: string, night: string): Raid | Failure {
    const raid = owner === POLL_RAID ? this.kv.get<Raid>('raid') : this.teams().find((t) => t.id === owner)?.raid;
    if (!raid) return fail(404, 'That raid isn’t locked in any more.');
    const n = raidNights(poll, raid, Date.now(), 8).find((x) => x.night === night);
    if (!n) return fail(404, 'That night isn’t coming up.');
    if (n.off) return fail(409, 'That night has been called off.');
    return raid;
  }

  private bump(): number {
    const v = (this.kv.get<number>('version') ?? 0) + 1;
    this.kv.put('version', v);
    return v;
  }

  private state(): PollState | null {
    const poll = this.poll();
    if (!poll) return null;
    return {
      poll,
      people: this.people().map(publicPerson),
      raid: this.kv.get<Raid>('raid') ?? null,
      teams: this.teams(),
      signups: this.signups(poll.tz),
      version: this.kv.get<number>('version') ?? 0,
    };
  }

  private async adminOk(admin: string | undefined): Promise<boolean> {
    const stored = this.kv.get<string>('admin');
    return Boolean(admin && stored && sameHash(await sha256(admin), stored));
  }

  async create(id: string, settings: PollSettings, adminHash: string): Promise<boolean> {
    if (this.poll()) return false;
    const now = Date.now();
    this.kv.put('poll', { ...settings, id, created: now, updated: now } satisfies Poll);
    this.kv.put('admin', adminHash);
    this.kv.put('version', 1);
    return true;
  }

  async read(since?: number): Promise<PollState | null | 'unchanged'> {
    const version = this.kv.get<number>('version');
    if (since !== undefined && version !== undefined && since === version) return 'unchanged';
    return this.state();
  }

  /**
   * Answering, or signing in as someone who has. With `discord` (checked by the Worker), the person is
   * linked to that Discord account, and someone already linked to it signs in without a password.
   */
  async join(
    input: JoinInput,
    discord?: { id: string; name: string },
  ): Promise<Outcome<{ person: Person; token: string; state: PollState }>> {
    const name = validateName(input.name);
    if (!name.ok) return fail(400, name.error);
    const password = validatePassword(input.password);
    if (!password.ok) return fail(400, password.error);
    const key = nameKey(name.value);

    const token = randomToken();
    const tokenHash = await sha256(token);
    const existingBefore = this.people().find((p) => p.key === key);

    if (existingBefore) {
      const lock = { hasPassword: Boolean(existingBefore.pass), discord: Boolean(existingBefore.discord) };
      if (input.claim !== true) {
        return fail(409, `${existingBefore.name} has already answered.`, { exists: true, ...lock });
      }
      if (this.poll()?.discordOnly && !discord) {
        return fail(401, `This poll asks everyone to sign in with Discord.`, { ...lock, discordOnly: true });
      }
      const sameDiscord = Boolean(discord && existingBefore.discord?.id === discord.id);
      if (existingBefore.discord && discord && !sameDiscord) {
        return fail(403, `${existingBefore.name} is linked to a different Discord account.`, lock);
      }
      if (sameDiscord) {
        // Their own Discord account: signed in already.
      } else if (existingBefore.pass) {
        if (!password.value) return fail(401, `${existingBefore.name} is locked with a password.`, lock);
        const tries = existingBefore.tries;
        if (tries && tries.n >= MAX_TRIES && Date.now() - tries.since < TRY_WINDOW) {
          return fail(429, 'Too many wrong passwords. Try again in 15 minutes.', lock);
        }
        const { hash } = await hashPassword(password.value, existingBefore.salt);
        if (!sameHash(hash, existingBefore.pass)) {
          // No await from here: count the miss on the current record.
          const current = this.kv.get<StoredPerson>(`p:${existingBefore.id}`);
          if (current) {
            const fresh = !current.tries || Date.now() - current.tries.since >= TRY_WINDOW;
            current.tries = fresh ? { n: 1, since: Date.now() } : { n: current.tries!.n + 1, since: current.tries!.since };
            this.kv.put(`p:${current.id}`, current);
          }
          return fail(403, 'That password doesn’t match.', lock);
        }
      } else if (existingBefore.discord) {
        return fail(401, `${existingBefore.name} is linked to Discord. Sign in with Discord to carry on.`, lock);
      }
      // No await from here: re-read and write in one step.
      const current = this.kv.get<StoredPerson>(`p:${existingBefore.id}`);
      if (!current) return fail(409, 'That person was just removed. Try again.');
      current.tokens = [...current.tokens, tokenHash].slice(-MAX_TOKENS);
      delete current.tries;
      if (discord && !current.discord) {
        const other = this.people().find((p) => p.discord?.id === discord.id && p.id !== current.id);
        if (other) return fail(409, `That Discord account is already linked to ${other.name}.`);
        current.discord = discord;
        current.updated = Date.now();
        // Locking it signs out every other browser that was them, in case one wasn't.
        current.tokens = [tokenHash];
      }
      // Times marked on this device only count if they hadn't marked any yet: signing in on a second
      // device mustn't wipe what they marked on the first.
      const claimPoll = this.poll();
      let changed = false;
      if (claimPoll && input.marks !== undefined && Object.keys(current.marks).length === 0) {
        const marks = cleanMarks(input.marks, new Set(slotKeys(claimPoll)));
        if (!marks.ok) return fail(400, marks.error);
        if (Object.keys(marks.value).length > 0) {
          current.marks = marks.value;
          current.updated = Date.now();
          changed = true;
        }
      }
      this.kv.put(`p:${current.id}`, current);
      if (changed || discord) this.bump();
      return { ok: true, person: publicPerson(current), token, state: this.state()! };
    }

    const secret = password.value ? await hashPassword(password.value) : undefined;
    const poll = this.poll();
    if (!poll) return fail(404, 'This poll doesn’t exist.');
    const people = this.people();
    if (people.some((p) => p.key === key)) return fail(409, `${name.value} has already answered.`, { exists: true });
    if (people.length >= LIMITS.people) return fail(400, `This poll is full (${LIMITS.people} people).`);
    if (poll.closed) {
      return fail(403, 'This poll is closed to new answers. Answered already? Use the same character name.', { closed: true });
    }
    if (poll.discordOnly && !discord) return fail(403, 'This poll asks everyone to sign in with Discord.', { discordOnly: true });
    const linkedTo = discord && people.find((p) => p.discord?.id === discord.id);
    if (linkedTo) return fail(409, `That Discord account is already linked to ${linkedTo.name}.`);
    const marks = input.marks === undefined ? undefined : cleanMarks(input.marks, new Set(slotKeys(poll)));
    if (marks && !marks.ok) return fail(400, marks.error);
    // A poll that asks for classes needs a class and a spec or two; the roles come from the specs.
    let who = { cls: '', specs: [] as string[], roles: cleanPersonRoles(input.roles, poll.roles) };
    if (poll.classes.length) {
      const picked = validateClass(input.cls, input.specs, poll.classes);
      if (!picked.ok) return fail(400, picked.error);
      who = { ...picked.value, roles: rolesFor(picked.value.cls, picked.value.specs).filter((r) => poll.roles.includes(r)) };
    }
    let id = randomId();
    while (this.kv.get(`p:${id}`)) id = randomId();
    const now = Date.now();
    const person: StoredPerson = {
      id,
      name: name.value,
      key,
      roles: who.roles,
      cls: who.cls,
      specs: who.specs,
      spec: cleanSpec(input.spec),
      note: cleanNote(input.note),
      level60: typeof input.level60 === 'boolean' ? input.level60 : undefined,
      marks: marks?.ok ? marks.value : {},
      salt: secret?.salt,
      pass: secret?.hash,
      tokens: [tokenHash],
      discord,
      created: now,
      updated: now,
    };
    this.kv.put(`p:${id}`, person);
    this.bump();
    return { ok: true, person: publicPerson(person), token, state: this.state()! };
  }

  async save(personId: string, auth: Auth, input: SaveInput): Promise<Outcome<{ person: Person; version: number }>> {
    const tokenHash = auth.token ? await sha256(auth.token) : undefined;
    const isAdmin = await this.adminOk(auth.admin);
    const password = validatePassword(input.password);
    if (!password.ok) return fail(400, password.error);
    const secret = typeof input.password === 'string' && password.value ? await hashPassword(password.value) : undefined;

    // No await from here on.
    const poll = this.poll();
    if (!poll) return fail(404, 'This poll doesn’t exist.');
    const person = this.kv.get<StoredPerson>(`p:${personId}`);
    if (!person) return fail(404, 'That person isn’t in this poll any more.');
    const mine = tokenHash !== undefined && person.tokens.some((t) => sameHash(t, tokenHash));
    if (!mine && !isAdmin) return fail(403, 'Sign in as this person to change their answers.');

    if (input.marks !== undefined) {
      const marks = cleanMarks(input.marks, new Set(slotKeys(poll)));
      if (!marks.ok) return fail(400, marks.error);
      person.marks = marks.value;
    }
    if (poll.classes.length) {
      if (input.cls !== undefined || input.specs !== undefined) {
        const picked = validateClass(input.cls ?? person.cls, input.specs ?? person.specs ?? [], poll.classes);
        if (!picked.ok) return fail(400, picked.error);
        person.cls = picked.value.cls;
        person.specs = picked.value.specs;
        person.roles = rolesFor(person.cls, person.specs).filter((r) => poll.roles.includes(r));
      }
    } else if (input.roles !== undefined) {
      person.roles = cleanPersonRoles(input.roles, poll.roles);
    }
    if (input.spec !== undefined) person.spec = cleanSpec(input.spec);
    if (input.note !== undefined) person.note = cleanNote(input.note);
    if (typeof input.level60 === 'boolean') person.level60 = input.level60;
    if (input.name !== undefined) {
      const name = validateName(input.name);
      if (!name.ok) return fail(400, name.error);
      const key = nameKey(name.value);
      if (this.people().some((p) => p.key === key && p.id !== person.id)) {
        return fail(409, `Someone called ${name.value} has already answered.`);
      }
      person.name = name.value;
      person.key = key;
    }
    if (input.password !== undefined) {
      if (!mine) return fail(403, 'Only they can change their own password.');
      person.salt = secret?.salt;
      person.pass = secret?.hash;
      delete person.tries;
      // A new password signs out every other browser that was them.
      if (secret && tokenHash) person.tokens = [tokenHash];
    }
    if (input.discord === null) {
      if (!mine) return fail(403, 'Only they can unlink their Discord account.');
      delete person.discord;
    }
    person.updated = Date.now();
    this.kv.put(`p:${person.id}`, person);
    return { ok: true, person: publicPerson(person), version: this.bump() };
  }

  /** Whether this token signs in as this person: the check before sending them off to link Discord. */
  async owns(personId: string, token: string | undefined): Promise<boolean> {
    if (!token) return false;
    const tokenHash = await sha256(token);
    return Boolean(this.kv.get<StoredPerson>(`p:${personId}`)?.tokens.some((t) => sameHash(t, tokenHash)));
  }

  /** Ties a Discord account to a person, once Discord has said whose it is. One person per account. */
  async linkDiscord(
    personId: string,
    discord: { id: string; name: string },
    /** The hash of the token of the browser that linked it: the only one left signed in. */
    keep?: string,
  ): Promise<Outcome<{ name: string }>> {
    const person = this.kv.get<StoredPerson>(`p:${personId}`);
    if (!person) return fail(404, 'That person isn’t in this poll any more.');
    const other = this.people().find((p) => p.discord?.id === discord.id && p.id !== personId);
    if (other) return fail(409, `That Discord account is already linked to ${other.name}.`);
    person.discord = discord;
    person.updated = Date.now();
    if (keep && person.tokens.includes(keep)) person.tokens = [keep];
    this.kv.put(`p:${personId}`, person);
    this.bump();
    return { ok: true, name: person.name };
  }

  /** Signs in on this device as whoever this Discord account is linked to. */
  async discordSignIn(discordId: string): Promise<Outcome<{ personId: string; token: string }>> {
    const token = randomToken();
    const tokenHash = await sha256(token);
    // No await from here.
    const person = this.people().find((p) => p.discord?.id === discordId);
    if (!person) return fail(404, 'No one in this poll is linked to that Discord account yet.');
    person.tokens = [...person.tokens, tokenHash].slice(-MAX_TOKENS);
    this.kv.put(`p:${person.id}`, person);
    return { ok: true, personId: person.id, token };
  }

  async removePerson(personId: string, auth: Auth): Promise<Outcome<{ version: number }>> {
    const tokenHash = auth.token ? await sha256(auth.token) : undefined;
    const isAdmin = await this.adminOk(auth.admin);
    const person = this.kv.get<StoredPerson>(`p:${personId}`);
    if (!person) return fail(404, 'That person isn’t in this poll any more.');
    const mine = tokenHash !== undefined && person.tokens.some((t) => sameHash(t, tokenHash));
    if (!mine && !isAdmin) return fail(403, 'Only they, or whoever made the poll, can remove them.');
    this.kv.delete(`p:${personId}`);
    // And off any team they were on.
    const teams = this.teams();
    if (teams.some((t) => t.members.includes(personId))) {
      this.kv.put('teams', teams.map((t) => ({ ...t, members: t.members.filter((m) => m !== personId) })));
    }
    return { ok: true, version: this.bump() };
  }

  /** For someone locked out: takes off their password and Discord link and signs them out everywhere. */
  async resetLock(admin: string | undefined, personId: string): Promise<Outcome<{ state: PollState }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only whoever made the poll can unlock someone.');
    const person = this.kv.get<StoredPerson>(`p:${personId}`);
    if (!person) return fail(404, 'That person isn’t in this poll any more.');
    delete person.salt;
    delete person.pass;
    delete person.tries;
    delete person.discord;
    person.tokens = [];
    person.updated = Date.now();
    this.kv.put(`p:${person.id}`, person);
    this.bump();
    return { ok: true, state: this.state()! };
  }

  async update(admin: string | undefined, patch: Partial<PollSettings>): Promise<Outcome<{ state: PollState }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only whoever made the poll can change it.');
    const poll = this.poll();
    if (!poll) return fail(404, 'This poll doesn’t exist.');
    const merged = { ...poll, ...patch };
    const checked = validateSettings(merged);
    if (!checked.ok) return fail(400, checked.error);
    const next = checked.value;
    if (next.mode !== poll.mode) return fail(400, 'A poll can’t switch between weekly and dates; make a new one.');
    if (next.slot !== poll.slot && this.people().some((p) => Object.keys(p.marks).length > 0)) {
      return fail(400, 'Slot size can’t change once people have answered.');
    }
    this.kv.put('poll', { ...next, id: poll.id, created: poll.created, updated: Date.now() } satisfies Poll);
    // A locked-in raid whose time is no longer in the poll comes unlocked.
    const raid = this.kv.get<Raid>('raid');
    if (raid && !validateRaid(raid, next).ok) this.kv.delete('raid');
    const teams = this.teams();
    if (teams.some((t) => t.raid && !validateRaid(t.raid, next).ok)) {
      this.kv.put('teams', teams.map((t) => (t.raid && !validateRaid(t.raid, next).ok ? { ...t, raid: null } : t)));
    }
    // Roles and classes taken away come off people too.
    if (next.roles.join() !== poll.roles.join() || next.classes.join() !== poll.classes.join()) {
      for (const p of this.people()) {
        const roles = p.roles.filter((r) => next.roles.includes(r));
        const cls = p.cls && next.classes.includes(p.cls) ? p.cls : '';
        if (roles.length !== p.roles.length || cls !== (p.cls ?? '')) this.kv.put(`p:${p.id}`, { ...p, roles, cls, specs: cls ? p.specs : [] });
      }
    }
    this.bump();
    return { ok: true, state: this.state()! };
  }

  /** Locks in the raid's time, or changes it (another time, or nights called off). */
  async lockRaid(admin: string | undefined, input: unknown): Promise<Outcome<{ state: PollState }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only whoever made the poll can lock in the raid.');
    const poll = this.poll();
    if (!poll) return fail(404, 'This poll doesn’t exist.');
    const checked = validateRaid(input, poll);
    if (!checked.ok) return fail(400, checked.error);
    const version = (this.kv.get<Raid>('raid')?.version ?? 0) + 1;
    this.kv.put('raid', { ...checked.value, version } satisfies Raid);
    this.bump();
    return { ok: true, state: this.state()! };
  }

  async unlockRaid(admin: string | undefined): Promise<Outcome<{ state: PollState }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only whoever made the poll can unlock the raid.');
    if (!this.poll()) return fail(404, 'This poll doesn’t exist.');
    this.kv.delete('raid');
    this.bump();
    return { ok: true, state: this.state()! };
  }

  /** Makes a team (no `teamId`) or changes one: its name, members, size and make-up. */
  async saveTeam(admin: string | undefined, teamId: string | undefined, input: unknown): Promise<Outcome<{ state: PollState }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only whoever made the poll can change its teams.');
    if (!this.poll()) return fail(404, 'This poll doesn’t exist.');
    const checked = validateTeam(input, new Set(this.people().map((p) => p.id)));
    if (!checked.ok) return fail(400, checked.error);
    const teams = this.teams();
    if (teamId === undefined) {
      if (teams.length >= TEAM_LIMITS.teams) return fail(400, `A poll can have at most ${TEAM_LIMITS.teams} teams.`);
      let id = randomId(6);
      while (teams.some((t) => t.id === id)) id = randomId(6);
      teams.push({ id, ...checked.value, raid: null });
    } else {
      const i = teams.findIndex((t) => t.id === teamId);
      if (i < 0) return fail(404, 'That team doesn’t exist any more.');
      teams[i] = { ...teams[i], ...checked.value };
    }
    this.kv.put('teams', teams);
    this.bump();
    return { ok: true, state: this.state()! };
  }

  async deleteTeam(admin: string | undefined, teamId: string): Promise<Outcome<{ state: PollState }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only whoever made the poll can change its teams.');
    const teams = this.teams();
    if (!teams.some((t) => t.id === teamId)) return fail(404, 'That team doesn’t exist any more.');
    this.kv.put('teams', teams.filter((t) => t.id !== teamId));
    this.bump();
    return { ok: true, state: this.state()! };
  }

  /** Locks in a team's raid, changes it (nights called off), or with null unlocks it. */
  async lockTeamRaid(admin: string | undefined, teamId: string, input: unknown): Promise<Outcome<{ state: PollState }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only whoever made the poll can lock in a team’s raid.');
    const poll = this.poll();
    if (!poll) return fail(404, 'This poll doesn’t exist.');
    const teams = this.teams();
    const i = teams.findIndex((t) => t.id === teamId);
    if (i < 0) return fail(404, 'That team doesn’t exist any more.');
    if (input === null) {
      teams[i] = { ...teams[i], raid: null };
    } else {
      const checked = validateRaid(input, poll);
      if (!checked.ok) return fail(400, checked.error);
      teams[i] = { ...teams[i], raid: { ...checked.value, version: (teams[i].raid?.version ?? 0) + 1 } };
    }
    this.kv.put('teams', teams);
    this.bump();
    return { ok: true, state: this.state()! };
  }

  /** Someone says whether they're coming on one night: in, late, tentative, out, or null to take it back. */
  async signUp(
    auth: Auth,
    owner: string,
    night: string,
    personId: string,
    input: unknown,
  ): Promise<Outcome<{ state: PollState }>> {
    const tokenHash = auth.token ? await sha256(auth.token) : undefined;
    const isAdmin = await this.adminOk(auth.admin);
    // No await from here.
    const poll = this.poll();
    if (!poll) return fail(404, 'This poll doesn’t exist.');
    const person = this.kv.get<StoredPerson>(`p:${personId}`);
    if (!person) return fail(404, 'That person isn’t in this poll any more.');
    const mine = tokenHash !== undefined && person.tokens.some((t) => sameHash(t, tokenHash));
    if (!mine && !isAdmin) return fail(403, 'Sign in as this person to sign them up.');
    const raid = this.eventRaid(poll, owner, night);
    if ('ok' in raid) return raid;
    const change = validateSignup(input);
    if (!change.ok) return fail(400, change.error);
    const key = `s:${eventKey(owner, night)}`;
    const event = this.kv.get<EventSignups>(key) ?? { people: {}, moves: {} };
    if (change.value) event.people[personId] = nextSignup(event.people[personId], change.value, Date.now());
    else delete event.people[personId];
    this.kv.put(key, event);
    this.bump();
    return { ok: true, state: this.state()! };
  }

  /** An organizer seats or benches someone for one night, or with null leaves it to the usual order. */
  async moveSignup(
    admin: string | undefined,
    owner: string,
    night: string,
    personId: string,
    move: unknown,
  ): Promise<Outcome<{ state: PollState }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only whoever made the poll can move people.');
    const poll = this.poll();
    if (!poll) return fail(404, 'This poll doesn’t exist.');
    const raid = this.eventRaid(poll, owner, night);
    if ('ok' in raid) return raid;
    if (move !== null && move !== 'seat' && move !== 'bench') return fail(400, 'Seat or bench them.');
    const key = `s:${eventKey(owner, night)}`;
    const event = this.kv.get<EventSignups>(key) ?? { people: {}, moves: {} };
    if (!event.people[personId]) return fail(409, 'They haven’t signed up for that night.');
    if (move) event.moves[personId] = move;
    else delete event.moves[personId];
    this.kv.put(key, event);
    this.bump();
    return { ok: true, state: this.state()! };
  }

  async destroy(admin: string | undefined): Promise<Outcome<object>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only whoever made the poll can delete it.');
    await this.ctx.storage.deleteAll();
    return { ok: true };
  }

  /** A short summary for link previews. */
  async summary(): Promise<{ poll: Poll; count: number } | null> {
    const poll = this.poll();
    if (!poll) return null;
    return { poll, count: this.people().filter((p) => Object.keys(p.marks).length > 0).length };
  }
}
