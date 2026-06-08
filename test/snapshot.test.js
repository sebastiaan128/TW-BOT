// test/snapshot.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { readSnapshot, writeSnapshot } from '../src/snapshot.js';

const PATH = 'test/tmp-data/snap.json';

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
