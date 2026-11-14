import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, validateConfig, PROJECT_ROOT } from '../src/config.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const raw = () => JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'config.json')));
test('project config validates and paths are independent of working directory', () => {
  const cfg = loadConfig(undefined, { requireSecrets: false });
  assert.equal(cfg.clanTags.length, 19); assert.equal(cfg.databasePath, resolve(PROJECT_ROOT, 'data/bot.sqlite'));
});
test('required secrets fail early', () => {
  const old = process.env.COC_API_KEY; delete process.env.COC_API_KEY;
  try { assert.throws(() => validateConfig(raw()), /COC_API_KEY/); } finally { if (old) process.env.COC_API_KEY = old; }
});
test('invalid clan tags, channels, intervals, flags and assets fail at startup', () => {
  for (const change of [
    (c) => c.clanTags = [], (c) => c.clanTags = ['not a tag'], (c) => c.channelId = 123,
    (c) => c.oneStar.intervalMinutes = 0, (c) => c.oneStar.enabled = 'yes',
    (c) => c.render.onestar.assetPath = 'missing.png', (c) => c.oneStar.stars = [4],
    (c) => c.delivery.maxPerRun = -1, (c) => c.render.promoted.x = null,
  ]) { const cfg = raw(); change(cfg); assert.throws(() => validateConfig(cfg, { requireSecrets: false })); }
});
test('notification rules cannot select an inverted percentage range', () => {
  const cfg = raw(); cfg.oneStar.minDestruction = 90; cfg.oneStar.maxDestruction = 50;
  assert.throws(() => validateConfig(cfg, { requireSecrets: false }), /destruction/);
});
