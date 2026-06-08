// src/coc.js
import { withRetry } from './util.js';

const API_BASE = 'https://api.clashofclans.com/v1';

// The Legend tier is reported PER MEMBER on the clan members list under
// `leagueTier.id` (verified live 2026-06-08). This is independent of the
// trophy-based `league` field: a player can show `league: Unranked` yet still
// have a Legend `leagueTier` (e.g. after the weekly/season trophy reset). So we
// key off leagueTier, never `league`.
//   105000036 = Legend 1 (highest), 105000035 = Legend 2.
// Lower ids (…034/033/032/029) are below Legend 2 — a finer ladder, not a clean
// "Legend 3". The bot only posts L1<->L2 transitions, so we map only these two;
// everything else is null (untracked) by design.
const TIER_BY_LEAGUE_TIER_ID = {
  105000036: 'I',   // Legend 1 (highest)
  105000035: 'II',  // Legend 2
};

export function getTier(member) {
  const id = member?.leagueTier?.id;
  return TIER_BY_LEAGUE_TIER_ID[id] ?? null;
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

// The members list already carries leagueTier per member, so one request per
// clan is enough — no per-player profile fetch needed.
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
