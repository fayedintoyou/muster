# Working on muster

- `src/core/` stays free of React, the DOM and Worker APIs: the page and the Worker both import it,
  and `npm test` runs it in Node. Time-zone work uses Intl only.
- A slot's key (`w2/1260`, `2026-12-01/1470`) is stored in everyone's answers. Don't change its format,
  or what a weekly key's number means: saved answers would point at the wrong times.
- The Worker's rules are the real ones (`src/core/validate.ts`, enforced in `worker/poll-object.ts`);
  the page only explains them early. In the Durable Object, keep reads and writes of one change free of
  any `await` between them, as now, so two people saving at once can't lose answers.
- Renaming or replacing the Durable Object class needs a new entry in `migrations` in `wrangler.jsonc`.
  After changing bindings, run `npm run types`.
- Before pushing: `npm test`, `npm run typecheck`, and `npm run test:e2e`. For any change to how a page
  looks, look at the screenshots in `e2e/shots/` at phone and desktop sizes, and put taste calls in the
  pull request for Faye rather than settling them.
- The look follows the room (fayelore.com): `--night`, `--lamp`, `--moon`, Fraunces and IBM Plex Mono,
  lowercase controls. The glow ramp lives in `src/app/glow.ts`; `scripts/art.mjs` copies it for the link
  preview image.
- Dependencies earn their way in; add one only when a change needs it.
