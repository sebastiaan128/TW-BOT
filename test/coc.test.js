// test/coc.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTier, fetchClanMembers, buildCurrentSnapshot } from '../src/coc.js';

test('getTier maps member leagueTier ids (36=L1, 35=L2); lower is untracked', () => {
  assert.equal(getTier({ leagueTier: { id: 105000036 } }), 'I');
  assert.equal(getTier({ leagueTier: { id: 105000035 } }), 'II');
  // Below Legend 2 — not tracked, the bot only posts L1<->L2.
  assert.equal(getTier({ leagueTier: { id: 105000034 } }), null);
  assert.equal(getTier({ leagueTier: { id: 105000029 } }), null);
});

test('getTier returns null when leagueTier is missing', () => {
  assert.equal(getTier({}), null);
  assert.equal(getTier({ leagueTier: null }), null);
  assert.equal(getTier({ league: { id: 29000022 } }), null); // trophy-league field is not the tier
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

test('buildCurrentSnapshot reads leagueTier from members and keeps only L1/L2', async () => {
  const fetchImpl = fakeFetch({
    '%23C1/members': { items: [
      { tag: '#P1', name: 'Alice', league: { id: 29000022 }, leagueTier: { id: 105000036 } }, // L1 -> I
      { tag: '#P2', name: 'Bob', league: { id: 29000000 } },                                   // no leagueTier -> skip
      // Unranked by trophies but Legend 1 by tier — must still be tracked (the TW Mootje case):
      { tag: '#M', name: 'TW Mootje', league: { id: 29000000 }, leagueTier: { id: 105000036 } },
    ] },
    '%23C2/members': { items: [
      { tag: '#P3', name: 'Carol', league: { id: 29000022 }, leagueTier: { id: 105000035 } }, // L2 -> II
      { tag: '#P4', name: 'Dave', league: { id: 29000022 }, leagueTier: { id: 105000034 } },  // below L2 -> skip
    ] },
  });
  const snap = await buildCurrentSnapshot(['#C1', '#C2'], 'key', {
    fetchImpl, now: () => new Date('2026-06-01T07:00:00Z'),
  });
  assert.equal(snap.takenAt, '2026-06-01T07:00:00.000Z');
  assert.deepEqual(snap.players, {
    '#P1': { name: 'Alice', tier: 'I' },
    '#M': { name: 'TW Mootje', tier: 'I' },
    '#P3': { name: 'Carol', tier: 'II' },
  });
});
