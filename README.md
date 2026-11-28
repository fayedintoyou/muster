# muster

Find the night everyone can raid. A small when2meet for a guild, at https://muster.fayelore.com.

Make a poll, drop the link in Discord, and everyone marks when they're free. Each person sees the times
in their own time zone, and muster ranks the best windows.

- **Weekly or specific dates.** Weekly polls ask about a typical week, for a standing raid schedule.
- **Nights that run past midnight** stay one column: an 8pm–1am raid is Tuesday night, not two days.
- **Your own time zone**, picked up from the browser and changeable. A 24-hour clock where that's the
  local habit.
- **Painting that works on a phone**: press and drag a rectangle, tap one slot, or tap a night or a
  time to fill the column or row. Holding a drag near the screen's edge scrolls. Answers save as you go.
- **Available or if needed**, two kinds of free.
- **Everyone's answers as lit panes**: brighter means more people free. Hover or tap for who.
- **Best times** for a raid length: the windows the most people can make whole, any later start that
  keeps the same people, who's missing and who can make part of it.
- **Roles** (optional, tank/healer/dps by default): counted for each window, with a red flag on any role
  nobody covers.
- **Leave people out, or mark them must come**: bench an alt, or only show windows the raid leader can make.
- **Copy for Discord**: a `<t:…>` timestamp that Discord shows in each reader's own time.
- **Link previews**: a poll's link unfurls in Discord with its name, nights and how many have answered.
- **A Discord bot**: connect a channel from the organizer tab, and each raid night is posted ahead of time
  with in, late, maybe and out buttons, pinging the team's role or people. The post edits itself as people
  sign up on Discord or the page; called-off and moved nights, reminders, nudges for who hasn't answered,
  and an organizer's seat or bench are all sent on their own.
- **Edit later**: the browser that made the poll can change its name, nights, times or roles, remove
  people, or delete it, and can copy a private link to do the same from another device.

## How it's built

- `src/core/`: plain TypeScript with no DOM: time zones (Intl only), the grid, best windows,
  validation. Shared by the page and the Worker; unit-tested in `src/core/core.test.ts`.
- `src/app/`: the page, React and one stylesheet. The look borrows the room's night, lamp and moon,
  Fraunces and IBM Plex Mono.
- `worker/`: the Cloudflare Worker (`index.ts`: API and link previews) and the Durable Object that
  holds each poll (`poll-object.ts`).
- `e2e/run.mjs`: a browser run in real Chrome: people in New York (phone, touch), Berlin (desktop,
  24-hour clock) and over the API, checking painting, edge scrolling, best times, must-come, Discord
  copy, editing and the unfurl. Screenshots go to `e2e/shots/`.

## Working on it

```sh
npm ci
npm run dev        # build the page, then serve everything on http://localhost:8787
npm run dev:ui     # the page with hot reload on :5173 (run `npx wrangler dev` alongside for the API)
npm test           # unit tests
npm run typecheck
npm run test:e2e   # builds, starts its own wrangler dev, drives Chrome (CHROME=/path/to/chrome)
npm run art        # re-render public/og.png and public/apple-touch-icon.png
```

Deploying: [docs/deploy.md](docs/deploy.md).
