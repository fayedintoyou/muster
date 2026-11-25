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
(`.github/workflows/deploy.yml`). Pushes to other branches and pull requests run the tests only. There
are no preview deploys: a Worker preview would share the live polls' Durable Objects.

Unlike the room and lineage, which are private and run on the Mac's self-hosted runners, muster is a
public repository, so its jobs run on GitHub's own machines: free for public repositories, and they
never run a stranger's pull request on the Mac. Secrets aren't given to pull requests.

The first deploy was by hand from the Mac on 2026-11-25. That's when the account's workers.dev subdomain,
`fayelore.workers.dev`, was created: Cloudflare won't take a Worker with Durable Objects without one,
even with no workers.dev route. The room and lineage are Pages projects (`*.pages.dev`), so they never
needed one.

## One-time setup

1. **Make a token.** The room and lineage's token only has *Cloudflare Pages · Edit*, so muster has its
   own: Cloudflare → My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** template.
   Account resources: this account. Zone resources: Specific zone → fayelore.com.
2. **Give GitHub the secrets** (`gh secret set` asks for the value without showing it):

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN -R fayedintoyou/muster      # paste the token
   security find-generic-password -a "$USER" -s CLOUDFLARE_ACCOUNT_ID -w | tr -d '\n' | gh secret set CLOUDFLARE_ACCOUNT_ID -R fayedintoyou/muster
   gh workflow run deploy.yml -R fayedintoyou/muster --ref main
   ```

Until both secrets are set, the deploy job is skipped with a warning and the tests still run.

To deploy by hand from the Mac instead:

```sh
npm ci
npx wrangler login     # once, if this Mac isn't logged in to Cloudflare
npm run deploy         # vite build && wrangler deploy
```

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
