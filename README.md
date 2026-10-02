# Claude TV

English · **[Deutsch](README.de.md)**

A small desktop app that shows how much you are currently using in Claude Code.
With Clawd, the pixel mascot: it sleeps when you take a break, puts on
headphones while working, wears sunglasses while waiting, sweats during a
sprint and lies flat when you are maxed out. Next to it stands a little
computer whose screen follows along.

Runs entirely locally. No server, no account, no open port, no network
request. It only reads files that are already on your disk.

![Claude TV](docs/screenshot.jpg)

## What it shows

**Overview**

* the current five-hour window in percent, with a countdown to the reset
* a **“Target” mark** on the bar: the bar is your usage, the mark is where you
  would stand at an even pace. Bar left of the mark means room to spare, right
  of it means you are going too fast.
* a plain sentence from that: `9 % below target`, `Right on target` or
  `At this rate you hit 100 % in 19 min`
* the last 7 days, tokens per minute, usage today, sessions today and the
  model you used last
* your plan, read from the Claude Code configuration

**Details**

* **What the usage consists of**: a stacked bar with a legend — input, output,
  thinking and newly written cache, each with a short explanation. Reused cache
  is listed separately.
* **Where the usage goes**: main loop, subagents and workflows separately. The
  number surprises most people; subagents often account for about half.
* **Windows compared**: the last fourteen completed windows as a row, the
  current one set apart on the right.
* **The week** as seven daily bars
* **Cache reuse**, overall and in the current window
* **Biggest sessions today**, without subagents
* **Priced as API usage**: what the same usage would have cost at list prices
* **When you work**: weekday by hour over four weeks
* usage per model and per project, history of the current window and the day

**What is being worked on** sits under the figure and as its own card in the
details: project, running tool, the last steps with timestamps, the files
touched most recently. Plus the state of the repository — branch, changed and
new files, ahead or behind the remote, last commit. That is `git` read locally
in the project folder, without a token and without GitHub. You can switch it
off in the tray menu; then `git` is not called at all.

**In the tray** next to the clock Clawd sits again, small, and moves along. Left
click shows and hides the window, right click opens a menu, hovering tells you
the percentage and reset time. Closing the window sends it to the tray instead
of quitting; quitting is in the tray menu.

**Autostart** is on after installation. The app registers with Windows, starts
quietly into the tray and waits 60 seconds before reading the logs for the
first time, so it does not slow down your login. One click in the tray menu
turns it off.

**Key `H`** explains every number in a sentence.

## What it cannot do

Five things up front, so the display does not promise more than it keeps.

**Your chats on claude.ai are invisible.** The logs only contain Claude Code.
Everything you do with Claude in the browser or the desktop app is missing.

**Real limit percentages are not stored locally, but you can paste them in
once.** In the Claude Code context window, “Show detailed breakdown” produces a
copyable report with the real values. Key `A` opens the sync window in Claude
TV; from the pasted text the display reads the real window boundaries and works
out what 100 % actually means for you. Without a sync it falls back to an
estimate.

**Without a sync the display estimates the window start.** On one measured day
the first local log line was at 12:45, while the window had been running since
12:30 — something the logs cannot see had opened it. With a sync or a limit
message the boundary is known.

**The second weekly limit stays foreign.** The report names it, but it cannot
be recomputed locally: it read 0 % while millions of Fable tokens sat in the
logs for the same period. The display therefore only shows the value from the
last sync and states how old it is.

**The display moves per message, not per token.** Claude Code writes its logs
when a message is finished.

## Getting started

Needs [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm start
```

Build the finished programs:

```bash
npm run dist
```

Three files end up in `dist/`:

| File | what for |
| --- | --- |
| `Claude TV Setup.exe` | installer for x64 **and** ARM64 in one file, it picks the right one. Double click, no administrator needed. |
| `Claude TV arm64.zip` | for ARM64 Windows without installing. Unpack, run `Claude TV.exe`. |
| `Claude TV x64.exe` | portable single file, no installation. |

Ready-made builds are on the [releases
page](https://github.com/PS-WebAgentur/Claude-TV/releases).

You never have to configure paths to Claude Code. The app resolves
`~/.claude/projects` at runtime; if you have set `CLAUDE_CONFIG_DIR`, it reads
there instead.

The installer is not signed. Windows SmartScreen will say “Windows protected
your PC” on first run; “More info” leads to “Run anyway”.

## Controls

| Key | Effect |
| --- | --- |
| `A` | sync with Claude Code, adopt the real limits |
| `S` | switch language, German and English |
| `D` | switch between overview and details |
| `T` | colour scheme: system, light, dark |
| `P` | always on top |
| `H` | explains what the numbers mean |

The same things are available as buttons in the title bar. Size, position, view
and colour scheme are remembered.

## The metric

**Usage** counts as `input + output + newly written cache`. Cache reads are
tracked separately: they are the cheap part and would otherwise drown out
everything else. That this is the right cut is not a guess — see below.

## What counts as one message

Claude Code writes one log line per content block of a reply: thinking, tool
call and completion separately. All of them carry the same `message.id` and the
**same** usage figures; only the finished line holds the full output token
count. Counting is therefore done once per `message.id`, using the line with
`stop_reason`.

Counting every line instead inflates usage by nearly a factor of three. On one
measured set: 18,600 instead of 7,978 messages over seven days. Claude Code
itself reported 7,847 requests for the same period — 1.7 % away from the
deduplicated count.

## Cache reads do not count

Measured, not assumed, and without a login. With three reference points from
Claude Code you can solve for the weight with which cache reads enter the
limit: `usage + weight × cache read = percent × budget`. The best weight across
all three points is **0.000**, with hundreds of millions of cache-read tokens
in the same window. The metric above leaves them out for good reason.

## Limit events

When Claude Code runs into a limit, it says so in the log line: `error:
"rate_limit"`, status 429, and the reset time in plain text — `You've hit your
session limit · resets 7:10pm (Europe/Berlin)`. That is the only place where a
**real** window boundary lands on your disk, without any credentials.

Two things follow. First the window boundary when no sync is available. Second
the insight that boundaries sit on **ten-minute steps**, not full hours.

**What they are not good for.** It is tempting to treat such an event as a
100 % data point. Measured across nine events, the derived budgets spread by a
quarter. The reason is known: if you also work in the browser, you reach the
limit without the locally measurable usage getting there. Each point is a lower
bound, not a value. The basis for the scale therefore remains the sync, which
already contains the invisible share.

## Why no login

The obvious question is whether the app could not just fetch the values live.
Not cleanly. There is no public interface for the utilisation of a
subscription; Anthropic's Admin API covers an organisation's API usage, not the
limits of a seat, and it requires an admin key.

Technically you could go through the OAuth token in
`~/.claude/.credentials.json` and the same undocumented endpoint Claude Code
uses. Then a program that so far only reads log files would suddenly hold
credentials, depend on an endpoint with no promises attached, and move in a
grey area of the terms. Too high a price for a display. Instead: limit events
above, sync by report, both without a single secret.

## Clawd

**The shape follows the original**: a flat block in a single tone, two square
black eyes, a short stub on each side, four legs. No mouth, no outline, no
shading.

Accessories never sit on the body — once a teal laptop sat right below the eyes
and promptly read as a green open mouth. Everything extra goes above or beside
the figure. Worn items travel with it, floating ones stay put; otherwise the
party hat leaves the frame when Clawd jumps.

| State | Clawd | Computer |
| --- | --- | --- |
| asleep | flat, eyes closed, Zzz rising, breathing deeply | off |
| waiting | blinks, looks around, winks, sunglasses, steaming mug, stretches, waves, takes a few steps, question mark | standby |
| working | bobs, takes steps, headphones on, lightbulb moment, thinks for a second | code, musical notes |
| conducting | arms up, two small Clawds hopping along | screen full |
| sprinting | wide eyes, runs, sweat drops | screen full |
| strained | squinting, wobbles, sweats, gathers itself | warning yellow |
| maxed out | flat with splayed legs, sees stars, risks one eye | alarm red |
| fresh window | jumps with a party hat, sends up a heart, confetti | green check |

Eight states, twenty sequences, twelve faces and thirteen accessories. What
runs is drawn by weight: a main sequence carries the state, interludes come up
rarely. That is why you seldom see the same movement twice in a row.

**The colour stays.** Earlier the warning level tinted the figure; it flipped to
amber at a projection above 110 % while the bar still read 66. Clawd is always
Claude orange now, warnings go through bar, number and text.

## What is read and what is not

Read are the JSONL files under `~/.claude/projects` and a single field from
`~/.claude.json`, the plan tier. Tool calls in those logs supply the activity
view: tool, file, project. Message contents are never touched. The credentials
file is never opened.

Nothing is sent anywhere. The app has no network code.

## Development

```bash
npm run serve      # same interface over HTTP, with demo scenarios
npm run selftest   # 239 checks over counting, windows, sync, config, sprites
```

`http://127.0.0.1:8790/?demo=working&theme=dark&view=detail` — scenarios are
`working`, `idle`, `sleeping`, `sprinting`, `strained`, `spent`, `fresh`,
`uncalibrated`, `empty`.

Node caches imported modules, so restart the dev server after changes under
`lib/`.

## Licence and provenance

The code is under the [MIT licence](LICENSE). Everything else that ships —
Electron, the two fonts under the SIL Open Font License — is listed in the
[third-party notices](THIRD-PARTY-NOTICES.md).

The pixel figure is a redrawing of Clawd, the character Anthropic uses for
Claude Code. The pixel maps were drawn for this project and are covered by the
MIT licence; the character itself is not.

**Claude TV is an independent tool and is neither affiliated with nor endorsed
by Anthropic.** “Claude” and “Anthropic” are trademarks of Anthropic PBC.
