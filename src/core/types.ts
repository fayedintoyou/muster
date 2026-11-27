import type { Raid } from './raid';
import type { Team } from './team';

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
  /** The game server's time zone, shown beside times as "server time". Empty shows none. */
  realm: string;
  /** Roles people can pick, such as tank, healer, dps. Empty turns roles off. */
  roles: string[];
  /** Classes people can pick one of, such as WoW's nine. Empty turns classes off. */
  classes: string[];
  /** How long a raid (or whatever is being planned) runs, in minutes: the length best times look for. */
  length: number;
  /** How many the raid holds, such as 10, 20 or 40. 0: any number. */
  size: number;
  /** With a size: the tanks and healers it wants, as { tank, healer }. Everyone else is dps. */
  makeup: Record<string, number>;
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
  /** One of the poll's classes, or empty. */
  cls: string;
  /** Up to two specs of their class. */
  specs: string[];
  /** Free text from before there were spec buttons, such as "Resto shaman". Empty for anyone since. */
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
  /** The raid locked in from best times, or null while the poll is still finding one. */
  raid: Raid | null;
  /** Raid teams the organizer picked from the people here. */
  teams: Team[];
  version: number;
}
