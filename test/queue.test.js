import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainQueue } from '../src/queue.js';
import { HttpError } from '../src/http.js';
import { fixture, delivery } from './support/fixtures.js';
function add(store, id, player = '#P0') { store.enqueue({ id, type: 'promoted', player, payload: { name: id } }); }
test('partial batch failure never posts successful A again when B fails', async (t) => {
  const { store, config } = fixture(t); add(store, 'a'); add(store, 'b', '#P2');
  const posts = [];
  const deps = delivery({ postGraphic: async (_, { filename }) => { posts.push(filename); if (filename.includes('-b.')) throw new HttpError(403, 'forbidden'); return { id: '42' }; } });
  await drainQueue(store, config, deps); await drainQueue(store, config, deps);
  assert.equal(posts.filter((f) => f.includes('-a.')).length, 1);
  assert.equal(store.event('a').status, 'sent'); assert.equal(store.event('b').status, 'failed');
});
test('lost HTTP response is uncertain and never automatically resent', async (t) => {
  const { store, config } = fixture(t); add(store, 'a'); let posts = 0;
  const deps = delivery({ postGraphic: async () => { posts++; throw Error('connection lost after acceptance'); } });
  await drainQueue(store, config, deps); await drainQueue(store, config, deps);
  assert.equal(posts, 1); assert.equal(store.event('a').status, 'uncertain');
});
test('interrupted sending is quarantined after a restart', async (t) => {
  const { store, config } = fixture(t); add(store, 'a'); store.updateEvent('a', 'sending');
  await drainQueue(store, config, delivery({ postGraphic: () => assert.fail('must not resend') }));
  assert.equal(store.event('a').status, 'uncertain');
});
test('a persisted per-channel limit survives separate delivery runs', async (t) => {
  const { store, config } = fixture(t); config.delivery.maxPerChannel = 1;
  add(store, 'a'); add(store, 'b', '#P2');
  await drainQueue(store, config, delivery()); await drainQueue(store, config, delivery());
  assert.equal(store.events({ status: 'sent' }).length, 1); assert.equal(store.events({ status: 'pending' }).length, 1);
});
test('limits per player and batch retain remaining work for later', async (t) => {
  const { store, config } = fixture(t); config.delivery.maxPerPlayer = 1; config.delivery.maxPerRun = 2;
  add(store, 'a'); add(store, 'b'); add(store, 'c', '#P2'); add(store, 'd', '#P9');
  const result = await drainQueue(store, config, delivery());
  assert.equal(result.sent, 2); assert.equal(store.events({ status: 'pending' }).length, 2);
});
test('reaction failure cannot roll back a successful message receipt', async (t) => {
  const { store, config } = fixture(t); add(store, 'a');
  await drainQueue(store, config, delivery({ addReaction: async () => { throw Error('no reaction permission'); } }));
  assert.equal(store.event('a').status, 'sent'); assert.equal(store.event('a').message_id, '123');
});
test('explicit 429 remains pending until the server requested retry time', async (t) => {
  const { store, config } = fixture(t); add(store, 'a');
  await drainQueue(store, config, delivery({ postGraphic: async () => { throw new HttpError(429, 'limited', 120000); } }));
  assert.equal(store.event('a').status, 'pending'); assert.ok(store.event('a').available > Date.now() + 100000);
});
test('paused features keep their queue without sending', async (t) => {
  const { store, config } = fixture(t); add(store, 'a'); store.set('enabled:movements', false);
  await drainQueue(store, config, delivery({ postGraphic: () => assert.fail() }));
  assert.equal(store.event('a').status, 'pending');
});
