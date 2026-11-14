import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanMovements } from '../src/service.js';
import { fixture, monday, member, coverage } from './support/fixtures.js';

function seed(store, tier = 'II') { store.set('movements', { players: { '#P0': { tier, name: 'P0', clan: '#C0', seenAt: new Date(monday).toISOString() } }, pending: {} }); }
test('movement needs two spaced observations; baseline and event commit together', async (t) => {
  const { store, config } = fixture(t); seed(store);
  const collectMembers = coverage([member()]);
  assert.equal((await scanMovements(store, config, { now: monday, collectMembers })).events.length, 0);
  assert.equal((await scanMovements(store, config, { now: monday + 1000, collectMembers })).events.length, 0);
  const result = await scanMovements(store, config, { now: monday + 1800000, collectMembers });
  assert.equal(result.events.length, 1); assert.equal(store.events().length, 1);
  assert.equal(store.get('movements').players['#P0'].tier, 'I');
  assert.equal((await scanMovements(store, config, { now: monday + 3600000, collectMembers })).events.length, 0);
});
test('a temporary tier change that reverts never posts', async (t) => {
  const { store, config } = fixture(t); seed(store);
  await scanMovements(store, config, { now: monday, collectMembers: coverage([member()]) });
  await scanMovements(store, config, { now: monday + 1800000, collectMembers: coverage([member('#P0', 'II')]) });
  assert.equal(store.events().length, 0); assert.deepEqual(store.get('movements').pending, {});
});
test('mark-seen explicitly seeds without queueing and preview never advances state', async (t) => {
  const { store, config } = fixture(t); seed(store);
  await scanMovements(store, config, { now: monday, preview: true, collectMembers: coverage([member()]) });
  assert.deepEqual(store.get('movements').pending, {});
  await scanMovements(store, config, { now: monday, markSeen: true, collectMembers: coverage([member()]) });
  assert.equal(store.get('movements').players['#P0'].tier, 'I'); assert.equal(store.events().length, 0);
});
test('confirmed departure and rejoin do not become a phantom demotion', async (t) => {
  const { store, config } = fixture(t); seed(store, 'I');
  await scanMovements(store, config, { now: monday, collectMembers: coverage([]) });
  await scanMovements(store, config, { now: monday + 1800000, collectMembers: coverage([member('#P0', 'II')]) });
  assert.equal(store.events().length, 0); assert.equal(store.get('movements').players['#P0'].tier, 'II');
});
test('missing tier invalidates old memory immediately without an announcement', async (t) => {
  const { store, config } = fixture(t); seed(store, 'I');
  await scanMovements(store, config, { now: monday, collectMembers: coverage([member('#P0', 'unknown')]) });
  await scanMovements(store, config, { now: monday + 1800000, collectMembers: coverage([member('#P0', 'II')]) });
  assert.equal(store.events().length, 0);
});
test('failed roster preserves memory, and confirmation cannot leak into next reset', async (t) => {
  const { store, config } = fixture(t); seed(store);
  await scanMovements(store, config, { now: monday, collectMembers: coverage([member()]) });
  await scanMovements(store, config, { now: monday + 1800000, collectMembers: async () => ({ players: [], succeeded: [], failed: [{ clan: '#C0' }] }) });
  assert.equal(store.get('movements').players['#P0'].tier, 'II');
  const next = await scanMovements(store, config, { now: monday + 7 * 86400000, collectMembers: coverage([member()]) });
  assert.equal(next.events.length, 0);
});
test('one failed clan poll preserves an in-flight confirmation until recovery', async (t) => {
  const { store, config } = fixture(t); seed(store);
  await scanMovements(store, config, { now: monday, collectMembers: coverage([member()]) });
  await scanMovements(store, config, { now: monday + 1800000, collectMembers: async () => ({ players: [], succeeded: ['#OTHER'], failed: [{ clan: '#C0' }] }) });
  assert.equal(store.get('movements').pending['#P0'].tier, 'I');
  const recovered = await scanMovements(store, config, { now: monday + 3600000, collectMembers: coverage([member()]) });
  assert.equal(recovered.events.length, 1);
});
