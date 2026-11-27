// Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them. Set with `wrangler secret put`.
interface Env {
  /** The Discord app's client secret, for signing in with Discord. Missing on the preview Worker. */
  DISCORD_CLIENT_SECRET?: string;
  /** Where the site is, when that isn't the request's own origin: `wrangler dev` reports the live route's. */
  SITE_ORIGIN?: string;
}
