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

// Movement detection compares each player's current live tier against the tier
// we remembered from the previous run. leaguehistory is no longer consulted.

test('detectMovements flags a promotion when remembered L2 is now live L1', async () => {
  const fetchImpl = fakeFetch({
    '/clans/%23C1/members': { items: [
      { tag: '#P1', name: 'Alice', leagueTier: { id: 105000036 } }, // now L1
    ] },
  });
  const { promotions, demotions, currentTiers } = await detectMovements(
    ['#C1'], 'key', { remembered: { '#P1': 'II' }, fetchImpl });
  assert.deepEqual(promotions, [{ tag: '#P1', name: 'Alice' }]);
  assert.deepEqual(demotions, []);
  assert.deepEqual(currentTiers, { '#P1': 'I' });
});

test('detectMovements flags a demotion when remembered L1 is now live L2', async () => {
  const fetchImpl = fakeFetch({
    '/clans/%23C1/members': { items: [
      { tag: '#P1', name: 'Bob', leagueTier: { id: 105000035 } }, // now L2
    ] },
  });
  const { promotions, demotions, currentTiers } = await detectMovements(
    ['#C1'], 'key', { remembered: { '#P1': 'I' }, fetchImpl });
  assert.deepEqual(demotions, [{ tag: '#P1', name: 'Bob' }]);
  assert.deepEqual(promotions, []);
  assert.deepEqual(currentTiers, { '#P1': 'II' });
});

test('detectMovements announces nothing when the remembered tier is unchanged', async () => {
  const fetchImpl = fakeFetch({
    '/clans/%23C1/members': { items: [
      { tag: '#P1', name: 'Carol', leagueTier: { id: 105000036 } }, // still L1
    ] },
  });
  const { promotions, demotions, currentTiers } = await detectMovements(
    ['#C1'], 'key', { remembered: { '#P1': 'I' }, fetchImpl });
  assert.deepEqual(promotions, []);
  assert.deepEqual(demotions, []);
  assert.deepEqual(currentTiers, { '#P1': 'I' });
});

test('detectMovements seeds a never-seen player without announcing', async () => {
  const fetchImpl = fakeFetch({
    '/clans/%23C1/members': { items: [
      { tag: '#P1', name: 'Newbie', leagueTier: { id: 105000036 } }, // now L1, unknown before
    ] },
  });
  const { promotions, demotions, currentTiers } = await detectMovements(
    ['#C1'], 'key', { remembered: {}, fetchImpl });
  assert.deepEqual(promotions, []);
  assert.deepEqual(demotions, []);
  assert.deepEqual(currentTiers, { '#P1': 'I' }); // recorded so the next run can compare
});

test('detectMovements spans multiple clans, ignores non-Legend members', async () => {
  const fetchImpl = fakeFetch({
    '/clans/%23C1/members': { items: [
      { tag: '#P1', name: 'Alice', leagueTier: { id: 105000036 } }, // now L1 (was L2 = promo)
      { tag: '#P9', name: 'Unranked', league: { id: 29000000 } },   // no leagueTier -> ignored
    ] },
    '/clans/%23C2/members': { items: [
      { tag: '#P2', name: 'Bob', leagueTier: { id: 105000035 } }, // now L2 (was L1 = demo)
    ] },
  });
  const { promotions, demotions, currentTiers } = await detectMovements(
    ['#C1', '#C2'], 'key', { remembered: { '#P1': 'II', '#P2': 'I' }, fetchImpl });
  assert.deepEqual(promotions, [{ tag: '#P1', name: 'Alice' }]);
  assert.deepEqual(demotions, [{ tag: '#P2', name: 'Bob' }]);
  assert.deepEqual(currentTiers, { '#P1': 'I', '#P2': 'II' });
});

test('detectMovements skips a clan whose members endpoint keeps failing and keeps the rest', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('%23BAD/members')) return { ok: false, status: 503, json: async () => ({}) };
    if (url.includes('%23C2/members')) return { ok: true, status: 200, json: async () => ({ items: [
      { tag: '#P2', name: 'Bob', leagueTier: { id: 105000036 } }, // now L1 (was L2 = promo)
    ] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  // #BAD is first; its failure must NOT abort the whole scan.
  const { promotions, demotions, currentTiers } = await detectMovements(
    ['#BAD', '#C2'], 'key', { remembered: { '#P2': 'II' }, fetchImpl, sleep: async () => {} });
  assert.deepEqual(promotions, [{ tag: '#P2', name: 'Bob' }]);
  assert.deepEqual(demotions, []);
  assert.deepEqual(currentTiers, { '#P2': 'I' }); // failed clan contributes nothing
});
