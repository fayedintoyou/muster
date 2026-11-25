// What this browser remembers: who you are in each poll, your name and roles for the next one, your
// time zone, and the polls you've opened. All of it lives in localStorage; nothing here is required.

export interface Membership {
  personId?: string;
  token?: string;
  admin?: string;
}

export interface RecentPoll {
  id: string;
  title: string;
  seen: number;
  admin?: boolean;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or full storage: the page still works, it just won't remember.
  }
}

export const store = {
  membership(pollId: string): Membership {
    return read<Membership>(`muster:poll:${pollId}`, {});
  },
  setMembership(pollId: string, m: Membership): void {
    write(`muster:poll:${pollId}`, m);
  },
  lastName(): string {
    return read<string>('muster:name', '');
  },
  setLastName(name: string): void {
    write('muster:name', name);
  },
  lastRoles(): string[] {
    return read<string[]>('muster:roles', []);
  },
  setLastRoles(roles: string[]): void {
    write('muster:roles', roles);
  },
  lastClass(): string {
    return read<string>('muster:class', '');
  },
  setLastClass(cls: string): void {
    write('muster:class', cls);
  },
  lastSpecs(): string[] {
    return read<string[]>('muster:specs', []);
  },
  setLastSpecs(specs: string[]): void {
    write('muster:specs', specs);
  },
  lastSpec(): string {
    return read<string>('muster:spec', '');
  },
  setLastSpec(spec: string): void {
    write('muster:spec', spec);
  },
  zone(): string | undefined {
    return read<string | undefined>('muster:tz', undefined);
  },
  setZone(tz: string | undefined): void {
    write('muster:tz', tz);
  },
  recent(): RecentPoll[] {
    return read<RecentPoll[]>('muster:recent', []);
  },
  remember(poll: { id: string; title: string }, admin = false): void {
    const list = store.recent().filter((p) => p.id !== poll.id);
    const before = store.recent().find((p) => p.id === poll.id);
    list.unshift({ id: poll.id, title: poll.title, seen: Date.now(), admin: admin || before?.admin });
    write('muster:recent', list.slice(0, 12));
  },
  forget(pollId: string): void {
    write('muster:recent', store.recent().filter((p) => p.id !== pollId));
    write(`muster:poll:${pollId}`, undefined);
  },
};

export function detectedZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
