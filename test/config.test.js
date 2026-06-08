// test/config.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { loadConfig } from '../src/config.js';

const TMP = 'test/tmp-config.json';
function withTmpConfig(obj, fn) {
  writeFileSync(TMP, JSON.stringify(obj));
  try { return fn(); } finally { rmSync(TMP, { force: true }); }
}

test('loadConfig merges file + env secrets', () => {
  process.env.COC_API_KEY = 'key123';
  process.env.DISCORD_WEBHOOK_URL = 'https://hook';
  withTmpConfig({ clanTags: ['#ABC'], render: { promoted: {} } }, () => {
    const cfg = loadConfig(TMP);
    assert.equal(cfg.cocApiKey, 'key123');
    assert.equal(cfg.webhookUrl, 'https://hook');
    assert.deepEqual(cfg.clanTags, ['#ABC']);
    assert.equal(cfg.snapshotPath, 'data/last-snapshot.json');
    assert.equal(cfg.outDir, 'out');
  });
});

test('loadConfig throws when COC_API_KEY missing', () => {
  delete process.env.COC_API_KEY;
  process.env.DISCORD_WEBHOOK_URL = 'https://hook';
  withTmpConfig({ clanTags: [] }, () => {
    assert.throws(() => loadConfig(TMP), /COC_API_KEY/);
  });
});
