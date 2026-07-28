# AI-tuning simulation bench

**This is an internal dev tool for Claude to run when tuning the bot AI
(`js/bot.js`, `AI_LEVELS` in `js/constants.js`). It is not part of the
shipped game, is not linked from `index.html`, and is not in `sw.js`'s
precache list. The user does not run this themselves.**

## What it is

Runs many bot-vs-bot matches headlessly, much faster than real time,
logging per-shot/per-move/per-match data for statistical analysis. It
reuses the actual game code (`js/main.js`'s `startMatch()`/`update()`,
the real `js/bot.js`/`js/combat.js`) - not a reimplementation - so the
numbers reflect what the real game actually does.

It gets its speed from two things, neither of which touches simulation
correctness:
- Real `setTimeout`-based pacing (tank-selection reveal delays) is
  patched to fire on the next tick for the duration of a batch, so the
  exact same code runs without actually waiting.
- Matches are driven by calling `update(dt)` directly in a tight loop
  (never touching `requestAnimationFrame`/`render()`), choosing `dt`
  adaptively: small and physics-accurate during bullet flight, larger
  while nothing but a countdown timer is ticking.

A batch of 60 matches should take low single-digit seconds.

## How to run it

```
node bench/run.js --matchup medium:medium --matches 60
node bench/run.js --matchup easy:easy,medium:medium,hard:hard --matches 40 --seed 42
node bench/run.js --help
```

Key flags: `--matchup p1:p2,...` (aiLevel pairs, `easy`/`medium`/`hard`),
`--matches <N>` (per matchup), `--map chillForest|desert|random`,
`--wind none|light|strong|random`, `--seed <N>` (reproducible A/B runs -
use the same seed on a "before" and "after" run when the only thing that
changed is an AI constant, so terrain/tank-picks/wind aren't also
varying), `--out <path>` (defaults to a timestamped file under the OS
temp dir - results are never committed to the repo).

This starts its own static server, opens `bench.html` in headless
Chromium, runs the batch, writes a JSONL log, and prints a one-line
summary plus the path to the output file.

## How to read the output

```
node bench/analyze.js /tmp/party-tanks-bench-<timestamp>.jsonl
```

Prints: win rate per matchup, overall/first-shot/by-shot-number/
by-memory-confidence-bucket/by-range-bucket hit rates (with 95% CI
half-widths so small buckets aren't over-read), distance/stdDev/miss-
distance distributions, shots-to-first-hit, and movement behavior
(observed evade rate given threat vs. the configured `evadeChance`,
unreachable-drive frequency).

The raw JSONL itself has four record types if you want to slice it
differently yourself: `match_start`, `shot`, `move`, `match_end` - see
the `type` field on each line. Shot records include `distance`,
`hadMemory`, `movedSinceLastShot`, `stdDev`, `angle`, `power`,
`landingX/Y`, `missDistance`, `hitOpponent`/`hitSelf`, `damage`, and
`reason` (what stopped the bullet: `defender`/`self`/`scenery`/
`terrain`/`offworld`).

## Why the hooks in bot.js/combat.js are safe to leave in real code

`js/bot.js` and `js/combat.js` contain a few `if (window.__BENCH__)`
guards that log shot/move data. `window.__BENCH__` is only ever defined
by `bench/benchRunner.js`, which only `bench.html` loads - real players
loading `index.html` never define it, so these guards are always false
and cost one `typeof`-equivalent check with zero behavior change. Don't
remove them as "dead code" - see CLAUDE.md's load-bearing decision on
the simulation bench.

## If the real game's DOM changes

`bench.html` is a structural copy of `index.html` (same element IDs) so
that `main.js`/`ui.js`/`combat.js`/`tankSelect.js`'s DOM calls resolve
against something during a headless run. If a future change adds a new
element ID that any of those files touch unconditionally during a match,
add the same element to `bench.html` or the bench will throw.
