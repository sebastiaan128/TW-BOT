// src/coc.js
import { withRetry } from './util.js';

const API_BASE = 'https://api.clashofclans.com/v1';

// The CoC API distinguishes the Legend League tiers by league id (NOT by name).
// Confirmed by the user: 105000036 = Legend 1 (highest), 105000035 = Legend 2.
// 105000034 = Legend 3 is the expected next id in the sequence — confirm via the
// probe; it does not affect posting since we only act on I<->II transitions.
const TIER_BY_LEAGUE_ID = {
  105000036: 'I',   // Legend 1 (highest)
  105000035: 'II',  // Legend 2
  105000034: 'III', // Legend 3 (assumed — verify with `npm run probe`)
};

export function getTier(member) {
  const id = member?.league?.id;
  return TIER_BY_LEAGUE_ID[id] ?? null;
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

export async function buildCurrentSnapshot(clanTags, apiKey, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const players = {};
  for (const tag of clanTags) {
    const members = await withRetry(() => fetchClanMembers(tag, apiKey, { fetchImpl }));
    for (const m of members) {
      const tier = getTier(m);
      if (tier) players[m.tag] = { name: m.name, tier };
    }
  }
  return { takenAt: now().toISOString(), players };
}
