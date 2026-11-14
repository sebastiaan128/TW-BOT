import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanAttacks } from '../src/service.js';
import { fixture, monday, member, coverage, battle, season } from './support/fixtures.js';
const base = { now: monday, collectMembers: coverage([member()]), resolveSeason: season };
test('seed once, count new 1-stars before sending, resume after restart', async (t) => {
  const { store, config } = fixture(t);
  await scanAttacks(store, config, { ...base, fetchBattleLog: async () => [battle('#P9')] });
  const next = { ...base, fetchBattleLog: async () => [battle('#P2'), battle('#P9')] };
  await scanAttacks(store, config, next);
  assert.equal(store.ranking('2026-12')[0].oneStars, 1); assert.equal(store.events({ status: 'pending' }).length, 1);
  await scanAttacks(store, config, next);
  assert.equal(store.ranking('2026-12')[0].oneStars, 1); assert.equal(store.events().length, 1);
});
test('records every tracked ranked attack for percentages, notification rules only select posts', async (t) => {
  const { store, config } = fixture(t);
  await scanAttacks(store, config, { ...base, fetchBattleLog: async () => [] });
  await scanAttacks(store, config, { ...base, fetchBattleLog: async () => [battle('#P2', { stars: 3 }), battle('#P9')] });
  assert.equal(store.events().length, 1); assert.equal(store.ranking('2026-12')[0].attacks, 2);
});
test('failed or malformed battlelog preserves the last window', async (t) => {
  const { store, config } = fixture(t);
  await scanAttacks(store, config, { ...base, fetchBattleLog: async () => [battle()] });
  const before = store.get('battles:#P0');
  const result = await scanAttacks(store, config, { ...base, fetchBattleLog: async () => [{ stars: 1 }] });
  assert.equal(result.failed.length, 1); assert.deepEqual(store.get('battles:#P0'), before);
});
test('gap after downtime is visible and cannot flood channel', async (t) => {
  const { store, config } = fixture(t);
  await scanAttacks(store, config, { ...base, fetchBattleLog: async () => [battle('#P9')] });
  const result = await scanAttacks(store, config, { ...base, fetchBattleLog: async () => [battle('#P2')] });
  assert.deepEqual(result.gaps, ['#P0']); assert.equal(store.events().length, 0);
});
test('untimed attacks spanning a season reset stay unassigned, not counted in wrong season', async (t) => {
  const { store, config } = fixture(t);
  await scanAttacks(store, config, { ...base, fetchBattleLog: async () => [battle('#P9')] });
  await scanAttacks(store, config, { ...base, resolveSeason: async () => ({ id: '2027-01', source: 'coc-api' }), fetchBattleLog: async () => [battle('#P2'), battle('#P9')] });
  assert.equal(store.ranking('2027-01').length, 0); assert.equal(store.ranking('unassigned')[0].oneStars, 1);
});
test('preview and mark-seen never add leaderboard attacks or queue messages', async (t) => {
  const { store, config } = fixture(t);
  await scanAttacks(store, config, { ...base, fetchBattleLog: async () => [] });
  await scanAttacks(store, config, { ...base, preview: true, fetchBattleLog: async () => [battle()] });
  assert.equal(store.get('battles:#P0').keys.length, 0);
  await scanAttacks(store, config, { ...base, markSeen: true, fetchBattleLog: async () => [battle()] });
  assert.equal(store.events().length, 0); assert.equal(store.ranking('2026-12').length, 0);
});
test('initial timestamped history contributes to season stats without old notification flood', async (t) => {
  const { store, config } = fixture(t);
  const seasonWithDates = async () => ({ id: '1793595600', source: 'coc-api/player', start: Date.parse('2026-11-02T05:00:00Z'), end: Date.parse('2026-11-30T05:00:00Z') });
  const old = battle('#P9', { battleTime: 75, battleTimestamp: '20261109T074513.000Z' });
  const fresh = battle('#P2', { battleTime: 75, battleTimestamp: '20261109T084513.000Z' });
  const opts = { ...base, resolveSeason: seasonWithDates, fetchBattleLog: async () => [old] };
  await scanAttacks(store, config, opts);
  assert.equal(store.ranking('1793595600')[0].oneStars, 1); assert.equal(store.events().length, 0);
  await scanAttacks(store, config, { ...opts, fetchBattleLog: async () => [old, fresh] });
  assert.equal(store.ranking('1793595600')[0].oneStars, 2); assert.equal(store.events().length, 1);
});
