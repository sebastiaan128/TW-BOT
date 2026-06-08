// src/coc.js
import { withRetry } from './util.js';

const API_BASE = 'https://api.clashofclans.com/v1';
const TIER_BY_TOKEN = { I: 'I', '1': 'I', II: 'II', '2': 'II', III: 'III', '3': 'III' };

export function getTier(member) {
  const name = member?.league?.name;
  if (!name) return null;
  const m = name.match(/legend\s*league\s*(III|II|I|[123])/i);
  if (!m) return null;
  return TIER_BY_TOKEN[m[1].toUpperCase()] ?? null;
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
