import { DurableObject } from 'cloudflare:workers';
import type { Person, Poll, PollSettings, PollState } from '../src/core/types';
import { slotKeys } from '../src/core/slots';
import { type Raid, type RaidNight, raidNights, validateRaid } from '../src/core/raid';
import { type EventSignups, POLL_RAID, eventKey, nextSignup, roster, validateSignup } from '../src/core/signup';
import { type Groups, arrange, groupCount, moveInGroups, validateGroupMove } from '../src/core/groups';
import { addDays, dateKey, today } from '../src/core/time';
import { type Absence, currentAbsences, validateAbsences } from '../src/core/absence';
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
import { type BotLink, DEFAULT_SETTINGS, pingOf, validateBotSettings } from '../src/core/bot';
import { DAY, type DiscordMessage, EPHEMERAL, type Press, cardTitle, lateAsk, notice, pingFor, raidCard } from '../src/core/card';
import { DiscordError, discord, botReady } from './discord-api';

// One object per poll. Its storage holds the poll ('poll'), the admin token's hash ('admin'), a version
// that every change bumps ('version'), and one record per person ('p:<id>'). Each raid night keeps its
// sign-ups ('s:<event>') and groups ('g:<event>'); each raid's group template sits in 'layouts'.
//
// With the bot connected ('bot'), each raid night's post is a card record ('c:<event key>'), and the one
// alarm posts, edits, reminds and sends notices: see `alarm`.
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
  /** Dated absences, for every raid in their span. Never in the poll's state: see `absences()`. */
  absences?: Absence[];
  created: number;
  updated: number;
}

/** One raid night's post in Discord. */
/** Discord was disconnected or moved to another channel while the alarm waited on it. */
class Unlinked extends Error {}

interface CardRecord {
  channel: string;
  message: string;
  /** The night's start when it was last shown, to notice a raid that moved. */
  start: number;
  /** No longer on: called off, or moved or unlocked. */
  gone?: 'off' | 'moved';
  /** Its post was deleted in Discord, so it's left alone. */
  lost?: boolean;
  reminded?: boolean;
  nudged?: boolean;
}

/** What to answer a button press with. */
export type PressReply = { card: DiscordMessage } | { reply: DiscordMessage };

const CODE_MS = 30 * 60_000;

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

  /** Groups for nights from yesterday on, by event key, as the organizer last left them. */
  private groups(tz: string): Record<string, Groups> {
    const from = dateKey(addDays(today(tz), -1));
    const out: Record<string, Groups> = {};
    for (const [key, value] of this.kv.list<Groups>({ prefix: 'g:' })) {
      const event = key.slice(2);
      if (event.slice(event.indexOf('/') + 1) >= from) out[event] = value;
    }
    return out;
  }

  /** Who's seated tonight and how many groups they make, with the night's groups laid over them. */
  private nightGroups(poll: Poll, owner: string, night: string, raid: Raid) {
    const team = owner === POLL_RAID ? null : (this.teams().find((t) => t.id === owner) ?? null);
    const seated = roster(
      this.people().map(publicPerson),
      this.kv.get<EventSignups>(`s:${eventKey(owner, night)}`),
      raid,
      team,
      poll,
    ).seating.seated.map((s) => s.id);
    const count = groupCount(team ? team.size : poll.size, seated.length);
    return { seated, count, ...arrange(this.kv.get<Groups>(`g:${eventKey(owner, night)}`), seated, count) };
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
      groups: this.groups(poll.tz),
      layouts: this.kv.get<Record<string, Groups>>('layouts') ?? {},
      officers: this.officers(),
      version: this.kv.get<number>('version') ?? 0,
    };
  }

  private officers(): string[] {
    return this.kv.get<string[]>('officers') ?? [];
  }

  /** The maker's private link: only it can delete the poll or pick officers. */
  private async makerOk(admin: string | undefined): Promise<boolean> {
    const stored = this.kv.get<string>('admin');
    return Boolean(admin && stored && sameHash(await sha256(admin), stored));
  }

  /**
   * The maker's private link, or an officer's organizer token. An officer's token stops working the moment
   * they stop being an officer or unlink Discord.
   */
  private async adminOk(admin: string | undefined): Promise<boolean> {
    if (!admin) return false;
    const hash = await sha256(admin);
    const stored = this.kv.get<string>('admin');
    if (stored && sameHash(hash, stored)) return true;
    const personId = this.kv.get<Record<string, string>>('officer-tokens')?.[hash];
    if (!personId || !this.officers().includes(personId)) return false;
    return Boolean(this.kv.get<StoredPerson>(`p:${personId}`)?.discord);
  }

  /** An officer, signed in as themselves with Discord linked, gets a token to organize with. */
  async organize(token: string | undefined): Promise<Outcome<{ admin: string }>> {
    if (!token) return fail(401, 'Sign in first.');
    const tokenHash = await sha256(token);
    const admin = randomToken();
    const adminHash = await sha256(admin);
    // No await from here on.
    const person = this.people().find((p) => p.tokens.some((t) => sameHash(t, tokenHash)));
    if (!person) return fail(403, 'Sign in first.');
    if (!this.officers().includes(person.id)) return fail(403, 'You’re not an officer of this poll.');
    if (!person.discord) return fail(403, 'Officers sign in with Discord. Link it first.');
    const tokens = this.kv.get<Record<string, string>>('officer-tokens') ?? {};
    // A few devices each; the oldest goes first.
    const theirs = Object.keys(tokens).filter((h) => tokens[h] === person.id);
    for (const old of theirs.slice(0, Math.max(0, theirs.length - (MAX_TOKENS - 1)))) delete tokens[old];
    tokens[adminHash] = person.id;
    this.kv.put('officer-tokens', tokens);
    return { ok: true, admin };
  }

  /** The maker picks officers from people linked to Discord, or stands one down. */
  async setOfficer(admin: string | undefined, personId: string, officer: boolean): Promise<Outcome<{ state: PollState }>> {
    if (!(await this.makerOk(admin))) return fail(403, 'Only whoever made the poll can pick officers.');
    const person = this.kv.get<StoredPerson>(`p:${personId}`);
    const officers = this.officers().filter((id) => id !== personId);
    if (officer) {
      if (!person) return fail(404, 'That person isn’t in this poll any more.');
      if (!person.discord) return fail(400, `${person.name} needs to link Discord before they can be an officer.`);
      officers.push(personId);
    } else {
      this.dropOfficerTokens(personId);
    }
    this.kv.put('officers', officers);
    this.bump();
    return { ok: true, state: this.state()! };
  }

  private dropOfficerTokens(personId: string): void {
    const tokens = this.kv.get<Record<string, string>>('officer-tokens');
    if (!tokens) return;
    this.kv.put('officer-tokens', Object.fromEntries(Object.entries(tokens).filter(([, id]) => id !== personId)));
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
      if (changed || discord) {
        this.bump();
        this.touch();
      }
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
    this.touch();
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
    this.touch();
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
    if (this.officers().includes(personId)) {
      this.kv.put('officers', this.officers().filter((id) => id !== personId));
      this.dropOfficerTokens(personId);
    }
    // And off any team they were on.
    const teams = this.teams();
    if (teams.some((t) => t.members.includes(personId))) {
      this.kv.put('teams', teams.map((t) => ({ ...t, members: t.members.filter((m) => m !== personId) })));
    }
    this.touch();
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
    this.touch();
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
    this.touch();
    return { ok: true, state: this.state()! };
  }

  async unlockRaid(admin: string | undefined): Promise<Outcome<{ state: PollState }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only whoever made the poll can unlock the raid.');
    if (!this.poll()) return fail(404, 'This poll doesn’t exist.');
    this.kv.delete('raid');
    this.bump();
    this.touch();
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
    this.touch();
    return { ok: true, state: this.state()! };
  }

  async deleteTeam(admin: string | undefined, teamId: string): Promise<Outcome<{ state: PollState }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only whoever made the poll can change its teams.');
    const teams = this.teams();
    if (!teams.some((t) => t.id === teamId)) return fail(404, 'That team doesn’t exist any more.');
    this.kv.put('teams', teams.filter((t) => t.id !== teamId));
    const { [teamId]: _gone, ...layouts } = this.kv.get<Record<string, Groups>>('layouts') ?? {};
    this.kv.put('layouts', layouts);
    this.bump();
    this.touch();
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
    this.touch();
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
    this.touch([eventKey(owner, night)]);
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
    this.touch([eventKey(owner, night)]);
    this.tellMoved(personId, owner, night, move);
    return { ok: true, state: this.state()! };
  }

  /**
   * Dated absences, kept out of the state everyone with the link reads: an organizer gets everyone's, and
   * anyone signed in gets their own.
   */
  async absences(auth: Auth): Promise<Outcome<{ absences: Record<string, Absence[]> }>> {
    const tokenHash = auth.token ? await sha256(auth.token) : undefined;
    const isAdmin = await this.adminOk(auth.admin);
    const poll = this.poll();
    if (!poll) return fail(404, 'This poll doesn’t exist.');
    const from = addDays(today(poll.tz), -1);
    const absences: Record<string, Absence[]> = {};
    for (const p of this.people()) {
      const mine = tokenHash !== undefined && p.tokens.some((t) => sameHash(t, tokenHash));
      const list = currentAbsences(p.absences, from);
      if ((isAdmin || mine) && list.length) absences[p.id] = list;
    }
    return { ok: true, absences };
  }

  /** Someone's whole list of absences, replaced: adding, changing and taking one off are all this. */
  async setAbsences(personId: string, auth: Auth, input: unknown): Promise<Outcome<{ absences: Absence[]; version: number }>> {
    const tokenHash = auth.token ? await sha256(auth.token) : undefined;
    const isAdmin = await this.adminOk(auth.admin);
    // No await from here.
    const poll = this.poll();
    if (!poll) return fail(404, 'This poll doesn’t exist.');
    const person = this.kv.get<StoredPerson>(`p:${personId}`);
    if (!person) return fail(404, 'That person isn’t in this poll any more.');
    const mine = tokenHash !== undefined && person.tokens.some((t) => sameHash(t, tokenHash));
    if (!mine && !isAdmin) return fail(403, 'Sign in as this person to change their absences.');
    // Yesterday, in the poll's zone, so a night that started there yesterday can still be marked.
    const checked = validateAbsences(input, addDays(today(poll.tz), -1));
    if (!checked.ok) return fail(400, checked.error);
    if (checked.value.length) person.absences = checked.value;
    else delete person.absences;
    this.kv.put(`p:${person.id}`, person);
    return { ok: true, absences: checked.value, version: this.bump() };
  }

  /** An organizer puts someone seated into a group, takes them out of one, or swaps two people. */
  async moveToGroup(
    admin: string | undefined,
    owner: string,
    night: string,
    personId: string,
    input: unknown,
  ): Promise<Outcome<{ state: PollState }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only whoever made the poll can arrange groups.');
    const poll = this.poll();
    if (!poll) return fail(404, 'This poll doesn’t exist.');
    const raid = this.eventRaid(poll, owner, night);
    if ('ok' in raid) return raid;
    const now = this.nightGroups(poll, owner, night, raid);
    const move = validateGroupMove(input, now.count);
    if (!move.ok) return fail(400, move.error);
    if (!now.seated.includes(personId) || ('swap' in move.value && !now.seated.includes(move.value.swap))) {
      return fail(409, 'Only people seated that night go in groups.');
    }
    const next = moveInGroups(now.groups, personId, move.value);
    if (!next.ok) return fail(409, next.error);
    this.kv.put(`g:${eventKey(owner, night)}`, next.value);
    this.bump();
    return { ok: true, state: this.state()! };
  }

  /** Lays the raid's saved template over one night (`template: true`), or with null clears its groups. */
  async setGroups(admin: string | undefined, owner: string, night: string, input: unknown): Promise<Outcome<{ state: PollState }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only whoever made the poll can arrange groups.');
    const poll = this.poll();
    if (!poll) return fail(404, 'This poll doesn’t exist.');
    const raid = this.eventRaid(poll, owner, night);
    if ('ok' in raid) return raid;
    const key = `g:${eventKey(owner, night)}`;
    if (input === null) {
      this.kv.delete(key);
    } else {
      if ((input as { template?: unknown } | undefined)?.template !== true) return fail(400, 'Use the template, or clear the groups.');
      const layout = this.kv.get<Record<string, Groups>>('layouts')?.[owner];
      if (!layout) return fail(404, 'There’s no saved template for this raid yet.');
      const now = this.nightGroups(poll, owner, night, raid);
      this.kv.put(key, arrange(layout, now.seated, now.count).groups);
    }
    this.bump();
    return { ok: true, state: this.state()! };
  }

  /** Saves one night's groups as the raid's template, for laying over its other nights. */
  async saveLayout(admin: string | undefined, owner: string, night: unknown): Promise<Outcome<{ state: PollState }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only whoever made the poll can arrange groups.');
    const poll = this.poll();
    if (!poll) return fail(404, 'This poll doesn’t exist.');
    if (typeof night !== 'string') return fail(400, 'Pick a night.');
    const raid = this.eventRaid(poll, owner, night);
    if ('ok' in raid) return raid;
    const { groups } = this.nightGroups(poll, owner, night, raid);
    if (groups.every((g) => g.length === 0)) return fail(409, 'Put someone in a group first.');
    this.kv.put('layouts', { ...this.kv.get<Record<string, Groups>>('layouts'), [owner]: groups });
    this.bump();
    return { ok: true, state: this.state()! };
  }

  // ---- The Discord bot ----

  private bot(): BotLink | undefined {
    return this.kv.get<BotLink>('bot');
  }

  /** The raids that can have posts: the poll's own and each team's, by owner. */
  private raids(): { owner: string; raid: Raid; team: Team | null }[] {
    const out: { owner: string; raid: Raid; team: Team | null }[] = [];
    const raid = this.kv.get<Raid>('raid');
    if (raid) out.push({ owner: POLL_RAID, raid, team: null });
    for (const t of this.teams()) if (t.raid) out.push({ owner: t.id, raid: t.raid, team: t });
    return out;
  }

  /**
   * After a change: the cards it touches (all of them without `keys`) are shown again soon. Several changes
   * close together make one round of edits.
   */
  private touch(keys?: string[]): void {
    if (!this.bot()) return;
    const dirty = new Set(this.kv.get<string[]>('bot-dirty') ?? []);
    for (const k of keys ?? ['*']) dirty.add(k);
    this.kv.put('bot-dirty', [...dirty]);
    this.wake(Date.now() + 1500);
  }

  /**
   * Sets the alarm for `at`. Every caller wants it within seconds, sooner than anything already set, so it
   * simply replaces it. Not awaited: like the synchronous writes, it's stored with this change.
   */
  private wake(at: number): void {
    void this.ctx.storage.setAlarm(at);
  }

  private discordIdOf(personId: string): string | undefined {
    return this.kv.get<StoredPerson>(`p:${personId}`)?.discord?.id;
  }

  /** A code an organizer types into `/muster connect` in the channel the posts should go to. */
  async botCode(admin: string | undefined): Promise<Outcome<{ code: string }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only organizers can connect Discord.');
    const poll = this.poll();
    if (!poll) return fail(404, 'This poll doesn’t exist.');
    const secret = randomToken().slice(0, 12);
    const hash = await sha256(secret);
    this.kv.put('bot-code', { hash, exp: Date.now() + CODE_MS });
    return { ok: true, code: `${poll.id}-${secret}` };
  }

  /** `/muster connect`: the code proves an organizer sent them; Discord's permissions say they may post here. */
  async botConnect(
    secret: string,
    where: Pick<BotLink, 'guild' | 'guildName' | 'channel' | 'channelName' | 'by'>,
    origin: string,
  ): Promise<Outcome<{ title: string }>> {
    const hash = await sha256(secret);
    // No await from here.
    const poll = this.poll();
    if (!poll) return fail(404, 'That poll doesn’t exist any more.');
    const code = this.kv.get<{ hash: string; exp: number }>('bot-code');
    if (!code || code.exp < Date.now() || !sameHash(code.hash, hash)) {
      return fail(403, 'That code has expired or was already used. Get a new one from the poll’s organizer tab.');
    }
    this.kv.delete('bot-code');
    const before = this.bot();
    // Moving to another channel starts its posts afresh there; the old channel's cards are left as they are.
    if (before && before.channel !== where.channel) for (const [k] of this.kv.list({ prefix: 'c:' })) this.kv.delete(k);
    this.kv.put('bot', { ...where, at: Date.now(), settings: before?.settings ?? DEFAULT_SETTINGS } satisfies BotLink);
    this.kv.put('bot-origin', origin);
    this.kv.delete('bot-error');
    this.bump();
    this.wake(Date.now());
    return { ok: true, title: poll.title };
  }

  /** For the organizer tab: where posts go and the guild's choices, and the last thing that went wrong. */
  async botInfo(admin: string | undefined): Promise<Outcome<{ link: BotLink | null; problem: string | null }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only organizers can see the Discord settings.');
    return { ok: true, link: this.bot() ?? null, problem: this.kv.get<{ message: string }>('bot-error')?.message ?? null };
  }

  async botSettings(admin: string | undefined, input: unknown): Promise<Outcome<{ link: BotLink }>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only organizers can change the Discord settings.');
    const link = this.bot();
    if (!link) return fail(409, 'Connect Discord first.');
    const owners = new Set([POLL_RAID, ...this.teams().map((t) => t.id)]);
    const checked = validateBotSettings(input, owners, link.settings);
    if (!checked.ok) return fail(400, checked.error);
    const next = { ...link, settings: checked.value };
    this.kv.put('bot', next);
    this.bump();
    // A shorter lead may mean posts are due now.
    this.wake(Date.now());
    return { ok: true, link: next };
  }

  async botDisconnect(admin: string | undefined): Promise<Outcome<object>> {
    if (!(await this.adminOk(admin))) return fail(403, 'Only organizers can disconnect Discord.');
    for (const k of ['bot', 'bot-code', 'bot-dirty', 'bot-outbox', 'bot-error', 'bot-origin']) this.kv.delete(k);
    for (const [k] of this.kv.list({ prefix: 'c:' })) this.kv.delete(k);
    this.bump();
    return { ok: true };
  }

  private url(): string {
    const poll = this.poll();
    return `${this.kv.get<string>('bot-origin') ?? 'https://muster.fayelore.com'}/e/${poll?.id ?? ''}`;
  }

  /** One night's card as it stands, or null when that night isn't one of a locked-in raid's. */
  private card(owner: string, night: string, gone?: 'off' | 'moved'): DiscordMessage | null {
    const state = this.state();
    if (!state) return null;
    const team = owner === POLL_RAID ? null : (state.teams.find((t) => t.id === owner) ?? null);
    const raid = owner === POLL_RAID ? state.raid : team?.raid;
    if (!raid) return null;
    const n = raidNights(state.poll, raid, Date.now() - DAY, 8).find((x) => x.night === night);
    if (!n) return null;
    return raidCard({
      poll: state.poll,
      people: state.people,
      team,
      raid,
      night: n,
      event: state.signups[eventKey(owner, night)],
      url: this.url(),
      gone: gone ?? (n.off ? 'off' : undefined),
    });
  }

  /** Someone pressed a card's button. Discord has said who they are; they must be linked to someone here. */
  async press(discordId: string, owner: string, night: string, press: Press): Promise<PressReply> {
    const poll = this.poll();
    const say = (content: string, components?: object[]): PressReply => ({
      reply: { flags: EPHEMERAL, content, components, allowed_mentions: { parse: [] } },
    });
    if (!poll) return say('This raid’s poll is gone.');
    const person = this.people().find((p) => p.discord?.id === discordId);
    if (!person) {
      return say(
        'muster doesn’t know your Discord account yet. Open the poll, sign in with Discord and answer once (class, spec and when you’re usually free). After that, these buttons sign you up in one tap.',
        [{ type: 1, components: [{ type: 2, style: 5, label: 'open muster', url: this.url() }] }],
      );
    }
    const raid = this.eventRaid(poll, owner, night);
    if ('ok' in raid) return say(raid.error);
    if (press === 'late') return { reply: lateAsk(poll.id, owner, night) };
    const change = press.startsWith('late') ? { status: 'late', late: Number(press.slice(4)) } : { status: press };
    const checked = validateSignup(change);
    if (!checked.ok || !checked.value) return say('That button didn’t work. Try again.');
    const key = eventKey(owner, night);
    const event = this.kv.get<EventSignups>(`s:${key}`) ?? { people: {}, moves: {} };
    event.people[person.id] = nextSignup(event.people[person.id], checked.value, Date.now());
    this.kv.put(`s:${key}`, event);
    this.bump();
    if (press.startsWith('late')) {
      // Pressed on their own "how late?" row: the card itself is edited by the alarm.
      this.touch([key]);
      return { reply: { content: `Got it: ${checked.value.late} minutes late. See you there.`, components: [] } };
    }
    const card = this.card(owner, night);
    return card ? { card } : say('That night isn’t coming up.');
  }

  /** Who's coming on a night, linked to Discord: seated, standby and late, for reminders and changes. */
  private comingUsers(owner: string, night: string): string[] {
    const event = this.kv.get<EventSignups>(`s:${eventKey(owner, night)}`);
    if (!event) return [];
    return Object.entries(event.people)
      .filter(([, s]) => s.status === 'in' || s.status === 'late' || s.status === 'tentative')
      .map(([id]) => this.discordIdOf(id))
      .filter((u): u is string => Boolean(u));
  }

  private note(problem: unknown): void {
    const message = problem instanceof Error ? problem.message : String(problem);
    console.error('bot:', message);
    this.kv.put('bot-error', { message, at: Date.now() });
  }

  /**
   * The bot's one alarm. Posts each raid night's card once the guild's lead time arrives, pinging the raid's
   * role or people; edits cards that changed; marks nights called off or moved and tells those signed up;
   * reminds those coming and nudges those who haven't answered, if the guild turned those on; and sends
   * the notices waiting in the outbox. Then it sets itself for the next thing due.
   *
   * Alarms can fire more than once, so each send is recorded on its card before the next is tried, and a
   * card that exists is never posted again.
   */
  async alarm(): Promise<void> {
    const link = this.bot();
    const poll = this.poll();
    if (!link || !poll || !botReady(this.env)) return;
    const env = this.env;
    const now = Date.now();
    const dirty = new Set(this.kv.get<string[]>('bot-dirty') ?? []);
    this.kv.delete('bot-dirty');
    const all = dirty.has('*');
    let next = Infinity;
    const due = (at: number) => {
      if (at > now) next = Math.min(next, at);
      return at <= now;
    };
    const seen = new Set<string>();
    const title = (team: Team | null, night: RaidNight) => cardTitle({ poll, team, night });
    // Each wait on Discord lets other changes in. If Discord was disconnected or moved to another channel
    // meanwhile, this run stops without writing: the new link has its own alarm.
    const live = () => this.bot()?.channel === link.channel;
    const put = (key: string, record: CardRecord) => {
      if (!live()) throw new Unlinked();
      this.kv.put(`c:${key}`, record);
    };
    // One card's trouble doesn't hold up the others: it's noted, and its edit is tried again later.
    const failed = new Set<string>();
    let problem: unknown = null;
    const attempt = async (key: string, record: CardRecord | undefined, work: () => Promise<void>) => {
      try {
        await work();
      } catch (e) {
        if (e instanceof Unlinked) throw e;
        problem = e;
        // Its post was deleted in Discord: leave that night be rather than trying it forever.
        if (record && e instanceof DiscordError && e.status === 404) put(key, { ...record, lost: true });
        else failed.add(key);
      }
    };

    try {
      for (const { owner, raid, team } of this.raids()) {
        for (const n of raidNights(poll, raid, now, 4)) {
          const key = eventKey(owner, n.night);
          seen.add(key);
          const record = this.kv.get<CardRecord>(`c:${key}`);
          if (record?.lost) continue;
          await attempt(key, record, async () => {
            if (!record) {
              if (n.off || !due(n.start - link.settings.lead * DAY)) return;
              const card = this.card(owner, n.night);
              if (!card) return;
              const ping = pingOf(link.settings, owner);
              const users =
                ping === 'members'
                  ? (team ? team.members : this.people().map((p) => p.id)).map((id) => this.discordIdOf(id)).filter((u): u is string => Boolean(u))
                  : [];
              const mention = ping === 'none' ? { allowed_mentions: { parse: [] } } : pingFor(ping === 'members' ? '' : ping, users);
              const sent = await discord.post(env, link.channel, { ...card, ...mention });
              put(key, { channel: link.channel, message: sent.id, start: n.start });
              return;
            }
            if (n.off !== (record.gone === 'off') || (record.gone && !n.off) || record.start !== n.start || all || dirty.has(key)) {
              const card = this.card(owner, n.night);
              if (card) await discord.edit(env, record.channel, record.message, card);
              const t = title(team, n);
              if (n.off && record.gone !== 'off') {
                const msg = notice(`**${t}** is called off.`, this.comingUsers(owner, n.night));
                if (msg) await discord.post(env, record.channel, msg);
              } else if (!n.off && record.start !== n.start) {
                const s = Math.floor(n.start / 1000);
                const msg = notice(`**${t}** has moved: it now starts <t:${s}:F> (<t:${s}:R>).`, this.comingUsers(owner, n.night));
                if (msg) await discord.post(env, record.channel, msg);
              }
              record.gone = n.off ? 'off' : undefined;
              record.start = n.start;
              if (!record.gone) delete record.gone;
              put(key, record);
            }
            if (n.off || n.start <= now) return;
            if (link.settings.remind && !record.reminded && due(n.start - link.settings.remind * 60_000)) {
              const s = Math.floor(n.start / 1000);
              const msg = notice(`**${title(team, n)}** starts <t:${s}:R>.`, this.comingUsers(owner, n.night));
              if (msg) await discord.post(env, record.channel, msg);
              record.reminded = true;
              put(key, record);
            }
            if (link.settings.nudge && !record.nudged && due(n.start - link.settings.nudge * 3_600_000)) {
              const state = this.state()!;
              // Someone away on dated absence isn't asked.
              const absences = Object.fromEntries(this.people().flatMap((p) => (p.absences ? [[p.id, p.absences]] : [])));
              const r = roster(state.people, state.signups[key], raid, team, poll, { night: n.night, of: absences });
              const s = Math.floor(n.start / 1000);
              for (const { id } of r.unanswered) {
                const user = this.discordIdOf(id);
                if (!user) continue;
                await discord
                  .dm(env, user, {
                    content: `**${title(team, n)}** is <t:${s}:R>. Coming? Tap a button on the raid post, or answer here: ${this.url()}`,
                    allowed_mentions: { parse: [] },
                  })
                  // Someone who doesn't take messages from server members just isn't nudged.
                  .catch(() => undefined);
              }
              record.nudged = true;
              put(key, record);
            }
          });
        }
      }

      // Cards for nights no longer any raid's: unlocked, a team removed, or moved to another night. A night
      // that has started has simply come and gone, and drops out of the raid's coming nights on its own.
      const from = dateKey(addDays(today(poll.tz), -1));
      for (const [k, record] of this.kv.list<CardRecord>({ prefix: 'c:' })) {
        const key = k.slice(2);
        const night = key.slice(key.indexOf('/') + 1);
        if (seen.has(key) || record.gone || record.lost || night < from || record.start <= now) continue;
        const owner = key.slice(0, key.indexOf('/'));
        await attempt(key, record, async () => {
          await discord.edit(env, record.channel, record.message, this.goneCard(owner, night, record));
          const t = cardTitle({ poll, team: this.teams().find((x) => x.id === owner) ?? null, night: { night, start: record.start, end: record.start, off: true } });
          const msg = notice(`**${t}** is no longer on: the raid has a new time, or was taken down. See muster for what’s next.`, this.comingUsers(owner, night));
          if (msg) await discord.post(env, record.channel, msg);
          put(key, { ...record, gone: 'moved' });
        });
      }

      const outbox = this.kv.get<{ user: string; text: string }[]>('bot-outbox') ?? [];
      this.kv.delete('bot-outbox');
      for (const m of outbox) await discord.dm(env, m.user, { content: m.text, allowed_mentions: { parse: [] } }).catch(() => undefined);
    } catch (e) {
      if (e instanceof Unlinked) return;
      problem = e;
    }
    if (!live()) return;
    if (problem) this.note(problem);
    else this.kv.delete('bot-error');
    // Try what failed again in a few minutes, and look again at least every few hours as the weeks roll on.
    if (problem) next = Math.min(next, now + 5 * 60_000);
    next = Math.min(next, now + 6 * 3_600_000);
    if (this.kv.get('bot-dirty') || this.kv.get('bot-outbox')) next = Math.min(next, Date.now() + 1500);
    if (failed.size) this.kv.put('bot-dirty', [...new Set([...(this.kv.get<string[]>('bot-dirty') ?? []), ...failed])]);
    await this.ctx.storage.setAlarm(next);
  }

  /** A card for a night that's gone, built from what's left: the raid may not exist any more. */
  private goneCard(owner: string, night: string, record: CardRecord): DiscordMessage {
    const poll = this.poll()!;
    const team = this.teams().find((t) => t.id === owner) ?? null;
    return raidCard({
      poll,
      people: [],
      team,
      raid: { start: '', minutes: 0 },
      night: { night, start: record.start, end: record.start, off: true },
      event: undefined,
      url: this.url(),
      gone: 'moved',
    });
  }

  /** An organizer's seat or bench, told privately to whoever it moved. */
  private tellMoved(personId: string, owner: string, night: string, move: 'seat' | 'bench' | null): void {
    const user = this.discordIdOf(personId);
    const poll = this.poll();
    if (!user || !poll || !this.bot() || !move) return;
    const team = this.teams().find((t) => t.id === owner) ?? null;
    const raid = owner === POLL_RAID ? this.kv.get<Raid>('raid') : team?.raid;
    const n = raid && raidNights(poll, raid, Date.now(), 8).find((x) => x.night === night);
    if (!n) return;
    const t = cardTitle({ poll, team, night: n });
    const text = move === 'seat' ? `You’re seated for **${t}**.` : `You’re on standby for **${t}**. You’ll hear if a seat opens up.`;
    this.kv.put('bot-outbox', [...(this.kv.get<{ user: string; text: string }[]>('bot-outbox') ?? []), { user, text }]);
  }

  async destroy(admin: string | undefined): Promise<Outcome<object>> {
    if (!(await this.makerOk(admin))) return fail(403, 'Only whoever made the poll can delete it.');
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
