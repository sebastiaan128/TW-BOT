// src/movements.js
// Confirmation layer between "what the API said just now" and "what we believe
// this player's weekly tier is".
//
// Why this exists: the clan-members `leagueTier` is a LIVE field, not a settled
// weekly result, and it is not stable across the Monday reset window. Verified
// on the 2026-07-27 / 2026-08-03 runs: ***AKASH*** (#8U2PPQV8V) and 『HydroX』
// (#2CQ28RRVJ) both read Legend I on one Monday and Legend II the next, while
// their leaguehistory never contains a single Legend I week. The bot announced a
// promotion, wrote 'I' into the baseline, and a week later announced the
// "demotion" back. Worse, the inflated baseline can only ever move downward
// again — which is why the 2026-08-03 run posted demotions and zero promotions.
//
// The rule here: a tier change must be observed on TWO separate runs before it
// becomes the baseline or gets announced. A single volatile read parks the
// player in `pending` and changes nothing; if the next read agrees, the move is
// real and is committed + announced; if it reverts, the pending entry is dropped
// and nothing is ever posted. This requires the daemon to tick more than once
// per Monday (see scheduler.makeMondayGate `once: false`).
//
// Confirmation applies to EVERY tier change, not just L1<->L2, so a transient
// read can never corrupt the baseline in any direction. Only L2->L1 and L1->L2
// are announced; 'below' transitions just move the baseline silently.

// How long a pending observation stays eligible to confirm a change. Sized to
// cover a single Monday's run window: without an expiry, a one-off read on one
// Monday would still be sitting there to "confirm" the same tier a week later,
// which is exactly the unverified single read this layer exists to prevent.
export const PENDING_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// Decide which observed tier changes are real.
//
//   remembered   – last committed tier per player (the baseline)
//   pending      – { tag: { tier, at } } changes awaiting a second confirming read
//   currentTiers – tiers observed this run ('I' | 'II' | 'below')
//   names        – { tag: name } for the players whose move may be announced
//
// Returns { promotions, demotions, tiers, pending }, where `tiers` is what the
// caller should merge into the baseline: the confirmed new tier, or the OLD
// remembered tier for a change still awaiting confirmation.
export function confirmMovements({
  remembered = {}, pending = {}, currentTiers = {}, names = {},
  now = Date.now(),
} = {}) {
  const promotions = [];
  const demotions = [];
  const tiers = {};
  const nextPending = {};

  // Players not observed this run (e.g. their clan endpoint failed) keep their
  // in-flight confirmation, so a transient outage doesn't restart the process.
  for (const [tag, entry] of Object.entries(pending)) {
    if (!(tag in currentTiers)) nextPending[tag] = entry;
  }

  for (const [tag, live] of Object.entries(currentTiers)) {
    const prev = remembered[tag];

    // Never seen before: seed the baseline silently (a fresh deploy must not
    // announce the whole clan), and no confirmation is needed for a seed.
    if (prev === undefined || prev === live) {
      tiers[tag] = live;
      continue; // any pending entry for this player is dropped: the change reverted
    }

    const held = pending[tag];
    const fresh = held && Date.parse(held.at) >= now - PENDING_MAX_AGE_MS;
    if (!fresh || held.tier !== live) {
      // First sighting of this change (or a stale/different one): hold it and
      // keep the old baseline. Nothing is announced.
      nextPending[tag] = { tier: live, at: new Date(now).toISOString() };
      tiers[tag] = prev;
      continue;
    }

    // Second consecutive sighting: the change is real.
    tiers[tag] = live;
    const name = names[tag];
    if (prev === 'II' && live === 'I') promotions.push({ tag, name });
    else if (prev === 'I' && live === 'II') demotions.push({ tag, name });
    // anything involving 'below' moves the baseline without an announcement
  }

  return { promotions, demotions, tiers, pending: nextPending };
}
