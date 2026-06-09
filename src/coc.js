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

// The most recent (highest seasonId) completed-season entry, or null.
export function latestHistoryEntry(items) {
  if (!items || items.length === 0) return null;
  return items.reduce((a, b) => (b.leagueSeasonId > a.leagueSeasonId ? b : a));
}

// Detects who moved between Legend 1 and Legend 2 at the most recent reset, by
// comparing each player's last completed-season tier (from leaguehistory) with
// their current tier (from the members list). Returns the reset's season id so
// callers can announce each reset only once.
//
// Only players whose latest history season equals the global latest completed
// season are considered — this skips stale histories (players who didn't play
// the last week), avoiding false movements from old transitions.
export async function detectMovements(clanTags, apiKey, { fetchImpl = fetch } = {}) {
  const current = [];
  for (const tag of clanTags) {
    const members = await withRetry(() => fetchClanMembers(tag, apiKey, { fetchImpl }));
    for (const m of members) {
      const curTier = getTier(m);
      if (curTier) current.push({ tag: m.tag, name: m.name, curTier });
    }
  }

  const enriched = [];
  for (const p of current) {
    const items = await withRetry(() => fetchLeagueHistory(p.tag, apiKey, { fetchImpl }));
    const last = latestHistoryEntry(items);
    enriched.push({ ...p, prevId: last?.leagueTierId ?? null, prevSeason: last?.leagueSeasonId ?? null });
  }

  const season = enriched.reduce((mx, e) => (e.prevSeason && e.prevSeason > mx ? e.prevSeason : mx), 0) || null;

  const promotions = [];
  const demotions = [];
  for (const e of enriched) {
    if (e.prevSeason !== season) continue; // skip stale histories
    const prevTier = tierFromId(e.prevId);
    if (prevTier === 'II' && e.curTier === 'I') promotions.push({ tag: e.tag, name: e.name });
    else if (prevTier === 'I' && e.curTier === 'II') demotions.push({ tag: e.tag, name: e.name });
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

// 1-star Legend attacks = ranked battle, this player attacking, exactly 1 star.
export function oneStarAttacks(items) {
  return (items ?? [])
    .filter((b) => b.battleType === 'ranked' && b.attack === true && b.stars === 1)
    .map((b) => ({ opponentPlayerTag: b.opponentPlayerTag, destructionPercentage: b.destructionPercentage }));
}

// Members currently in Legend 1 (tier I) across the given clans.
export async function legendOnePlayers(clanTags, apiKey, { fetchImpl = fetch } = {}) {
  const players = [];
  for (const tag of clanTags) {
    const members = await withRetry(() => fetchClanMembers(tag, apiKey, { fetchImpl }));
    for (const m of members) {
      if (getTier(m) === 'I') players.push({ tag: m.tag, name: m.name });
    }
  }
  return players;
}
