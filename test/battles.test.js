import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBattles } from '../src/battles.js';
import { battle } from './support/fixtures.js';
const context = { player: '#P0', season: '2026-12', now: 1 };
test('first window seeds and a restart does not rediscover the same attacks', () => {
  const a = reconcileBattles([battle()], null, context);
  assert.equal(a.newBattles.length, 0);
  assert.equal(reconcileBattles([battle()], a.state, context).newBattles.length, 0);
});
test('two equal new attacks are distinct occurrences and never repeated next poll', () => {
  const old = battle('#P9'), repeated = battle('#P2');
  const initial = reconcileBattles([old], null, context);
  const next = reconcileBattles([repeated, repeated, old], initial.state, context);
  assert.equal(next.newBattles.length, 2);
  assert.notEqual(next.newBattles[0].id, next.newBattles[1].id);
  assert.equal(reconcileBattles([repeated, repeated, old], next.state, context).newBattles.length, 0);
});
test('explicit battle IDs deduplicate repeated API entries in storage', () => {
  const prior = reconcileBattles([battle('#P9')], null, context);
  const next = reconcileBattles([battle('#P2', { id: 'unique' }), battle('#P2', { id: 'unique' }), battle('#P9')], prior.state, context);
  assert.equal(next.newBattles[0].id, next.newBattles[1].id);
});
test('no overlap records a coverage gap and rebaselines without flooding', () => {
  const a = reconcileBattles([battle('#P9')], null, context);
  const b = reconcileBattles([battle('#P2')], a.state, context);
  assert.equal(b.gap, true); assert.equal(b.newBattles.length, 0);
});
test('an empty observed log allows attacks added later to count', () => {
  const a = reconcileBattles([], null, context);
  assert.equal(reconcileBattles([battle()], a.state, context).newBattles.length, 1);
});
test('real API oldest-first timestamps are sorted and duration is not identity', () => {
  const a = battle('#P9', { battleTime: 73, battleTimestamp: '20261109T074513.000Z' });
  const b = battle('#P2', { battleTime: 73, battleTimestamp: '20261109T154557.000Z' });
  const c = battle('#P2', { battleTime: 73, battleTimestamp: '20261109T234630.000Z' });
  const first = reconcileBattles([a, b], null, context);
  const second = reconcileBattles([a, b, c], first.state, context);
  assert.equal(second.newBattles.length, 1);
  assert.equal(second.newBattles[0].battle.battleTimestamp, c.battleTimestamp);
  assert.equal(reconcileBattles([c, b, a], second.state, context).newBattles.length, 0);
});
test('timestamped recovery after a full window gap records visible new battles exactly once', () => {
  const a = battle('#P9', { battleTimestamp: '20261109T074513.000Z' });
  const b = battle('#P2', { battleTimestamp: '20261112T154557.000Z' });
  const first = reconcileBattles([a], null, context);
  const recovered = reconcileBattles([b], first.state, context);
  assert.equal(recovered.gap, true); assert.equal(recovered.newBattles.length, 1);
  assert.equal(reconcileBattles([b], recovered.state, context).newBattles.length, 0);
});

test('only a genuine zero result may omit the opponent', async () => {
  const { validBattle } = await import('../src/battles.js');
  assert.equal(validBattle({ battleType: 'legend', attack: true, stars: 0, destructionPercentage: 0 }), true);
  assert.equal(validBattle({ battleType: 'legend', attack: true, stars: 1, destructionPercentage: 50 }), false);
  assert.equal(validBattle({ battleType: 'legend', attack: true, stars: 0, destructionPercentage: 30 }), false);
});
