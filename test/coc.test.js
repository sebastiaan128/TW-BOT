// test/coc.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTier } from '../src/coc.js';

test('getTier maps Legend League ids to tiers (36=L1 highest, 35=L2)', () => {
  assert.equal(getTier({ league: { id: 105000036, name: 'Legend League' } }), 'I');
  assert.equal(getTier({ league: { id: 105000035, name: 'Legend League' } }), 'II');
  assert.equal(getTier({ league: { id: 105000034, name: 'Legend League' } }), 'III');
});

test('getTier returns null for non-legend or missing league', () => {
  assert.equal(getTier({ league: { id: 29000022, name: 'Titan League I' } }), null);
  assert.equal(getTier({}), null);
  assert.equal(getTier({ league: null }), null);
});

// test/coc.test.js — toevoegen onderaan
import { fetchClanMembers, buildCurrentSnapshot } from '../src/coc.js';

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

test('buildCurrentSnapshot keeps only legend members keyed by tag', async () => {
  const fetchImpl = fakeFetch({
    '%23C1/members': { items: [
      { tag: '#P1', name: 'Alice', league: { id: 105000036 } }, // Legend 1 -> I
      { tag: '#P2', name: 'Bob', league: { id: 29000022 } },    // not a Legend tier -> ignored
    ] },
    '%23C2/members': { items: [
      { tag: '#P3', name: 'Carol', league: { id: 105000035 } }, // Legend 2 -> II
    ] },
  });
  const snap = await buildCurrentSnapshot(['#C1', '#C2'], 'key', {
    fetchImpl, now: () => new Date('2026-06-01T07:00:00Z'),
  });
  assert.equal(snap.takenAt, '2026-06-01T07:00:00.000Z');
  assert.deepEqual(snap.players, {
    '#P1': { name: 'Alice', tier: 'I' },
    '#P3': { name: 'Carol', tier: 'II' },
  });
});
