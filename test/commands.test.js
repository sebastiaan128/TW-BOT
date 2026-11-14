import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { executeInteraction, verifySignature } from '../src/commands.js';
import { adminAction } from '../src/admin.js';
import { fixture } from './support/fixtures.js';
function interaction(name, options = [], permissions = '0') { return { id: '123456789', application_id: 'app', guild_id: '757958330416365638', type: 2, member: { permissions, user: { id: '42' } }, data: { name: 'tw', options: [{ name, options }] } }; }
test('Ed25519 verifies raw body and rejects tampering and stale replay', () => {
  const keys = generateKeyPairSync('ed25519'), now = Date.now(), stamp = String(Math.floor(now / 1000)), body = Buffer.from('{"type":1}');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  const signature = sign(null, Buffer.concat([Buffer.from(stamp), body]), keys.privateKey).toString('hex');
  assert.equal(verifySignature(body, signature, stamp, publicKey, now), true);
  assert.equal(verifySignature(Buffer.from('{}'), signature, stamp, publicKey, now), false);
  assert.equal(verifySignature(body, signature, stamp, publicKey, now + 400000), false);
});
test('members can read rankings but cannot change settings', (t) => {
  const { store, config } = fixture(t);
  const response = executeInteraction(interaction('settings', [{ name: 'feature', value: 'oneStar' }, { name: 'enabled', value: false }]), store, config, { applicationId: 'app' });
  assert.match(response.data.content, /beheerders/); assert.equal(store.get('enabled:oneStar'), null);
  assert.match(executeInteraction(interaction('ranking'), store, config, { applicationId: 'app' }).data.content, /seizoen/);
});
test('authorized mutations are idempotent by interaction ID and scoped to guild', (t) => {
  const { store, config } = fixture(t);
  const input = interaction('settings', [{ name: 'feature', value: 'oneStar' }, { name: 'enabled', value: false }], '32');
  const result = executeInteraction(input, store, config, { applicationId: 'app' });
  assert.equal(store.get('enabled:oneStar'), false);
  assert.deepEqual(executeInteraction(input, store, config, { applicationId: 'app' }), result);
  input.guild_id = 'wrong'; assert.match(executeInteraction(input, store, config, { applicationId: 'app' }).data.content, /niet beschikbaar/);
});
test('uncertain sends require explicit confirmation; sent events cannot be replayed', (t) => {
  const { store, config } = fixture(t); store.enqueue({ id: 'a', type: 'promoted', payload: {} }); store.updateEvent('a', 'uncertain');
  assert.throws(() => adminAction(store, config, 'retry', { id: 'a' }), /Verify Discord/);
  adminAction(store, config, 'retry', { id: 'a', confirm: true }); assert.equal(store.event('a').status, 'pending');
  store.updateEvent('a', 'sent'); assert.throws(() => adminAction(store, config, 'retry', { id: 'a', confirm: true }), /Cannot change/);
});
test('rules use startup validation and persist effective settings', (t) => {
  const { store, config } = fixture(t);
  adminAction(store, config, 'rules', { key: 'oneStar.stars', value: [0, 1] });
  assert.deepEqual(store.get('rules').oneStar.stars, [0, 1]);
  assert.throws(() => adminAction(store, config, 'rules', { key: 'oneStar.stars', value: [99] }));
  assert.throws(() => adminAction(store, config, 'rules', { key: '__proto__.x', value: 1 }));
});
test('manual correction has the same identity as automatic detection', (t) => {
  const { store, config } = fixture(t);
  const args = { tag: '#P0', name: 'P0', type: 'promoted', reset: '2026-11-09' };
  adminAction(store, config, 'correct', args); adminAction(store, config, 'correct', args);
  assert.equal(store.events().length, 1);
});
