// test/coc.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTier, tierFromId, latestHistoryEntry,
  fetchClanMembers, fetchLeagueHistory, detectMovements,
} from '../src/coc.js';

test('tierFromId / getTier map 36=L1, 35=L2, else null', () => {
  assert.equal(tierFromId(105000036), 'I');
  assert.equal(tierFromId(105000035), 'II');
  assert.equal(tierFromId(105000034), null);
  assert.equal(getTier({ leagueTier: { id: 105000036 } }), 'I');
  assert.equal(getTier({ leagueTier: { id: 105000035 } }), 'II');
  assert.equal(getTier({}), null);
  assert.equal(getTier({ leagueTier: null }), null);
});

test('latestHistoryEntry picks the highest seasonId regardless of order', () => {
  assert.equal(latestHistoryEntry([]), null);
  assert.equal(latestHistoryEntry(null), null);
  const items = [
    { leagueSeasonId: 1779685200, leagueTierId: 105000036 },
    { leagueSeasonId: 1780290000, leagueTierId: 105000035 },
    { leagueSeasonId: 1779080400, leagueTierId: 105000036 },
  ];
  assert.equal(latestHistoryEntry(items).leagueSeasonId, 1780290000);
});

test('latestHistoryEntry picks the FINAL entry when a week has duplicate records', () => {
  // During an L1<->L2 transition the API returns two records for the same week
  // (oldest-first): the pre-reset tier, then the final tier. We must pick the
  // final one, otherwise a player who ended last week at L2 looks like a fresh
  // demotion. (Verified live 2026-06-22: e.g. TW Gissa had [L1, L2] for the
  // same seasonId and was wrongly flagged as demoting again.)
  const items = [
    { leagueSeasonId: 1779080400, leagueTierId: 105000036 }, // older week, L1
    { leagueSeasonId: 1781499600, leagueTierId: 105000036 }, // latest week, pre-reset L1
    { leagueSeasonId: 1781499600, leagueTierId: 105000035 }, // latest week, FINAL L2
  ];
  assert.equal(latestHistoryEntry(items).leagueTierId, 105000035);
});

function fakeFetch(map) {
  return async (url) => {
    const key = Object.keys(map).find((k) => url.includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => map[key] };
  };
}

test('fetchClanMembers URL-encodes the tag and returns items', async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return { ok: true, status: 200, json: async () => ({ items: [{ name: 'A' }] }) }; };
  const items = await fetchClanMembers('#ABC', 'key', { fetchImpl });
  assert.match(seenUrl, /%23ABC\/members$/);
  assert.deepEqual(items, [{ name: 'A' }]);
});

test('fetchClanMembers throws on non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(() => fetchClanMembers('#ABC', 'key', { fetchImpl }), /403/);
});

test('fetchLeagueHistory hits the leaguehistory endpoint and returns items', async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return { ok: true, status: 200, json: async () => ({ items: [{ leagueSeasonId: 1, leagueTierId: 105000036 }] }) }; };
  const items = await fetchLeagueHistory('#P1', 'key', { fetchImpl });
  assert.match(seenUrl, /\/players\/%23P1\/leaguehistory$/);
  assert.equal(items[0].leagueTierId, 105000036);
});

// test/coc.test.js — toevoegen onderaan
import { fetchBattleLog, oneStarAttacks, legendOnePlayers } from '../src/coc.js';

test('oneStarAttacks keeps only legend attacks with exactly 1 star', () => {
  // battleType is "legend" for ranked legend-league battles (verified live
  // against the CoC API 2026-06-21); "homeVillage" is regular farming.
  const items = [
    { battleType: 'legend', attack: true, stars: 1, opponentPlayerTag: '#O1', destructionPercentage: 79 },
    { battleType: 'legend', attack: true, stars: 2, opponentPlayerTag: '#O2', destructionPercentage: 91 },
    { battleType: 'legend', attack: false, stars: 1, opponentPlayerTag: '#O3', destructionPercentage: 100 }, // defense
    { battleType: 'homeVillage', attack: true, stars: 1, opponentPlayerTag: '#O4', destructionPercentage: 50 }, // farm
  ];
  assert.deepEqual(oneStarAttacks(items), [
    { opponentPlayerTag: '#O1', destructionPercentage: 79 },
  ]);
  assert.deepEqual(oneStarAttacks(null), []);
});

test('fetchBattleLog hits the battlelog endpoint and returns items', async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return { ok: true, status: 200, json: async () => ({ items: [{ stars: 1 }] }) }; };
  const items = await fetchBattleLog('#P1', 'key', { fetchImpl });
  assert.match(seenUrl, /\/players\/%23P1\/battlelog$/);
  assert.deepEqual(items, [{ stars: 1 }]);
});

test('fetchBattleLog throws on non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(() => fetchBattleLog('#P1', 'key', { fetchImpl }), /404/);
});

test('legendOnePlayers returns only tier-I members across clans', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('%23C1/members')) return { ok: true, status: 200, json: async () => ({ items: [
      { tag: '#A', name: 'Alice', leagueTier: { id: 105000036 } }, // L1
      { tag: '#B', name: 'Bob', leagueTier: { id: 105000035 } },   // L2 -> excluded
    ] }) };
    if (url.includes('%23C2/members')) return { ok: true, status: 200, json: async () => ({ items: [
      { tag: '#C', name: 'Carol', leagueTier: { id: 105000036 } }, // L1
      { tag: '#D', name: 'Dave', league: { id: 29000000 } },       // unranked -> excluded
    ] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const players = await legendOnePlayers(['#C1', '#C2'], 'key', { fetchImpl });
  assert.deepEqual(players, [{ tag: '#A', name: 'Alice' }, { tag: '#C', name: 'Carol' }]);
});

test('legendOnePlayers skips a clan whose endpoint keeps failing and keeps the rest', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('%23BAD/members')) return { ok: false, status: 503, json: async () => ({}) };
    if (url.includes('%23C2/members')) return { ok: true, status: 200, json: async () => ({ items: [
      { tag: '#C', name: 'Carol', leagueTier: { id: 105000036 } }, // L1
    ] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  // #BAD is first; its failure must NOT abort the whole run.
  const players = await legendOnePlayers(['#BAD', '#C2'], 'key', { fetchImpl, sleep: async () => {} });
  assert.deepEqual(players, [{ tag: '#C', name: 'Carol' }]);
});

test('detectMovements skips a clan whose members endpoint keeps failing and keeps the rest', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('%23BAD/members')) return { ok: false, status: 503, json: async () => ({}) };
    if (url.includes('%23C2/members')) return { ok: true, status: 200, json: async () => ({ items: [
      { tag: '#P2', name: 'Bob', leagueTier: { id: 105000036 } }, // now L1
    ] }) };
    if (url.includes('/players/%23P2/leaguehistory')) return { ok: true, status: 200, json: async () => ({ items: [
      { leagueSeasonId: 1780290000, leagueTierId: 105000035 }, // last completed: L2 -> now L1 = promoted
    ] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  // #BAD is first; its failure must NOT abort the whole scan.
  const { season, promotions, demotions } = await detectMovements(['#BAD', '#C2'], 'key', { fetchImpl, sleep: async () => {} });
  assert.equal(season, 1780290000);
  assert.deepEqual(promotions, [{ tag: '#P2', name: 'Bob' }]);
  assert.deepEqual(demotions, []);
});

test('detectMovements flags a demotion when leaguehistory has already recorded the new L2 tier', async () => {
  // A demoted player's new tier is written into leaguehistory immediately, so the
  // latest history record already reads L2 (== current members tier). Comparing
  // only latest-history-vs-members misses this; we must look at the two most
  // recent completed weeks: prior week L1 -> latest week L2 = demotion.
  const fetchImpl = fakeFetch({
    '/clans/%23C1/members': { items: [
      { tag: '#P1', name: 'Daan', leagueTier: { id: 105000035 } }, // now L2
    ] },
    '/players/%23P1/leaguehistory': { items: [
      { leagueSeasonId: 1781499600, leagueTierId: 105000036 }, // prior completed week: L1
      { leagueSeasonId: 1782709200, leagueTierId: 105000035 }, // latest completed week: L2 (already recorded)
    ] },
  });
  const { season, promotions, demotions } = await detectMovements(['#C1'], 'key', { fetchImpl });
  assert.equal(season, 1782709200);
  assert.deepEqual(promotions, []);
  assert.deepEqual(demotions, [{ tag: '#P1', name: 'Daan' }]);
});

test('detectMovements does NOT re-flag a player who settled at L2 in a previous week', async () => {
  // The original false-demotion bug: a duplicate latest week [pre-reset L1, final
  // L2] whose prior completed week was ALSO L2. Both settled weeks are L2, so
  // there is no fresh L1->L2 move to announce.
  const fetchImpl = fakeFetch({
    '/clans/%23C1/members': { items: [
      { tag: '#P1', name: 'Gissa', leagueTier: { id: 105000035 } }, // now L2
    ] },
    '/players/%23P1/leaguehistory': { items: [
      { leagueSeasonId: 1781499600, leagueTierId: 105000035 }, // prior completed week: L2
      { leagueSeasonId: 1782709200, leagueTierId: 105000036 }, // latest week, pre-reset L1
      { leagueSeasonId: 1782709200, leagueTierId: 105000035 }, // latest week, FINAL L2
    ] },
  });
  const { promotions, demotions } = await detectMovements(['#C1'], 'key', { fetchImpl });
  assert.deepEqual(promotions, []);
  assert.deepEqual(demotions, []);
});

test('detectMovements skips a caught-up demotion whose latest week is older than the reset', async () => {
  // #OLD demoted L1->L2, but its newest record predates the current reset while
  // #NEW is active this reset. The stale demotion must not be announced now.
  const fetchImpl = fakeFetch({
    '/clans/%23C1/members': { items: [
      { tag: '#OLD', name: 'Stale', leagueTier: { id: 105000035 } }, // now L2, demoted long ago
      { tag: '#NEW', name: 'Fresh', leagueTier: { id: 105000036 } }, // now L1, promoted this reset
    ] },
    '/players/%23OLD/leaguehistory': { items: [
      { leagueSeasonId: 1780894800, leagueTierId: 105000036 }, // prior week: L1
      { leagueSeasonId: 1781499600, leagueTierId: 105000035 }, // latest (stale) week: L2
    ] },
    '/players/%23NEW/leaguehistory': { items: [
      { leagueSeasonId: 1782709200, leagueTierId: 105000035 }, // latest completed week: L2 -> now L1
    ] },
  });
  const { season, promotions, demotions } = await detectMovements(['#C1'], 'key', { fetchImpl });
  assert.equal(season, 1782709200);
  assert.deepEqual(promotions, [{ tag: '#NEW', name: 'Fresh' }]);
  assert.deepEqual(demotions, []);
});

test('detectMovements finds L2->L1 / L1->L2 at the latest reset and skips stale histories', async () => {
  const fetchImpl = fakeFetch({
    // current members across two clans
    '/clans/%23C1/members': { items: [
      { tag: '#P1', name: 'Alice', leagueTier: { id: 105000036 } }, // now L1
      { tag: '#P2', name: 'Bob', leagueTier: { id: 105000035 } },   // now L2
      { tag: '#P9', name: 'Unranked', league: { id: 29000000 } },   // no leagueTier -> ignored
    ] },
    '/clans/%23C2/members': { items: [
      { tag: '#P5', name: 'Stale', leagueTier: { id: 105000036 } }, // now L1 but history is old
    ] },
    // league histories (latest entry decides previous tier)
    '/players/%23P1/leaguehistory': { items: [
      { leagueSeasonId: 1779685200, leagueTierId: 105000035 },
      { leagueSeasonId: 1780290000, leagueTierId: 105000035 }, // last completed: L2 -> now L1 = promoted
    ] },
    '/players/%23P2/leaguehistory': { items: [
      { leagueSeasonId: 1780290000, leagueTierId: 105000036 }, // last completed: L1 -> now L2 = demoted
    ] },
    '/players/%23P5/leaguehistory': { items: [
      { leagueSeasonId: 1779685200, leagueTierId: 105000035 }, // older season -> stale, skipped
    ] },
  });

  const { season, promotions, demotions } = await detectMovements(['#C1', '#C2'], 'key', { fetchImpl });
  assert.equal(season, 1780290000);
  assert.deepEqual(promotions, [{ tag: '#P1', name: 'Alice' }]);
  assert.deepEqual(demotions, [{ tag: '#P2', name: 'Bob' }]);
});
