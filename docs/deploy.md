# Deploying to muster.fayelore.com

muster is one Cloudflare Worker named `muster`. It serves the built page from `dist/` as static
assets, answers `/api/*`, and fills in each poll page's link preview. Every poll lives in its own
SQLite-backed Durable Object (`PollObject`). There's no database to create: `wrangler deploy` makes the
Worker, the Durable Object class and the `muster.fayelore.com` custom domain (with its DNS record and
certificate) from `wrangler.jsonc`, because fayelore.com is already on Cloudflare.

Everything fits the Workers Free plan: 100,000 Worker requests and 100,000 Durable Object requests a day,
and 5 GB of Durable Object storage. Pages refresh every 15 seconds while someone's looking (every minute
once they've been idle five minutes, and not at all in a background tab), so a guild of 30 stays far
inside that.

## How it deploys

Every push to `main` runs the tests (unit, typecheck and the Chrome e2e run), then `npm run deploy`
(`.github/workflows/deploy.yml`). Pushes to other branches and pull requests run the tests only.

## Previews

To try a branch before it goes live, deploy it as the separate `muster-preview` Worker (the `preview`
environment in `wrangler.jsonc`):

```sh
npm run deploy:preview     # https://muster-preview.fayelore.workers.dev
```

It has its own Durable Objects, so its polls are separate from the live ones, and its links only work
there. CI doesn't deploy it: it's one shared address, so the last branch deployed wins.

Unlike the room and lineage, which are private and run on the Mac's self-hosted runners, muster is a
public repository, so its jobs run on GitHub's own machines: free for public repositories, and they
never run a stranger's pull request on the Mac. Secrets aren't given to pull requests.

The first deploy was by hand from the Mac on 2026-11-25. That's when the account's workers.dev subdomain,
`fayelore.workers.dev`, was created: Cloudflare won't take a Worker with Durable Objects without one,
even with no workers.dev route. The room and lineage are Pages projects (`*.pages.dev`), so they never
needed one.

## One-time setup

The secrets are the same Cloudflare token and account ID the room and lineage use, kept in the Mac's
login Keychain (services `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`). Despite lineage's notes
calling it Pages-only, the token deploys this Worker too (checked 2026-11-25). Pipe them in without
showing them:

```sh
for s in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do
  security find-generic-password -a "$USER" -s $s -w | tr -d '\n' | gh secret set $s -R fayedintoyou/muster
done
gh workflow run deploy.yml -R fayedintoyou/muster --ref main
```

Until both secrets are set, the deploy job is skipped with a warning and the tests still run.

To deploy by hand from the Mac instead:

```sh
npm ci
npx wrangler login     # once, if this Mac isn't logged in to Cloudflare
npm run deploy         # vite build && wrangler deploy
```

## The Discord bot

The bot is the same Discord app as "sign in with Discord" (`DISCORD_CLIENT_ID` in `wrangler.jsonc`). Discord
sends its slash commands and button presses to `/discord/interactions` on the Worker, so nothing else runs.
It needs two more Worker secrets, and the command registered once:

```sh
# The bot's token: Discord Developer Portal → muster → Bot → Reset Token. Keep it in the Keychain.
security find-generic-password -a "$USER" -s DISCORD_BOT_TOKEN -w | tr -d '\n' | npx wrangler secret put DISCORD_BOT_TOKEN
# Prints the app's public key (not secret) and registers /muster connect.
DISCORD_BOT_TOKEN="$(security find-generic-password -a "$USER" -s DISCORD_BOT_TOKEN -w)" node scripts/discord-setup.mjs
echo <the printed key> | npx wrangler secret put DISCORD_PUBLIC_KEY
# Once the Worker with the key is deployed: Discord checks the address with a signed PING.
DISCORD_BOT_TOKEN="$(security find-generic-password -a "$USER" -s DISCORD_BOT_TOKEN -w)" node scripts/discord-setup.mjs --endpoint
```

Without the token the bot stays quiet and the organizer tab says it isn't set up; the preview Worker has
none. A guild adds the bot and connects a channel from a poll's organizer tab.

## Checking

```sh
gh run list -R fayedintoyou/muster -w "test and deploy" -L 1
curl -sI https://muster.fayelore.com            # 200, served by cloudflare
curl -s https://muster.fayelore.com/e/<id> | grep og:title   # the poll's name, for Discord's preview
npx wrangler tail muster                        # live logs
```

Workers Logs are on (`observability` in `wrangler.jsonc`), so errors also show in the dashboard under the
Worker's **Logs**.

## Changing the address

Edit `routes` in `wrangler.jsonc` (for example `raid.fayelore.com`) and deploy. Polls aren't tied to the
address, but links people already posted would stop working, so add the new address alongside the old
one rather than replacing it.

## Data

- A poll's object holds the poll, everyone's names, roles and marked slots, and hashes of their sign-in
  tokens and optional passwords. Nothing else is stored, and there are no accounts.
- Poll addresses are random (`/e/` and eight characters) and unlisted: anyone with the link can answer.
  The poll pages send `X-Robots-Tag: noindex`.
- Polls don't expire. Their maker can delete one from the poll page (“Change this poll”); that removes
  its object's storage.
