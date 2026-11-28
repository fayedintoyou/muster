import type { Result } from './validate';

// The bot's settings for one poll: which Discord server and channel its raid posts go to, and the guild's
// own choices about when posts go up, reminders, and who each raid pings. Every choice has a default and
// each guild can change it; none are decided by muster.

export interface BotLink {
  guild: string;
  guildName: string;
  channel: string;
  channelName: string;
  /** The Discord account that connected it. */
  by: string;
  at: number;
  settings: BotSettings;
}

export interface BotSettings {
  /** Days before a night that its post goes up. */
  lead: number;
  /** Minutes before a night that those coming are reminded in the channel. 0: no reminder. */
  remind: number;
  /** Hours before a night that people in the raid who haven't answered get a private nudge. 0: none. */
  nudge: number;
  /** Who a new post pings, by raid ('raid' or a team's id): a role's id, 'members' or 'none'. */
  pings: Record<string, string>;
}

export const LEAD_DAYS = [1, 2, 3, 4, 5, 6, 7];
export const REMIND_MINUTES = [0, 15, 30, 60, 120];
export const NUDGE_HOURS = [0, 12, 24, 48];

export const DEFAULT_SETTINGS: BotSettings = { lead: 6, remind: 0, nudge: 0, pings: {} };

/** Ids Discord uses for servers, channels, roles and people. */
export const SNOWFLAKE = /^\d{5,25}$/;

/** Who a raid's new posts ping: its team's people linked to Discord unless the guild picked otherwise. */
export function pingOf(settings: BotSettings, owner: string): string {
  return settings.pings[owner] ?? 'members';
}

export function validateBotSettings(input: unknown, owners: ReadonlySet<string>, before: BotSettings): Result<BotSettings> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Missing the settings.' };
  const raw = input as Record<string, unknown>;
  const pick = (value: unknown, fallback: number) => (value === undefined ? fallback : Number(value));
  const lead = pick(raw.lead, before.lead);
  if (!LEAD_DAYS.includes(lead)) return { ok: false, error: 'Posts go up 1 to 7 days ahead.' };
  const remind = pick(raw.remind, before.remind);
  if (!REMIND_MINUTES.includes(remind)) return { ok: false, error: 'Unknown reminder time.' };
  const nudge = pick(raw.nudge, before.nudge);
  if (!NUDGE_HOURS.includes(nudge)) return { ok: false, error: 'Unknown nudge time.' };
  const pings: Record<string, string> = {};
  for (const [owner, ping] of Object.entries({ ...before.pings, ...(raw.pings && typeof raw.pings === 'object' ? raw.pings : {}) })) {
    if (!owners.has(owner)) continue;
    if (ping !== 'members' && ping !== 'none' && !(typeof ping === 'string' && SNOWFLAKE.test(ping))) {
      return { ok: false, error: 'Ping a role, the raid’s people, or no one.' };
    }
    if (ping !== 'members') pings[owner] = ping as string;
  }
  return { ok: true, value: { lead, remind, nudge, pings } };
}
