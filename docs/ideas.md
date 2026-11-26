# Where muster could go

Ideas, not commitments. Nothing here is built unless it says so. Written on November 26, 2026,
13 days before WoW Forever's raids open on December 9.

## The idea in one line

Raid sign-up bots begin once someone has already picked "Thursday 8pm". Muster finds the Thursday.
Grown up, it covers the whole loop:

**find the time → lock it in → weekly sign-ups → notice the drift → find a new time**

The usual Discord tools cover only the middle of that loop. Nothing helps a guild choose its nights,
or notices when those nights stop working.

## Principles

- **Planning happens on the web; Discord is for reaching people.** Grids, rosters and groups need
  room, and Discord messages are cramped. Discord gets short posts with buttons, and every post links
  to the page.
- **Availability comes before sign-ups.** Every new feature should use what people already marked,
  rather than ask them again.
- **Ask people as little as possible.** One poll, then a tap a week. No forms to fill in again.
- **Gentle with people.** Muster shows who is free, not who is unreliable. Nothing shames anyone in
  public.
- **The same calm look.** One view at a time, no dashboards of everything at once (see PR #10).

## 1. Additions to what exists now

These sit on top of today's polls and need no Discord.

**Who hasn't answered.** The organizer pastes the guild's names once. Everyone view lists who still
hasn't answered, and a button copies a Discord message with their @names. Names are matched loosely,
and anyone the list misses can be matched by hand. Discord sign-in (section 3) later fills the list
on its own.

**What a time still needs.** Best times says "needs 1 more tank", not just "0 tank". The poll knows
the raid it's for. Barrow Deeps is 10 players, Hyjal 20 and Onyxia 40, and each size has a usual
make-up the organizer can change (for example 2 tanks, 5 healers and 13 dps for 20). Each window then
reads "fills a 20: 18 of 20, needs 1 tank, 1 healer".

**Raid size in best times.** A window that fills a 10 is worth showing even when it can't fill a 40.
With a size set, best times ranks the windows that fill it first, then those nearest to filling it.

**Faction.** If WoW Forever splits paladins and shamans by faction as Classic did, a poll can choose
Alliance or Horde and hide the other class. Check this before building it.

**Answers that fade.** In a weekly poll, an answer older than about four weeks shows dimmer to the
organizer, and its owner sees "still right?" with a one-tap "yes" next time they open the poll.
Schedules change after launch, and stale answers quietly mislead.

**Alts.** A person can add a second character, with its own class and specs, sharing the same times.
The class counts use the main by default. A raid group (section 4) can use the alt instead.

**Raid needs.** An optional checklist the organizer sets, such as "a druid or mage for decursing" or
"2 warlocks". Each best window ticks off what it covers. It stays a short list the organizer writes,
not a built-in rule book.

**A live link preview.** The image Discord shows for a poll's link becomes the poll's own street,
lit by real answers, with "14 answered". Discord stores the image for a while, so the link carries a
version number that changes as answers come in.

**The night view.** An optional way to show Everyone: the street of houses from the home page, in
place of the grid. It's the same data. It's mostly for the look, but it may also read more easily
for people who find grids hard.

**Done:** the December 9 countdown on the home page (PR #11).

## 2. Lock it in: from poll to schedule

The organizer picks the winning time. The poll becomes the guild's raid schedule. Nobody needs a new
link.

- **A banner on the poll**, such as "Raid: Thursdays 8–11pm Eastern". Each person sees it in their
  own time zone, with the next raid's countdown.
- **A calendar feed.** Each person gets a subscribe link that their phone or Google Calendar keeps up
  to date. When the raid moves, the calendar moves with it. A one-off "add to calendar" file is there
  too.
- **This week: in, out or late.** It's one tap. "In" is already the default for anyone whose marked
  times cover the raid. People only act when something changes.
- **The roster for each raid night**, built from the ins: role counts, class mix, the raid's needs.
  When more sign in than the raid holds, the extras go on standby, in the order the organizer
  chooses.
- **A change of plans** (moved, cancelled or an extra night) shows on the poll, in the calendar feed
  and, later, in Discord.
- **Several raids.** One poll can lock in more than one slot, such as Hyjal on Thursday and Onyxia on
  Sunday, each with its own roster.

## 3. Discord

Discord can send slash commands and button presses to a web address. It doesn't need a bot program
running all the time. So all of this runs on the same Cloudflare Worker, at no extra cost at guild
scale.

**Sign in with Discord.** This replaces typing a name.
- Claiming yourself on a second device just works.
- People can be @'d.
- The guild's member list makes "who hasn't answered" automatic.
- Typing a name stays possible for anyone who would rather not sign in.

**Commands.**
- `/muster poll`: start a poll, or post an existing one, as a card showing the lit street and
  "14/25 answered". The card updates as people answer.
- `/muster raid`: post this week's raid, with in, out and late buttons that update the roster on the
  page.
- `/muster who`: the people who haven't answered yet, visible only to the organizer.

**Posts the bot makes.** Each is off unless the guild turns it on.
- A thread for each raid night, with the roster and a link to it.
- One reminder an hour before the raid, to the people who said they're in.
- One reminder a week to people who haven't answered, sent to them directly if they agreed to that,
  otherwise to the organizer.
- **Drift.** When enough answers change, it posts something like "Thursday now works for 12 of 20;
  Wednesday works for 17. Look?" This is the part no other tool does.

**Discord roles.** A guild can map its Discord roles to raid groups or to "officer", so the right
people can edit.

## 4. Raid groups and lockouts

This builds on the planning tool discussed earlier, and it waits for the lockouts to be announced.

- **Groups.** The organizer drags people into Group A, Group B and so on. Each group gets its own
  best nights, role counts, class mix and needs. Someone in two groups (perhaps on an alt) is checked
  for clashes.
- **A suggested split.** Muster proposes groups that each fill their raid size, balance roles and
  share the most nights. The organizer adjusts it rather than starting from nothing.
- **A lockout planner.** Once the resets for Barrow Deeps, Hyjal and Onyxia are known, it plans which
  night covers which raid for each group across the lockout, so nobody is booked twice for one reset.
- **Officers.** Several people can edit the plan, either through a shared private link (as now) or
  through Discord roles.

## 5. After the raid

- **Attendance**, from the in/out taps and the raid night roster, visible only to officers. It
  answers "who has missed the last three", not "rank everyone".
- **Benching fairly.** When there are more ins than places, it shows who sat out last time, so the
  same person isn't benched every week.

## Not doing

Loot, DKP, logs, gear checks and raid strategy. Other tools do these well, and they would pull muster
away from the one thing it's best at: the people and the time.

## How it would be built

- **Discord commands and buttons** arrive at the Worker as signed web requests. The Worker checks
  each signature with Discord's public key and answers within three seconds; slower work continues
  after the reply.
- **Sign in with Discord** is standard Discord login, with the `identify` and `guilds.members.read`
  permissions. Muster stores each person's Discord ID with the person in the poll's Durable Object.
- **A Durable Object for each Discord guild** holds its settings, its member list and its polls.
  Durable Object alarms send the reminders and run the drift checks, so no separate scheduler is
  needed.
- **The live preview image** has to be a PNG, because Discord won't show SVG. Turning the street
  into a PNG on the Worker needs a small image library; that's a dependency, and it would have to
  earn its place.
- **The calendar feed** is a plain-text calendar file at a private address for each person, served by
  the Worker.
- **Discord verification:** once the bot is in 100 servers, Discord requires an identity check and a
  privacy policy. A guild-only bot never gets there.

## A possible order

1. **Before December 9:** who hasn't answered, what a time still needs, raid size in best times. These
   are small, use no Discord, and help the pilot right away.
2. **Launch week:** lock it in, this week's in/out/late, the calendar feed.
3. **Next:** Discord sign-in, `/muster poll` and `/muster raid`, reminders.
4. **Once the lockouts are announced:** raid groups, the lockout planner, drift.
5. **Later:** alts, answers that fade, attendance, the live preview image, the night view.

## Open questions for Faye

- **Your guild or any guild?** Guild-only skips Discord verification, a public listing and
  multi-server admin, and is much faster.
- **One organizer or several officers** for raid groups?
- **Does WoW Forever split paladin and shaman by faction?**
- **How much should the bot post** without being asked? The plan above defaults to almost nothing.
- **A name.** "Muster" works as a bot name too, and `/muster raid` reads well.
