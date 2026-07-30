// src/coc.js
import { withRetry } from './util.js';

const API_BASE = 'https://api.clashofclans.com/v1';

// Legend tiers are identified by leagueTier id (verified live 2026-06-08):
//   105000036 = Legend 1 (highest), 105000035 = Legend 2.
// Lower ids are below Legend 2 (a finer ladder). The bot only acts on L1<->L2,
// so only these two map to a tracked tier; everything else is null.
const TIER_BY_LEAGUE_TIER_ID = {
  105000036: 'I',   // Legend 1 (highest)
  105000035: 'II',  // Legend 2
};

export function tierFromId(id) {
  return TIER_BY_LEAGUE_TIER_ID[id] ?? null;
}

// Current tier, read from a clan-members item (members list carries leagueTier).
export function getTier(member) {
  return tierFromId(member?.leagueTier?.id);
}

export async function fetchClanMembers(clanTag, apiKey, { fetchImpl = fetch } = {}) {
  const encoded = encodeURIComponent(clanTag); // '#ABC' -> '%23ABC'
  const res = await fetchImpl(`${API_BASE}/clans/${encoded}/members`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`CoC API ${res.status} for clan ${clanTag}`);
  const data = await res.json();
  return data.items ?? [];
}

// Per-player weekly Legend tier history. Each item has leagueSeasonId and
// leagueTierId. The API returns them oldest-first, but we never rely on order.
export async function fetchLeagueHistory(playerTag, apiKey, { fetchImpl = fetch } = {}) {
  const encoded = encodeURIComponent(playerTag);
  const res = await fetchImpl(`${API_BASE}/players/${encoded}/leaguehistory`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`CoC API ${res.status} for league history ${playerTag}`);
  const data = await res.json();
  return data.items ?? [];
}

// The most recent completed-week entry, or null. A week can have multiple
// records during an L1<->L2 transition (API returns them oldest-first: pre-reset
// tier, then final tier); `>=` keeps the LAST record for the highest seasonId,
// i.e. the player's final tier for that week. Using `>` would keep the pre-reset
// tier and falsely flag players who already moved as moving again.
export function latestHistoryEntry(items) {
  if (!items || items.length === 0) return null;
  return items.reduce((a, b) => (b.leagueSeasonId >= a.leagueSeasonId ? b : a));
}

// Collapse leaguehistory to one settled entry per completed week (the final
// record for each seasonId), oldest week first. During an L1<->L2 transition a
// week has two records (pre-reset tier, then final tier); the final one wins.
// The last two entries are the tiers the player settled at in the two most
// recent completed weeks — what demotion detection compares.
export function settledWeeks(items) {
  if (!items || items.length === 0) return [];
  const bySeason = new Map();
  for (const it of items) bySeason.set(it.leagueSeasonId, it); // oldest-first -> last write is the final tier
  return [...bySeason.values()].sort((a, b) => a.leagueSeasonId - b.leagueSeasonId);
}

// Detects who moved between Legend 1 and Legend 2 at the most recent reset by
// comparing each player's current live tier (from the members list) against the
// tier `remembered` from the previous run. A change since last week is the move:
//   remembered L2, now L1 -> promotion;  remembered L1, now L2 -> demotion.
// A player with no remembered tier (never seen / first run) is recorded but not
// announced, so a fresh deploy seeds a baseline instead of flooding the channel.
// Ranked players below Legend II are remembered as 'below' (see the loop) —
// tracked so memory can't go stale, but never announced in either direction.
//
// leaguehistory is deliberately NOT consulted: it lags and has gaps, which is
// what made history-based detection drop demotions and mis-attribute moves.
//
// Returns { promotions, demotions, currentTiers }, where currentTiers is the
// live tier of every Legend player seen this run — the caller persists it as the
// next run's `remembered`. A clan whose endpoint keeps failing is skipped with a
// warning (its players are simply absent from currentTiers) rather than aborting.
export async function detectMovements(clanTags, apiKey, { remembered = {}, fetchImpl = fetch, sleep } = {}) {
  const promotions = [];
  const demotions = [];
  const currentTiers = {};
  for (const tag of clanTags) {
    let members;
    try {
      members = await withRetry(() => fetchClanMembers(tag, apiKey, { fetchImpl }), { sleep });
    } catch (e) {
      console.warn(`Members failed for ${tag}: ${e.message}`); // skip this clan, keep the rest
      continue;
    }
    for (const m of members) {
      const curTier = getTier(m);
      if (!curTier) {
        // On the ranked ladder but below Legend II. Record that explicitly
        // rather than skipping: the caller MERGES currentTiers into the
        // remembered map, so an omitted player keeps their old tier forever. A
        // player remembered as 'I' who dips below Legend II and later climbs
        // back to Legend II would then look like I->II — a phantom demotion,
        // announced weeks after the fact. 'below' keeps the memory honest.
        // Members with no leagueTier at all aren't on the ladder; ignore them
        // so the snapshot stays limited to ranked players.
        if (m.leagueTier) currentTiers[m.tag] = 'below';
        continue;
      }
      currentTiers[m.tag] = curTier;
      const prev = remembered[m.tag];
      if (prev === 'II' && curTier === 'I') promotions.push({ tag: m.tag, name: m.name });
      else if (prev === 'I' && curTier === 'II') demotions.push({ tag: m.tag, name: m.name });
    }
  }
  return { promotions, demotions, currentTiers };
}

// Per-player battle log (recent ~50 battles). No timestamp/id per battle.
export async function fetchBattleLog(playerTag, apiKey, { fetchImpl = fetch } = {}) {
  const encoded = encodeURIComponent(playerTag);
  const res = await fetchImpl(`${API_BASE}/players/${encoded}/battlelog`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`CoC API ${res.status} for battlelog ${playerTag}`);
  const data = await res.json();
  return data.items ?? [];
}

// 1-star Legend attacks = legend-league battle, this player attacking, exactly
// 1 star. The CoC battlelog tags ranked legend battles as battleType "legend"
// (regular farming is "homeVillage"); verified live against the API 2026-06-21.
export function oneStarAttacks(items) {
  return (items ?? [])
    .filter((b) => b.battleType === 'legend' && b.attack === true && b.stars === 1)
    .map((b) => ({ opponentPlayerTag: b.opponentPlayerTag, destructionPercentage: b.destructionPercentage }));
}

// Members currently in Legend 1 (tier I) across the given clans.
// A clan whose endpoint keeps failing (e.g. CoC API 503/500) is skipped with a
// warning rather than aborting the whole run — its players are picked up on the
// next tick once the endpoint recovers.
export async function legendOnePlayers(clanTags, apiKey, { fetchImpl = fetch, sleep } = {}) {
  const players = [];
  for (const tag of clanTags) {
    let members;
    try {
      members = await withRetry(() => fetchClanMembers(tag, apiKey, { fetchImpl }), { sleep });
    } catch (e) {
      console.warn(`Members failed for ${tag}: ${e.message}`); // skip this clan, keep the rest
      continue;
    }
    for (const m of members) {
      if (getTier(m) === 'I') players.push({ tag: m.tag, name: m.name });
    }
  }
  return players;
}
