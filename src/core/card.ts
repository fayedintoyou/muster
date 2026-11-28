import type { Alt, Person, PollSettings } from './types';
import type { Raid, RaidNight } from './raid';
import { type EventSignups, type Roster, type Seats, type Signup, LATE_STEPS, playing, roster } from './signup';
import { classLabel, specsFor } from './classes';
import { MINUTE } from './time';
import { formatRange } from './format';

// The raid card: one Discord message for one night of one raid, which the bot posts once and then edits as
// people sign up. Built here from the poll's own state, so the card and the page never disagree.
//
// Buttons carry the poll, the raid and the night in their custom_id ('m:<poll>:<owner>:<night>:<what>'),
// so a press finds its way back without the bot keeping any index of its own.

export interface DiscordMessage {
  content?: string;
  embeds?: object[];
  components?: object[];
  allowed_mentions?: { parse?: string[]; roles?: string[]; users?: string[] };
  flags?: number;
}

/** Ephemeral: only the person who pressed sees the reply. */
export const EPHEMERAL = 64;

const BUTTON = 2;
const ROW = 1;
const STYLE = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 } as const;

/** The lamp colour from the page, for the card's edge; dim once a night is called off. */
const LAMP = 0xf2c46d;
const DIM = 0x5b6170;

/**
 * What a button does: sign up (in, late, tentative, out); late by so many minutes; ask which spec, then
 * play the class's nth spec or the usual ones; ask which character, then play an alt (by id) or the main.
 */
export type Press =
  | 'in'
  | 'late'
  | 'tentative'
  | 'out'
  | `late${number}`
  | 'spec'
  | `spec${number}`
  | 'usual'
  | 'alt'
  | `alt${string}`
  | 'main';

export function customId(poll: string, owner: string, night: string, press: Press): string {
  return `m:${poll}:${owner}:${night}:${press}`;
}

export function parseCustomId(id: string): { poll: string; owner: string; night: string; press: Press } | null {
  const m = id.match(/^m:([a-z0-9]{8}):([a-z0-9]{4,8}):(\d{4}-\d{2}-\d{2}):(in|late|tentative|out|late\d{1,2}|spec|spec\d|usual|alt|alt[a-z0-9]{4}|main)$/);
  if (!m) return null;
  const press = m[4] as Press;
  if (press.startsWith('late') && press !== 'late' && !LATE_STEPS.includes(Number(press.slice(4)))) return null;
  return { poll: m[1], owner: m[2], night: m[3], press };
}

/** Names that can't break out of Discord's markdown. */
export function plain(text: string): string {
  return text.replace(/[\\*_~`|>#@[\]()<:]/g, '').trim() || '?';
}

const ROLE_LABEL: Record<string, string> = { tank: 'Tanks', healer: 'Healers', dps: 'DPS' };
const label = (role: string) => ROLE_LABEL[role] ?? role.charAt(0).toUpperCase() + role.slice(1);

/** "Faye · priest", "Alty (Faye) · holy paladin": an alt says whose it is, and a spec for the night shows. */
function who(p: Person | undefined, signup: Signup | undefined, roles: string[], extra = ''): string {
  if (!p) return '?';
  const now = playing(p, signup, roles);
  const name = now.alt ? `${plain(now.name)} (${plain(p.name)})` : plain(p.name);
  const cls = now.changed ? classLabel(now.cls, now.specs) : now.cls;
  return `${name}${cls ? ` · ${cls}` : ''}${extra}`;
}

/** A list for one field, kept under Discord's 1024 characters. */
function list(lines: string[]): string {
  if (!lines.length) return '—';
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const next = out ? `${out}\n${lines[i]}` : lines[i];
    if (next.length > 980) return `${out}\n…and ${lines.length - i} more`;
    out = next;
  }
  return out;
}

export interface CardInput {
  poll: Pick<PollSettings, 'title' | 'tz' | 'realm' | 'size' | 'makeup' | 'slot' | 'roles' | 'mode'> & { id: string };
  people: Person[];
  /** The team or event whose raid this is, or null for the poll's own. */
  team: (Seats & { id: string; name: string }) | null;
  /** Lines under the time, such as who an event is for and its note. */
  detail?: string[];
  /** The title it was posted with, for a card whose raid or event is gone. */
  title?: string;
  raid: Pick<Raid, 'start' | 'minutes'>;
  night: RaidNight;
  event: EventSignups | undefined;
  /** The poll's page. */
  url: string;
  /** A night no longer on: called off, or the raid moved or unlocked. */
  gone?: 'off' | 'moved';
}

export function cardTitle(input: Pick<CardInput, 'poll' | 'team' | 'night'>): string {
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: input.poll.tz }).format(
    input.night.start,
  );
  return `${plain(input.team?.name ?? input.poll.title)} · ${day}`;
}

export function raidCard(input: CardInput): DiscordMessage {
  const { poll, people, team, night, url } = input;
  const s = Math.floor(night.start / 1000);
  const e = Math.floor(night.end / 1000);
  const server = poll.realm ? ` · ${formatRange(night.start, night.end, poll.realm, true)} server time` : '';
  const lines = [`<t:${s}:F> – <t:${e}:t> (<t:${s}:R>)${server}`];
  if (input.detail) lines.push(...input.detail.map((d) => plain(d)).filter((d) => d !== '?'));
  else if (team && poll.title !== team.name) lines.push(plain(poll.title));

  if (input.gone) {
    return {
      embeds: [
        {
          title: `${input.gone === 'off' ? 'Called off' : 'Moved'}: ${input.title ?? cardTitle(input)}`,
          description: `~~${lines[0]}~~\n${input.gone === 'off' ? 'This night is off.' : 'This raid has a new time: see muster.'}`,
          color: DIM,
          url,
        },
      ],
      components: [{ type: ROW, components: [{ type: BUTTON, style: STYLE.link, label: 'open muster', url }] }],
    };
  }

  const byId = new Map(people.map((p) => [p.id, p]));
  const r: Roster = roster(people, input.event, input.raid, team, poll);
  const signups = input.event?.people ?? {};
  const lateNote = (id: string) => (signups[id]?.status === 'late' ? ` (${signups[id].late}m late)` : '');
  const fields: object[] = [];
  const roles = Object.keys(r.seating.want).length ? Object.keys(r.seating.want) : [...new Set(r.seating.seated.map((x) => x.role))];
  for (const role of roles) {
    const seated = r.seating.seated.filter((x) => x.role === role);
    const want = r.seating.want[role];
    fields.push({
      name: `${label(role || 'seated')} ${want !== undefined ? `${seated.length}/${want}` : seated.length}`,
      value: list(seated.map((x) => who(byId.get(x.id), signups[x.id], poll.roles, lateNote(x.id)))),
      inline: true,
    });
  }
  if (r.standby.length) {
    fields.push({ name: `Standby ${r.standby.length}`, value: list(r.standby.map((id) => who(byId.get(id), signups[id], poll.roles, lateNote(id)))) });
  }
  if (r.tentative.length) {
    fields.push({ name: `Maybe ${r.tentative.length}`, value: list(r.tentative.map((id) => who(byId.get(id), signups[id], poll.roles))) });
  }
  if (r.out.length) fields.push({ name: `Out ${r.out.length}`, value: list(r.out.map((id) => plain(byId.get(id)?.name ?? '?'))) });

  const size = team ? team.size : poll.size;
  const seatedCount = r.seating.seated.length;
  const footer = size
    ? `${seatedCount} of ${size} seated${r.unanswered.length ? ` · ${r.unanswered.length} yet to answer` : ''}`
    : `${seatedCount} coming${r.unanswered.length ? ` · ${r.unanswered.length} yet to answer` : ''}`;

  const id = (press: Press) => customId(poll.id, team?.id ?? 'raid', night.night, press);
  return {
    embeds: [
      {
        title: cardTitle(input),
        url,
        description: lines.join('\n'),
        color: LAMP,
        fields,
        footer: { text: `${footer} · tap below, or answer on muster` },
      },
    ],
    components: [
      {
        type: ROW,
        components: [
          { type: BUTTON, style: STYLE.success, label: 'in', custom_id: id('in') },
          { type: BUTTON, style: STYLE.primary, label: 'late', custom_id: id('late') },
          { type: BUTTON, style: STYLE.secondary, label: 'maybe', custom_id: id('tentative') },
          { type: BUTTON, style: STYLE.danger, label: 'out', custom_id: id('out') },
          { type: BUTTON, style: STYLE.link, label: 'muster', url },
        ],
      },
      {
        type: ROW,
        components: [
          { type: BUTTON, style: STYLE.secondary, label: 'change spec', custom_id: id('spec') },
          { type: BUTTON, style: STYLE.secondary, label: 'on my alt', custom_id: id('alt') },
        ],
      },
    ],
  };
}

/** "Which spec?", for one night: the character's class's specs, and back to their usual ones. */
export function specAsk(poll: string, owner: string, night: string, cls: string, current: string[] | undefined): DiscordMessage {
  return {
    flags: EPHEMERAL,
    content: `Which spec this night, on your ${cls}?`,
    components: [
      {
        type: ROW,
        components: [
          ...specsFor(cls).map((spec, i) => ({
            type: BUTTON,
            style: current?.length === 1 && current[0] === spec ? STYLE.success : STYLE.primary,
            label: spec,
            custom_id: customId(poll, owner, night, `spec${i}`),
          })),
          { type: BUTTON, style: current?.length ? STYLE.secondary : STYLE.success, label: 'my usual', custom_id: customId(poll, owner, night, 'usual') },
        ],
      },
    ],
  };
}

/** "Which character?": their alts and their main. */
export function altAsk(poll: string, owner: string, night: string, main: string, alts: Alt[], current: string | undefined): DiscordMessage {
  return {
    flags: EPHEMERAL,
    content: 'Which character this night?',
    components: [
      {
        type: ROW,
        components: [
          ...alts.map((a) => ({
            type: BUTTON,
            style: current === a.id ? STYLE.success : STYLE.primary,
            label: `${a.name} · ${a.cls || 'alt'}`.slice(0, 80),
            custom_id: customId(poll, owner, night, `alt${a.id}`),
          })),
          { type: BUTTON, style: current ? STYLE.secondary : STYLE.success, label: `${main} (main)`.slice(0, 80), custom_id: customId(poll, owner, night, 'main') },
        ],
      },
    ],
  };
}

/** "How late?", for whoever pressed late: their own, ephemeral, row of steps. */
export function lateAsk(poll: string, owner: string, night: string): DiscordMessage {
  return {
    flags: EPHEMERAL,
    content: 'How late will you be?',
    components: [
      {
        type: ROW,
        components: LATE_STEPS.map((m) => ({
          type: BUTTON,
          style: STYLE.primary,
          label: m < 60 ? `${m} min` : m === 60 ? '1 hour' : `${m / 60} hours`,
          custom_id: customId(poll, owner, night, `late${m}`),
        })),
      },
    ],
  };
}

/** The ping that goes with a new card: the team's role, or each of its people linked to Discord. */
export function pingFor(role: string, users: string[]): Pick<DiscordMessage, 'content' | 'allowed_mentions'> {
  if (role) return { content: `<@&${role}>`, allowed_mentions: { roles: [role] } };
  if (!users.length) return { allowed_mentions: { parse: [] } };
  const capped = users.slice(0, 100);
  return { content: capped.map((u) => `<@${u}>`).join(' '), allowed_mentions: { users: capped } };
}

/** A short line pinging people, for reminders and changes. Empty when there's no one to tell. */
export function notice(text: string, users: string[]): DiscordMessage | null {
  if (!users.length) return null;
  const capped = users.slice(0, 100);
  return { content: `${capped.map((u) => `<@${u}>`).join(' ')}\n${text}`, allowed_mentions: { users: capped } };
}

export const DAY = 24 * 60 * MINUTE;
