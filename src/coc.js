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

// Detects who moved between Legend 1 and Legend 2 at the most recent reset, by
// comparing each player's last completed-season tier (from leaguehistory) with
// their current tier (from the members list). Returns the reset's season id so
// callers can announce each reset only once.
//
// Only players whose latest history season equals the global latest completed
// season are considered — this skips stale histories (players who didn't play
// the last week), avoiding false movements from old transitions.
// A clan or player whose endpoint keeps failing (e.g. CoC API 503/500) is
// skipped with a warning rather than aborting the whole scan.
export async function detectMovements(clanTags, apiKey, { fetchImpl = fetch, sleep } = {}) {
  const current = [];
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
      if (curTier) current.push({ tag: m.tag, name: m.name, curTier });
    }
  }

  const enriched = [];
  for (const p of current) {
    let items;
    try {
      items = await withRetry(() => fetchLeagueHistory(p.tag, apiKey, { fetchImpl }), { sleep });
    } catch (e) {
      console.warn(`League history failed for ${p.tag}: ${e.message}`); // skip this player
      continue;
    }
    const weeks = settledWeeks(items);
    const latest = weeks[weeks.length - 1] ?? null;
    const prior = weeks[weeks.length - 2] ?? null;
    enriched.push({
      ...p,
      prevId: latest?.leagueTierId ?? null,
      prevSeason: latest?.leagueSeasonId ?? null,
      priorId: prior?.leagueTierId ?? null,
    });
  }

  const season = enriched.reduce((mx, e) => (e.prevSeason && e.prevSeason > mx ? e.prevSeason : mx), 0) || null;

  const promotions = [];
  const demotions = [];
  for (const e of enriched) {
    if (e.prevSeason !== season) continue; // skip stale histories: only the most recent reset
    const prevTier = tierFromId(e.prevId);   // settled tier of the latest completed week
    const priorTier = tierFromId(e.priorId); // settled tier of the week before that
    if (prevTier === 'II' && e.curTier === 'I') {
      promotions.push({ tag: e.tag, name: e.name });
    } else if (prevTier === 'I' && e.curTier === 'II') {
      // History still lags: the latest completed week was L1, the live tier is L2.
      demotions.push({ tag: e.tag, name: e.name });
    } else if (prevTier === 'II' && e.curTier === 'II' && priorTier === 'I') {
      // History has caught up: a demoted player's new L2 tier is written into
      // leaguehistory immediately, so latest == current == L2. The demotion is
      // only visible across the last two completed weeks: L1 -> L2.
      demotions.push({ tag: e.tag, name: e.name });
    }
  }

  return { season, promotions, demotions };
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
