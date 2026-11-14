import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './support/fixtures.js';
import { migrateLegacy } from '../src/migration.js';

test('legacy tiers migrate once; original snapshots are never rewritten', async (t) => {
  const { store, config } = fixture(t), dir = mkdtempSync(join(tmpdir(), 'tw-migrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  config.snapshotPath = join(dir, 'tiers.json'); config.oneStar.statePath = join(dir, 'seen.json');
  writeFileSync(config.snapshotPath, JSON.stringify({ tiers: { '#P0': 'I' }, updatedAt: '2026-11-09T10:00:00Z' }));
  writeFileSync(config.oneStar.statePath, JSON.stringify({ '#P0': ['#P2|70'] }));
  await migrateLegacy(store, config);
  assert.equal(store.get('movements').players['#P0'].tier, 'I');
  assert.equal(store.get('battles:#P0'), null);
  writeFileSync(config.snapshotPath, 'corrupted after migration');
  await migrateLegacy(store, config); assert.equal(store.get('movements').players['#P0'].tier, 'I');
});
test('corrupt legacy JSON fails without marking migration complete', async (t) => {
  const { store, config } = fixture(t), dir = mkdtempSync(join(tmpdir(), 'tw-corrupt-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  config.snapshotPath = join(dir, 'broken.json'); config.oneStar.statePath = join(dir, 'absent.json');
  writeFileSync(config.snapshotPath, '{');
  await assert.rejects(() => migrateLegacy(store, config));
  assert.equal(store.get('migration:v2'), null);
});
