// test/movements.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmMovements, PENDING_MAX_AGE_MS } from '../src/movements.js';

const names = { '#A': 'Alice', '#B': 'Bob' };

test('a tier change seen once is held: not announced, baseline unchanged', () => {
  const r = confirmMovements({
    remembered: { '#A': 'II' }, pending: {}, currentTiers: { '#A': 'I' }, names,
  });
  assert.deepEqual(r.promotions, []);
  assert.deepEqual(r.demotions, []);
  assert.deepEqual(r.tiers, { '#A': 'II' }); // baseline keeps the settled tier
  assert.equal(r.pending['#A'].tier, 'I');
});

test('the same change seen a second time is announced and commits the baseline', () => {
  const r = confirmMovements({
    remembered: { '#A': 'II' },
    pending: { '#A': { tier: 'I', at: new Date().toISOString() } },
    currentTiers: { '#A': 'I' },
    names,
  });
  assert.deepEqual(r.promotions, [{ tag: '#A', name: 'Alice' }]);
  assert.deepEqual(r.tiers, { '#A': 'I' });
  assert.deepEqual(r.pending, {});
});

test('demotion confirms the same way', () => {
  const r = confirmMovements({
    remembered: { '#B': 'I' },
    pending: { '#B': { tier: 'II', at: new Date().toISOString() } },
    currentTiers: { '#B': 'II' },
    names,
  });
  assert.deepEqual(r.demotions, [{ tag: '#B', name: 'Bob' }]);
  assert.deepEqual(r.promotions, []);
  assert.deepEqual(r.tiers, { '#B': 'II' });
});

test('a reverted read drops the pending change and announces nothing', () => {
  // This is the akash case: one volatile read said L1, the next says L2 again.
  const r = confirmMovements({
    remembered: { '#A': 'II' },
    pending: { '#A': { tier: 'I', at: new Date().toISOString() } },
    currentTiers: { '#A': 'II' },
    names,
  });
  assert.deepEqual(r.promotions, []);
  assert.deepEqual(r.demotions, []);
  assert.deepEqual(r.tiers, { '#A': 'II' });
  assert.deepEqual(r.pending, {});
});

test('a pending entry that flips to a different tier restarts confirmation', () => {
  const r = confirmMovements({
    remembered: { '#A': 'II' },
    pending: { '#A': { tier: 'below', at: new Date().toISOString() } },
    currentTiers: { '#A': 'I' },
    names,
  });
  assert.deepEqual(r.promotions, []);
  assert.equal(r.pending['#A'].tier, 'I');
  assert.deepEqual(r.tiers, { '#A': 'II' });
});

test('a stale pending entry cannot confirm a change made a week earlier', () => {
  const old = new Date(Date.now() - PENDING_MAX_AGE_MS - 1000).toISOString();
  const r = confirmMovements({
    remembered: { '#A': 'II' },
    pending: { '#A': { tier: 'I', at: old } },
    currentTiers: { '#A': 'I' },
    names,
  });
  assert.deepEqual(r.promotions, []);
  assert.equal(r.pending['#A'].tier, 'I'); // re-armed with a fresh stamp
  assert.notEqual(r.pending['#A'].at, old);
  assert.deepEqual(r.tiers, { '#A': 'II' });
});

test('a never-seen player is seeded immediately, never announced', () => {
  const r = confirmMovements({ remembered: {}, pending: {}, currentTiers: { '#A': 'I' }, names });
  assert.deepEqual(r.promotions, []);
  assert.deepEqual(r.tiers, { '#A': 'I' });
  assert.deepEqual(r.pending, {});
});

test('an unchanged tier passes through and clears any stale pending', () => {
  const r = confirmMovements({
    remembered: { '#A': 'I' },
    pending: { '#A': { tier: 'II', at: new Date().toISOString() } },
    currentTiers: { '#A': 'I' },
    names,
  });
  assert.deepEqual(r.tiers, { '#A': 'I' });
  assert.deepEqual(r.pending, {});
});

test('confirmed moves to/from below change the baseline but are never announced', () => {
  const at = new Date().toISOString();
  const r = confirmMovements({
    remembered: { '#A': 'II' },
    pending: { '#A': { tier: 'below', at } },
    currentTiers: { '#A': 'below' },
    names,
  });
  assert.deepEqual(r.promotions, []);
  assert.deepEqual(r.demotions, []);
  assert.deepEqual(r.tiers, { '#A': 'below' });
});

test('players missing from this run keep their pending entry and their baseline', () => {
  // A clan whose endpoint failed contributes no currentTiers; that must not
  // silently cancel a confirmation already in flight for its players.
  const at = new Date().toISOString();
  const r = confirmMovements({
    remembered: { '#A': 'II', '#B': 'I' },
    pending: { '#B': { tier: 'II', at } },
    currentTiers: { '#A': 'II' },
    names,
  });
  assert.deepEqual(r.tiers, { '#A': 'II' });
  assert.deepEqual(r.pending, { '#B': { tier: 'II', at } });
});
