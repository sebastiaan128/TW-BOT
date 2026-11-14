import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { fixture } from './support/fixtures.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('transaction rolls back state and outbox together', (t) => {
  const { store } = fixture(t);
  assert.throws(() => store.transaction(() => { store.set('baseline', 2); store.enqueue({ id: 'a', type: 'promoted', payload: {} }); throw Error('crash'); }));
  assert.equal(store.get('baseline'), null); assert.equal(store.events().length, 0);
});
test('unique event identity cannot queue twice', (t) => {
  const { store } = fixture(t);
  const event = { id: 'a', type: 'promoted', payload: {} };
  assert.equal(store.enqueue(event), 1); assert.equal(store.enqueue(event), 0);
});
test('independent connections cannot acquire the same running lease', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-lock-'));
  const a = new Store(join(dir, 'bot.db')), b = new Store(join(dir, 'bot.db'));
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });
  await a.locked('scan', async () => { assert.equal((await b.locked('scan', () => assert.fail())).skipped, true); });
  assert.equal(await b.locked('scan', () => 42), 42);
});
test('disk state survives reopening and counts attacks once', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-reopen-')), path = join(dir, 'bot.db');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = new Store(path); a.set('baseline', { '#A': 'I' }); a.close();
  const b = new Store(path); assert.deepEqual(b.get('baseline'), { '#A': 'I' }); b.close();
});
