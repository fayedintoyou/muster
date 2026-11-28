// Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them. Set with `wrangler secret put`.
interface Env {
  /** The Discord app's client secret, for signing in with Discord. Missing on the preview Worker. */
  DISCORD_CLIENT_SECRET?: string;
  /** The bot's token, for posting and editing raid cards. Without it the bot stays quiet. */
  DISCORD_BOT_TOKEN?: string;
  /** The app's public key (hex), which every request from Discord is signed with. */
  DISCORD_PUBLIC_KEY?: string;
  /** Where the site is, when that isn't the request's own origin: `wrangler dev` reports the live route's. */
  SITE_ORIGIN?: string;
}
