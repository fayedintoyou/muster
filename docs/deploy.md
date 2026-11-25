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

## First deploy: pick one

### From the Cloudflare dashboard (works from a phone)

1. Cloudflare → **Workers & Pages** → **Create** → **Import a repository**.
2. Pick `fayedintoyou/muster`. If Cloudflare asks, let its GitHub app (“Cloudflare Workers and Pages”)
   see that repository.
3. Keep the project name **muster** (it must match `name` in `wrangler.jsonc`). Set the build command to
   `npm run build`; leave the deploy command as `npx wrangler deploy`.
4. **Deploy.** The first build takes a minute or two; then https://muster.fayelore.com is live.

This also sets up deploy-on-push: every push to `main` builds and deploys. The build token Cloudflare
creates for it can edit Workers routes on the account's zones, which is what the custom domain needs.
Workers Builds' free allowance is 3,000 build minutes a month.

### From the Mac

```sh
git clone https://github.com/fayedintoyou/muster && cd muster
npm ci
npx wrangler login     # once, if this Mac isn't logged in to Cloudflare
npm run deploy         # vite build && wrangler deploy
```

To get deploy-on-push afterwards, connect the existing Worker: **Workers & Pages** → `muster` →
**Settings** → **Builds** → **Connect**, with the same build and deploy commands as above.

### From GitHub Actions instead

The room and lineage deploy from Actions on the Mac's self-hosted runners with a token limited to
*Cloudflare Pages · Edit*. That token can't deploy a Worker. To do it the same way here you'd need a token
with *Account · Workers Scripts · Edit* and *Zone · Workers Routes · Edit* for fayelore.com, the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets on this repository, and a runner registered to
it. Workers Builds needs none of that, so it's the suggested route.

## Checking

```sh
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
