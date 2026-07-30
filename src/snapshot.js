// src/snapshot.js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readSnapshot(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function writeSnapshot(path, snapshot) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(snapshot, null, 2));
}

// How long a remembered tier stays trustworthy without being re-observed.
// Deliberately generous — three weekly resets. Missing a real demotion has been
// this bot's recurring failure, so the memory must survive a multi-run clan-API
// outage; only a genuine multi-week departure should expire.
export const MAX_TIER_AGE_MS = 21 * 24 * 60 * 60 * 1000;

// Drop tier memories we have not re-confirmed inside the window.
//
// run() MERGES each run's observations into the remembered map so a transient
// clan-API failure can't drop players. But a player who leaves every tracked
// clan is absent from every subsequent run, so the merge keeps their last tier
// indefinitely — and a rejoin at a different tier then reads as a move made at
// this reset (e.g. remembered 'I', rejoins at 'II' = phantom demotion, posted
// however many weeks later). Expiring the entry makes them a never-seen player
// instead: silently re-seeded, which is the honest answer when the change can't
// be attributed to a specific weekly reset.
//
// Returns the surviving { tiers, seenAt }; run() uses this as the merge base, so
// the written snapshot is self-pruning.
export function pruneStaleTiers(state = {}, { now = Date.now(), maxAgeMs = MAX_TIER_AGE_MS } = {}) {
  const tiers = state.tiers ?? {};
  const seenAt = state.seenAt ?? {};
  // Entries written before `seenAt` existed inherit the snapshot's updatedAt (or
  // `now` when that is missing too, i.e. treat as freshly seen rather than
  // silently discarding a whole baseline) so every kept entry carries a real
  // stamp and can expire on a later run instead of lingering untracked forever.
  const migrated = new Date(Date.parse(state.updatedAt) || now).toISOString();
  const cutoff = now - maxAgeMs;

  const keptTiers = {};
  const keptSeenAt = {};
  for (const [tag, tier] of Object.entries(tiers)) {
    const stamp = seenAt[tag] ?? migrated;
    if (Date.parse(stamp) >= cutoff) {
      keptTiers[tag] = tier;
      keptSeenAt[tag] = stamp;
    }
  }
  return { tiers: keptTiers, seenAt: keptSeenAt };
}
