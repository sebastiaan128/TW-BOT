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
