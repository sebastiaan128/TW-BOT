// src/coc.js
import { withRetry } from './util.js';

const API_BASE = 'https://api.clashofclans.com/v1';

// The generic "Legend League" umbrella, as reported in the clan members list.
// It does NOT carry the tier; we use it only to decide which members need a
// profile fetch (where the real tier lives).
export const LEGEND_LEAGUE_ID = 29000022;

// The actual Legend tier lives on the PLAYER profile under `leagueTier.id`
// (not on the clan members list). Verified live 2026-06-08:
//   105000036 = Legend 1 (highest), 105000035 = Legend 2.
// Lower leagueTier ids (…034/033/032/029) are below Legend 2 — a finer ladder,
// not a clean "Legend 3". Since the bot only posts L1<->L2 transitions, we map
// only these two; everything else is null (untracked) by design.
const TIER_BY_LEAGUE_TIER_ID = {
  105000036: 'I',   // Legend 1 (highest)
  105000035: 'II',  // Legend 2
};

export function getTier(player) {
  const id = player?.leagueTier?.id;
  return TIER_BY_LEAGUE_TIER_ID[id] ?? null;
}

export function isInLegendLeague(member) {
  return member?.league?.id === LEGEND_LEAGUE_ID;
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

export async function fetchPlayer(playerTag, apiKey, { fetchImpl = fetch } = {}) {
  const encoded = encodeURIComponent(playerTag); // '#P1' -> '%23P1'
  const res = await fetchImpl(`${API_BASE}/players/${encoded}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`CoC API ${res.status} for player ${playerTag}`);
  return res.json();
}

// The clan members list only reports the generic Legend League, not the tier.
// So for each member currently in Legend League we fetch their profile, which
// carries `leagueTier`, and keep only those mapping to a tracked tier (I/II).
export async function buildCurrentSnapshot(clanTags, apiKey, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const players = {};
  for (const tag of clanTags) {
    const members = await withRetry(() => fetchClanMembers(tag, apiKey, { fetchImpl }));
    for (const m of members) {
      if (!isInLegendLeague(m)) continue;
      const profile = await withRetry(() => fetchPlayer(m.tag, apiKey, { fetchImpl }));
      const tier = getTier(profile);
      if (tier) players[m.tag] = { name: m.name, tier };
    }
  }
  return { takenAt: now().toISOString(), players };
}
