# Where muster is going

The goal: **replace Raid-Helper for Faye's guild**, starting with WoW Forever, whose raids open on
December 9, 2026. Updated on November 26, 2026, after reviews by GPT-6.2 Astra and Claude, and after
Faye's answers:
- the guild used Raid-Helper;
- the realm runs on Central time;
- the goal is to replace Raid-Helper, not sit in front of it.

Ideas, not commitments, unless marked done.

## Why muster can win

Raid-Helper starts once an officer has already picked "Thursday 8pm", and from then on everyone signs
up again every week. Muster starts earlier and asks less of people:

**find the time → lock it in → one-tap weekly sign-ups → notice the drift → find a new time**

- **People answer once.** Muster already knows each person's class, specs and usual hours, so a weekly
  sign-up is one tap: no rows of emoji, no picking your spec again.
- **It finds the night.** A new tier or a lost healer means "when can we raid now?", and Raid-Helper
  can't answer that.
- **It seats the raid honestly.** Each person takes one seat in a role they play, so "fills the 10"
  means a raid that can actually pull. Done (PR #14).
- **No paywall, and no confusing permissions to set up.**

## Principles

- **Routine actions happen in Discord; planning happens on the web.** Signing up, changing your mind
  and seeing who's coming take one tap on the raid's post. Grids, rosters and groups live on the page,
  and every post links to it.
- **Being free, signing up and turning up are three different facts.** Muster keeps them apart: "usually
  free" comes from the poll, signing up is a tap for each raid, and attendance is recorded afterwards.
- **Ask people as little as possible.** Fill everything from what they've already said.
- **Gentle with people.** Lists of who hasn't answered and attendance are for officers only. Nobody is
  ranked or shamed in public.
- **The same calm look.** One view at a time (PR #10).

## Done

- **The December 9 countdown** on the home page (PR #11).
- **Server time beside every time**, Central by default (PR #13).
- **Raid size and honest seating** (PR #14). A poll can be for 10, 20 or 40, with tanks and healers.
  Best times seats each person once, puts people who are sure before "if needed" ones, and says what a
  window still needs and who the lineup counts on.

## Matching Raid-Helper: what the guild relies on

These are what has to work before the guild can stop using Raid-Helper.

1. **A raid post in Discord.** The bot posts the raid with its date, the times in Discord timestamps and
   server time, the roster so far, and buttons: **in**, **late**, **tentative**, **out**. It's one card,
   which the bot edits as people sign up, so the channel isn't flooded with new posts.
2. **Signing up in one tap.** "In" uses the class and spec muster already knows. "Change spec" and
   "on my alt" are there for anyone who needs them. "Late" asks for an arrival time.
3. **The roster**, on the post and on the page: seated by role and class, with standby, as in PR #14.
   The officer can move people between seated and standby, and the bot tells the people affected.
4. **Recurring raids.** Locking in "Thursdays 8–11pm server time" posts each week's raid on its own, a
   set number of days ahead.
5. **Reminders.** One reminder before the raid to those signed in, and one to people in the raid pool
   who haven't answered for the week. Each guild turns them on and chooses where they go.
6. **Moving or cancelling a raid** edits its post, tells everyone who signed up, and updates their
   calendars.
7. **Officers.** Discord roles decide who can post, edit and move people. Until then, the private link
   to change a poll works as it does now.
8. **Groups for a 40.** Arranging the raid into groups of five, for example for shaman totems or a
   priest in each group. Raid-Helper users expect this for Onyxia.

## Where muster goes further

- **Finding the time**, as now, for a new raid or a new tier.
- **Drift.** When a locked-in night stops working, the officer is told privately, for example "Thursday
  now seats 7 of 10; Wednesday seats 10." Answers that are four weeks old dim and ask "still right?"
  first, so drift is based on current answers.
- **Dated absences.** "Out December 22 to January 2" covers every raid in that span. Launch runs into the
  holidays, so this matters early.
- **The healer who drops out 20 minutes before.** The officer sees which people on standby can heal and
  offers them the seat with one tap. Their acceptance is recorded.
- **Invite time and first pull, shown separately**, so people can plan travel and summons.
- **A calendar feed.** Each person subscribes once, and their calendar follows the raid. Google Calendar
  refreshes feeds only every 12–24 hours, so last-minute moves are still announced in Discord.
- **Raid groups and lockouts.** Group A and Group B each get their own nights and roster, with clash
  checks for anyone in both. Once Barrow Deeps, Hyjal and Onyxia's resets are known, a planner shows
  which night covers which raid. Classic reset 20-player raids every 3 days and 40-player raids every 7,
  so each raid's reset is stored as data and not assumed to be weekly.
- **Alts.** A second character, with its own class and specs, sharing the same times.
- **Attendance**, recorded from the roster after the raid and seen only by officers, so benching stays
  fair: it shows who sat out last time.

## Not doing

Loot, DKP, logs, gear checks and raid strategy. Other tools do these well.

**Cut for now:**
- The live preview image. Discord never refreshes an image in posts it has already shown, and drawing
  one on the Worker likely needs the paid plan.
- The night view.
- An automatic group split. Officers should split groups by hand a few times first.

**Probably not needed:** a faction filter for classes. Astra reports that WoW Forever has dwarf shamans
and undead paladins; that still needs checking against Blizzard's own announcement.

## How it would be built

Everything stays on the one Cloudflare Worker. Discord sends slash commands and button presses to it as
web requests, so no bot program has to keep running.

**Discord interactions**
- Check each request's Ed25519 signature against the raw body, using Web Crypto, and answer Discord's
  `PING`.
- Reply within three seconds. Anything slower gets a "deferred" reply, then finishes in `waitUntil`.
- A follow-up token lasts only 15 minutes. The raid card is edited with the bot's own token and the
  stored message ID.
- Edits are batched, because Discord allows about 5 edits to a channel per 5 seconds.

**Sign in with Discord**
- Uses the `identify` permission, a `state` check and a session cookie.
- Someone who answered before signing in claims their answer from the browser that has it.
- Sign-in does not give the guild's member list. Listing members needs the bot's Server Members
  permission, which Discord reviews once a bot is in 100 servers. "Who hasn't answered" starts with a
  pool the officer chooses.

**Storage and reminders**
- Each poll's Durable Object stays the one place its truth lives.
- A thin guild object maps Discord servers and channels to polls and keeps a queue of due jobs: posts,
  reminders, drift checks.
- An object has only one alarm, so the alarm is set to the earliest job.
- Alarms can fire more than once, so every send is keyed so it happens only once. Before sending, a job
  checks the raid hasn't moved.
- "An hour before" is worked out in the server's time zone when the alarm fires, so daylight saving
  can't shift it.

**The calendar feed**
- A private, revocable address.
- Each raid keeps the same event ID, and every change raises the event's version number.
- A weekly rule with the server's named time zone, and cancelled nights listed as exceptions.

**Discord's rules**
- Verification is needed at 100 servers. A bot for one guild never gets there.
- Data is keyed by guild from the start, so opening muster to other guilds later doesn't mean moving
  data.

## The order

**Before December 9: one complete path for Barrow Deeps, on the web.**
1. Lock in a date and time on the poll: the banner, the countdown, a calendar file, move and cancel, and
   the Discord timestamp to copy.
2. Signing up for each raid on the page (in, late with a time, tentative, out), with the roster and
   standby. "Usually free" comes from the poll.
3. Dated absences.

The guild raids on this from launch day: raid posts go up as a copied Discord message with a link
until the bot is ready.

**Launch weeks: the bot.**
4. Set up a Discord app; Faye creates it and pastes its keys in privately. Then the `/muster raid` card
   with sign-up buttons, the edited roster card and recurring posts.
5. Sign in with Discord, linked to people's existing answers.
6. Reminders, and the officer moving people between seated and standby.

**Then:**
- groups for a 40, before Onyxia;
- drift and "still right?";
- the dropped-healer swap;
- the calendar feed.

**Once the lockouts are announced:** raid groups and the lockout planner.

**Later:** alts and attendance.

## Guild settings

These are choices each guild makes for itself, with sensible defaults, not decisions muster makes for
them:

| Setting | Default |
|---|---|
| Channel for raid posts | the channel `/muster raid` was used in |
| Officers (who can post, edit and move people) | the poll's maker, plus any Discord roles the guild names |
| When each week's raid post goes up | 6 days before the raid |
| Reminders, and where they go | one, an hour before, to those signed in; off until turned on |
| Who counts as the raid pool for "hasn't answered" | everyone who has answered the poll |
| Groups for a 40 | arranged by hand; a guild can save a layout as its template |
| Server time zone | Central |
| Raid size, tanks and healers | 10, 20 or 40, with the usual make-up, editable per raid |

## Pilot

The guild uses muster from the first raid on December 9, not Raid-Helper. So the web path in "Before
December 9" has to be complete and tried with officers before then. The bot follows as soon as it's
ready.
