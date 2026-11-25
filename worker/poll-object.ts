import { DurableObject } from 'cloudflare:workers';
import type { Person, Poll, PollSettings, PollState } from '../src/core/types';
import { slotKeys } from '../src/core/slots';
import {
  LIMITS,
  cleanMarks,
  cleanPersonRoles,
  cleanNote,
  cleanSpec,
  nameKey,
  validateName,
  validatePassword,
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
  /** Missing on people who answered before there was a spec. */
  spec?: string;
  /** Missing on people who answered before there were notes. */
  note?: string;
  marks: Person['marks'];
  salt?: string;
  pass?: string;
  /** Hashes of this person's sign-in tokens, newest last: one per device. */
  tokens: string[];
  created: number;
  updated: number;
}

export type Failure = { ok: false; status: number; error: string; exists?: boolean; hasPassword?: boolean };
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
  spec?: unknown;
  note?: unknown;
  /** Times marked before joining, so a new person's answers arrive in one step. */
  marks?: unknown;
  /** Sign in as an existing person of that name. */
  claim?: unknown;
}

export interface SaveInput {
  marks?: unknown;
  roles?: unknown;
  spec?: unknown;
  note?: unknown;
  name?: unknown;
  password?: unknown;
}

const MAX_TOKENS = 8;

function fail(status: number, error: string, extra: Partial<Failure> = {}): Failure {
  return { ok: false, status, error, ...extra };
}

function publicPerson(p: StoredPerson): Person {
  return {
    id: p.id,
    name: p.name,
    roles: p.roles,
    spec: p.spec ?? '',
    note: p.note ?? '',
    marks: p.marks,
    hasPassword: Boolean(p.pass),
    updated: p.updated,
  };
}

export class PollObject extends DurableObject<Env> {
  private get kv() {
    return this.ctx.storage.kv;
  }

  private poll(): Poll | undefined {
    return this.kv.get<Poll>('poll');
  }

  private people(): StoredPerson[] {
    const out: StoredPerson[] = [];
    for (const [, p] of this.kv.list<StoredPerson>({ prefix: 'p:' })) out.push(p);
    return out.sort((a, b) => a.created - b.created);
  }

  private bump(): number {
    const v = (this.kv.get<number>('version') ?? 0) + 1;
    this.kv.put('version', v);
    return v;
  }

  private state(): PollState | null {
    const poll = this.poll();
    if (!poll) return null;
    return { poll, people: this.people().map(publicPerson), version: this.kv.get<number>('version') ?? 0 };
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

  async join(input: JoinInput): Promise<Outcome<{ person: Person; token: string; state: PollState }>> {
    const name = validateName(input.name);
    if (!name.ok) return fail(400, name.error);
    const password = validatePassword(input.password);
    if (!password.ok) return fail(400, password.error);
    const key = nameKey(name.value);

    const token = randomToken();
    const tokenHash = await sha256(token);
    const existingBefore = this.people().find((p) => p.key === key);

    if (existingBefore) {
      if (input.claim !== true) {
        return fail(409, `${existingBefore.name} has already answered.`, {
          exists: true,
          hasPassword: Boolean(existingBefore.pass),
        });
      }
      if (existingBefore.pass) {
        if (!password.value) return fail(401, `${existingBefore.name} is locked with a password.`, { hasPassword: true });
        const { hash } = await hashPassword(password.value, existingBefore.salt);
        if (!sameHash(hash, existingBefore.pass)) return fail(403, 'That password doesn’t match.', { hasPassword: true });
      }
      // No await from here: re-read and write in one step.
      const current = this.kv.get<StoredPerson>(`p:${existingBefore.id}`);
      if (!current) return fail(409, 'That person was just removed. Try again.');
      current.tokens = [...current.tokens, tokenHash].slice(-MAX_TOKENS);
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
      if (changed) this.bump();
      return { ok: true, person: publicPerson(current), token, state: this.state()! };
    }

    const secret = password.value ? await hashPassword(password.value) : undefined;
    const poll = this.poll();
    if (!poll) return fail(404, 'This poll doesn’t exist.');
    const people = this.people();
    if (people.some((p) => p.key === key)) return fail(409, `${name.value} has already answered.`, { exists: true });
    if (people.length >= LIMITS.people) return fail(400, `This poll is full (${LIMITS.people} people).`);
    const marks = input.marks === undefined ? undefined : cleanMarks(input.marks, new Set(slotKeys(poll)));
    if (marks && !marks.ok) return fail(400, marks.error);
    let id = randomId();
    while (this.kv.get(`p:${id}`)) id = randomId();
    const now = Date.now();
    const person: StoredPerson = {
      id,
      name: name.value,
      key,
      roles: cleanPersonRoles(input.roles, poll.roles),
      spec: cleanSpec(input.spec),
      note: cleanNote(input.note),
      marks: marks?.ok ? marks.value : {},
      salt: secret?.salt,
      pass: secret?.hash,
      tokens: [tokenHash],
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
    if (input.roles !== undefined) person.roles = cleanPersonRoles(input.roles, poll.roles);
    if (input.spec !== undefined) person.spec = cleanSpec(input.spec);
    if (input.note !== undefined) person.note = cleanNote(input.note);
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
    }
    person.updated = Date.now();
    this.kv.put(`p:${person.id}`, person);
    return { ok: true, person: publicPerson(person), version: this.bump() };
  }

  async removePerson(personId: string, auth: Auth): Promise<Outcome<{ version: number }>> {
    const tokenHash = auth.token ? await sha256(auth.token) : undefined;
    const isAdmin = await this.adminOk(auth.admin);
    const person = this.kv.get<StoredPerson>(`p:${personId}`);
    if (!person) return fail(404, 'That person isn’t in this poll any more.');
    const mine = tokenHash !== undefined && person.tokens.some((t) => sameHash(t, tokenHash));
    if (!mine && !isAdmin) return fail(403, 'Only they, or whoever made the poll, can remove them.');
    this.kv.delete(`p:${personId}`);
    return { ok: true, version: this.bump() };
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
    // Roles taken away come off people too.
    if (next.roles.join() !== poll.roles.join()) {
      for (const p of this.people()) {
        const roles = p.roles.filter((r) => next.roles.includes(r));
        if (roles.length !== p.roles.length) this.kv.put(`p:${p.id}`, { ...p, roles });
      }
    }
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
