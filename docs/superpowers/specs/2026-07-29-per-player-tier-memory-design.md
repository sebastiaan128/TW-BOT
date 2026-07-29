# Movement detection: per-player tier memory

**Date:** 2026-07-29
**Status:** Approved design, pending implementation
**Branch:** `fix/demotion-adjacent-weeks` (fix continues here or a new branch off master)

## Problem

Promotion/demotion detection reads each player's tier at the last *settled*
week from the CoC `leaguehistory` endpoint and compares it to their current live
tier from the clan-members list. It then filters to a single global "baseline"
season (the mode of everyone's latest settled week) and discards anyone not on
it.

CoC writes each completed week's `leaguehistory` entry to different players at
different times, and many histories have gaps. As a result:

- On/just after a Monday reset, a large fraction of players' latest settled
  week lags a week behind the baseline. On 2026-07-27, **0 players had the
  reset week written yet** and ~54 of ~130 tracked players were a week behind.
- Real movers get silently dropped by the baseline filter, or a move can't be
  attributed to a specific reset (Jul-20 vs Jul-27) at all.
- Demotions are the worst hit: the "caught-up demotion" heuristic only fires
  once CoC has written the demoted player's new L2 entry, which typically has
  not happened by the Monday 10:00 post time — so demotions post late or not at
  all, and risk double-posting across adjacent weeks.

Concretely, on 2026-07-27 the run posted 8 of 9 promotions and 0 demotions;
`TW Bouz` (a real promotion) was dropped. There were genuinely no Jul-27
demotions, but the logic cannot prove that from the data — the ambiguity is
irreducible while detection depends on `leaguehistory`.

## Root cause

Movement detection tries to reconstruct "what changed at the last reset" from a
laggy, gap-prone external history feed. It has no memory of what it saw last
week, so it must infer the previous tier from `leaguehistory` — which is exactly
the unreliable input.

## Design: remember each player's tier ourselves

Stop using `leaguehistory` for movement detection. Persist each Legend player's
tier after every run; on the next run, compare the current live tier against the
remembered one. A change since last week *is* the movement — no history, no
baseline season, no lag, no cross-week ambiguity.

This works because the movements run fires once per week (the Monday gate in
`src/scheduler.js`), shortly after the ~05:00 UTC reset. Comparing this Monday's
live tier to last Monday's stored tier yields exactly the moves made at this
reset.

### State schema (`data/last-snapshot.json`)

```jsonc
// old
{ "lastAnnouncedSeason": 1783918800 }
// new
{
  "tiers": { "#TAG": "I", "#TAG2": "II", ... },  // last-seen Legend tier per player
  "updatedAt": "2026-07-29T08:03:00.000Z"
}
```

`I` = Legend 1, `II` = Legend 2 (same tier codes `tierFromId` already returns).
Only players currently in Legend appear; players below Legend 2 are not tracked
(unchanged scope — the bot only acts on L1<->L2).

### `detectMovements` (in `src/coc.js`)

New signature — pure over `(members, remembered)`, fetches **members only**:

```js
detectMovements(clanTags, apiKey, { remembered = {}, fetchImpl, sleep })
  -> { promotions: [{ tag, name }],
       demotions:  [{ tag, name }],
       currentTiers: { "#TAG": "I" | "II", ... } }
```

Logic:

1. Fetch each clan's members (skip a clan whose endpoint keeps failing, with a
   warning — unchanged behaviour). Keep members whose `getTier` is `I` or `II`.
2. For each such member, with `prev = remembered[tag]`:
   - `prev === 'II' && live === 'I'` → **promotion**
   - `prev === 'I'  && live === 'II'` → **demotion**
   - `prev === undefined` (never seen) → announce nothing (seed only)
   - otherwise (same tier) → nothing
   - always set `currentTiers[tag] = live`
3. Return `{ promotions, demotions, currentTiers }`.

`leaguehistory` / `settledWeeks` / `latestHistoryEntry` are no longer used by
`detectMovements`. They remain exported for the standalone audit scripts, but
the season/mode/caught-up/adjacency logic is deleted from `detectMovements`.

### `run` (in `src/index.js`)

```js
const state = (await readSnapshot(snapshotPath)) ?? {};
const remembered = state.tiers ?? {};            // old {lastAnnouncedSeason} -> {} -> everyone new
const { promotions, demotions, currentTiers } =
  await detectMovements(clanTags, apiKey, { remembered });

if (markSeen) {                                   // seed without posting
  await writeSnapshot(snapshotPath, mergeTiers(remembered, currentTiers));
  return { marked: true, posted: [] };
}

// ...render + post promotions then demotions (unchanged path)...

if (!dryRun) await writeSnapshot(snapshotPath, mergeTiers(remembered, currentTiers));
return { posted };
```

Where `mergeTiers(remembered, current) = { tiers: { ...remembered, ...current }, updatedAt: now }`.

**Merge, not replace.** Keeping players not seen this run protects against a
transient clan-API failure silently dropping that clan's remembered tiers (which
would miss a real move once the clan recovers). A player who leaves Legend keeps
their last tier in memory; if they return, we compare against it and announce
only a genuine net change. Growth is bounded by the total number of players who
have ever been in Legend across the clans — small, plain JSON.

Removed: `lastAnnouncedSeason`, the `alreadyAnnounced` check, and the `--force`
flag. Idempotency now comes for free — after a run, `tiers == live`, so a
re-run the same Monday (e.g. after a host restart, since the Monday gate is
in-memory) finds no diff and posts nothing.

### Seeding on deploy (in `src/daemon.js`)

The very first run under the new code finds no `tiers` key, so every player is
"new" and nothing posts — a silent seed. To avoid waiting a full extra week for
the first real detection, the daemon seeds proactively:

- On boot, if the movements snapshot has no `tiers` key, run movements once in
  `markSeen` mode to seed the baseline — **regardless of weekday/hour** (the
  existing Monday gate only applies to real posting).
- This is independent of the existing one-star fresh-install seed.

After deploy the first Monday reset then produces correct, complete output.

## Edge cases

- **New player / first deploy:** no remembered entry → seeded silently, never a
  false announcement.
- **Player leaves Legend:** absent from `current`, retained in memory via merge;
  on return, only a genuine net tier change announces.
- **Transient clan-API failure:** failed clan's players omitted from `current`
  but retained via merge; no data loss, no false posts.
- **Same Monday re-run / restart:** `tiers == live` after the first run → no
  diff → no double post.
- **Crash mid-post:** state written once at the end (as today); a crash before
  the write re-posts on the next run — unchanged risk, acceptably rare.
- **Below-Legend movement (L2 -> below):** out of scope, as today.

## Testing plan

Follows existing conventions (`node:test`, dependency injection, `fakeFetch`).

`detectMovements` (pure, members-only `fetchImpl`):
- promotion: remembered `II`, live `I` → in `promotions`; `currentTiers` updated.
- demotion: remembered `I`, live `II` → in `demotions`.
- no change: remembered `I`, live `I` → neither list.
- new player: remembered `undefined` → neither list, but present in `currentTiers`.
- multiple clans: `currentTiers` spans all; a failing clan is skipped, the rest
  still processed.

`run` (`src/index.js`, injected deps):
- posts promotions then demotions, reacts 🔥/🤡 (unchanged), writes merged tiers.
- `markSeen`: writes tiers, posts nothing.
- migration: snapshot `{ lastAnnouncedSeason }` → nothing posted, tiers written.
- merge: a remembered player from a clan absent this run is preserved in the
  written tiers.

`daemon` (`src/daemon.js`):
- boot with a snapshot lacking `tiers` seeds movements (markSeen) even off-Monday.
- boot with a snapshot having `tiers` does not seed.

Delete the obsolete `leaguehistory`-based `detectMovements` tests (caught-up
demotion, adjacency, stale-week) — the behaviour they covered no longer exists.

## Migration notes / follow-ups

- `scripts/post-promotions.js` reads `detectMovements(...).season`; that field is
  gone. Update it to the new return shape or retire it (it was a one-off helper).
- `scripts/deep-check.js` still uses the old max-season audit; leave as-is or
  refresh separately — not required for this change.

## Out of scope

- The monthly "most 1-star attacks" leaderboard (separate spec; trigger = Legend
  season reset).
- The one-off `TW Bouz` catch-up post (already done manually on 2026-07-29).
