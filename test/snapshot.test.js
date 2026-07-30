// test/snapshot.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { readSnapshot, writeSnapshot, pruneStaleTiers, MAX_TIER_AGE_MS } from '../src/snapshot.js';

const PATH = 'test/tmp-data/snap.json';

const NOW = Date.parse('2026-08-03T08:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

test('readSnapshot returns null when file is missing', async () => {
  rmSync('test/tmp-data', { recursive: true, force: true });
  assert.equal(await readSnapshot(PATH), null);
});

test('writeSnapshot then readSnapshot roundtrips', async () => {
  const snap = { takenAt: '2026-06-01T07:00:00.000Z', players: { '#P1': { name: 'Alice', tier: 'I' } } };
  await writeSnapshot(PATH, snap);
  assert.deepEqual(await readSnapshot(PATH), snap);
  rmSync('test/tmp-data', { recursive: true, force: true });
});

test('pruneStaleTiers keeps a player confirmed within the window', () => {
  const state = {
    tiers: { '#A': 'I' },
    seenAt: { '#A': iso(NOW - 7 * 24 * 60 * 60 * 1000) }, // last Monday
    updatedAt: iso(NOW),
  };
  const out = pruneStaleTiers(state, { now: NOW });
  assert.deepEqual(out.tiers, { '#A': 'I' });
  assert.deepEqual(out.seenAt, { '#A': iso(NOW - 7 * 24 * 60 * 60 * 1000) });
});

test('pruneStaleTiers drops a player not confirmed since the window', () => {
  // #GONE left every tracked clan; the merge would keep their 'I' forever, so a
  // rejoin at Legend II would read as a demotion made at this reset.
  const state = {
    tiers: { '#A': 'I', '#GONE': 'I' },
    seenAt: { '#A': iso(NOW), '#GONE': iso(NOW - MAX_TIER_AGE_MS - 1) },
    updatedAt: iso(NOW),
  };
  const out = pruneStaleTiers(state, { now: NOW });
  assert.deepEqual(out.tiers, { '#A': 'I' });
  assert.deepEqual(out.seenAt, { '#A': iso(NOW) });
});

test('pruneStaleTiers keeps a player sitting exactly on the cutoff', () => {
  const state = { tiers: { '#A': 'I' }, seenAt: { '#A': iso(NOW - MAX_TIER_AGE_MS) }, updatedAt: iso(NOW) };
  assert.deepEqual(pruneStaleTiers(state, { now: NOW }).tiers, { '#A': 'I' });
});

test('pruneStaleTiers migrates entries with no seenAt using updatedAt', () => {
  // Snapshot written before seenAt existed: every entry inherits updatedAt so it
  // carries a real stamp and can expire later instead of lingering untracked.
  const state = { tiers: { '#A': 'I', '#B': 'II' }, updatedAt: iso(NOW - 1000) };
  const out = pruneStaleTiers(state, { now: NOW });
  assert.deepEqual(out.tiers, { '#A': 'I', '#B': 'II' });
  assert.deepEqual(out.seenAt, { '#A': iso(NOW - 1000), '#B': iso(NOW - 1000) });
});

test('pruneStaleTiers expires a whole snapshot whose updatedAt is beyond the window', () => {
  const state = { tiers: { '#A': 'I' }, updatedAt: iso(NOW - MAX_TIER_AGE_MS - 1) };
  assert.deepEqual(pruneStaleTiers(state, { now: NOW }).tiers, {});
});

test('pruneStaleTiers treats a snapshot with no updatedAt as freshly seen', () => {
  const out = pruneStaleTiers({ tiers: { '#A': 'I' } }, { now: NOW });
  assert.deepEqual(out.tiers, { '#A': 'I' });
  assert.deepEqual(out.seenAt, { '#A': iso(NOW) });
});

test('pruneStaleTiers handles a missing/old-shape snapshot', () => {
  assert.deepEqual(pruneStaleTiers({}, { now: NOW }), { tiers: {}, seenAt: {} });
  assert.deepEqual(pruneStaleTiers({ lastAnnouncedSeason: 1780290000 }, { now: NOW }), { tiers: {}, seenAt: {} });
});
