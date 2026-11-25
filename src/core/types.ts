export type Mode = 'weekly' | 'dates';
export type SlotSize = 15 | 30 | 60;

/** What the poll's creator chooses. Times are minutes after midnight in the poll's own time zone. */
export interface PollSettings {
  title: string;
  notes: string;
  mode: Mode;
  /** weekly: 'w0'…'w6' (0 = Sunday); dates: 'YYYY-MM-DD'. Each is the key of one column. */
  days: string[];
  start: number;
  /** At or before `start`, the window runs past midnight into the next day. */
  end: number;
  slot: SlotSize;
  tz: string;
  /** Roles people can pick, such as tank, healer, dps. Empty turns roles off. */
  roles: string[];
  /** How long a raid (or whatever is being planned) runs, in minutes: the length best times look for. */
  length: number;
}

export interface Poll extends PollSettings {
  id: string;
  created: number;
  updated: number;
}

/** 2 = available, 1 = if needed. Slots without a mark are unavailable. */
export type Mark = 1 | 2;
export type Marks = Record<string, Mark>;

export interface Person {
  id: string;
  name: string;
  roles: string[];
  /** Free text, such as a class and spec. Empty when not given. */
  spec: string;
  /** Anything they'd like the organizer to know, such as "Fridays I'm 30 minutes late". Empty when not given. */
  note: string;
  marks: Marks;
  hasPassword: boolean;
  updated: number;
}

export interface PollState {
  poll: Poll;
  people: Person[];
  version: number;
}
