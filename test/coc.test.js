// test/coc.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTier } from '../src/coc.js';

test('getTier maps player leagueTier ids (36=L1, 35=L2); lower is untracked', () => {
  assert.equal(getTier({ leagueTier: { id: 105000036 } }), 'I');
  assert.equal(getTier({ leagueTier: { id: 105000035 } }), 'II');
  // Below Legend 2 — not a tracked tier, the bot only posts L1<->L2.
  assert.equal(getTier({ leagueTier: { id: 105000034 } }), null);
  assert.equal(getTier({ leagueTier: { id: 105000029 } }), null);
});

test('getTier returns null when leagueTier is missing', () => {
  assert.equal(getTier({}), null);
  assert.equal(getTier({ leagueTier: null }), null);
  assert.equal(getTier({ league: { id: 29000022 } }), null); // members-list shape has no tier
});

// test/coc.test.js — toevoegen onderaan
import { fetchClanMembers, fetchPlayer, buildCurrentSnapshot } from '../src/coc.js';

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

test('fetchPlayer URL-encodes the tag and returns the profile', async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return { ok: true, status: 200, json: async () => ({ tag: '#P1', leagueTier: { id: 105000036 } }) }; };
  const p = await fetchPlayer('#P1', 'key', { fetchImpl });
  assert.match(seenUrl, /\/players\/%23P1$/);
  assert.equal(p.leagueTier.id, 105000036);
});

test('fetchPlayer throws on non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(() => fetchPlayer('#P1', 'key', { fetchImpl }), /404/);
});

test('buildCurrentSnapshot fetches Legend members profiles and maps L1/L2', async () => {
  const fetchImpl = fakeFetch({
    '/clans/%23C1/members': { items: [
      { tag: '#P1', name: 'Alice', league: { id: 29000022 } }, // Legend League -> fetch profile
      { tag: '#P2', name: 'Bob', league: { id: 29000000 } },   // Unranked -> skip (no profile fetch)
    ] },
    '/clans/%23C2/members': { items: [
      { tag: '#P3', name: 'Carol', league: { id: 29000022 } }, // -> profile -> Legend 2
      { tag: '#P4', name: 'Dave', league: { id: 29000022 } },  // -> profile -> below L2, untracked
    ] },
    '/players/%23P1': { tag: '#P1', leagueTier: { id: 105000036 } }, // Legend 1 -> I
    '/players/%23P3': { tag: '#P3', leagueTier: { id: 105000035 } }, // Legend 2 -> II
    '/players/%23P4': { tag: '#P4', leagueTier: { id: 105000034 } }, // below -> null
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
