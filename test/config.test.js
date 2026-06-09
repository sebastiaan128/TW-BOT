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
  process.env.DISCORD_BOT_TOKEN = 'bot123';
  withTmpConfig({ clanTags: ['#ABC'], channelId: '42', render: { promoted: {} } }, () => {
    const cfg = loadConfig(TMP);
    assert.equal(cfg.cocApiKey, 'key123');
    assert.equal(cfg.botToken, 'bot123');
    assert.equal(cfg.channelId, '42');
    assert.deepEqual(cfg.clanTags, ['#ABC']);
    assert.equal(cfg.snapshotPath, 'data/last-snapshot.json');
    assert.equal(cfg.outDir, 'out');
  });
});

test('loadConfig throws when COC_API_KEY missing', () => {
  delete process.env.COC_API_KEY;
  process.env.DISCORD_BOT_TOKEN = 'bot123';
  withTmpConfig({ clanTags: [], channelId: '42' }, () => {
    assert.throws(() => loadConfig(TMP), /COC_API_KEY/);
  });
});

test('loadConfig throws when DISCORD_BOT_TOKEN missing', () => {
  process.env.COC_API_KEY = 'key123';
  delete process.env.DISCORD_BOT_TOKEN;
  withTmpConfig({ clanTags: [], channelId: '42' }, () => {
    assert.throws(() => loadConfig(TMP), /DISCORD_BOT_TOKEN/);
  });
});

test('loadConfig throws when channelId missing', () => {
  process.env.COC_API_KEY = 'key123';
  process.env.DISCORD_BOT_TOKEN = 'bot123';
  withTmpConfig({ clanTags: [] }, () => {
    assert.throws(() => loadConfig(TMP), /channelId/);
  });
});

// test/config.test.js — toevoegen onderaan
test('loadConfig passes through the oneStar section (default {})', () => {
  process.env.COC_API_KEY = 'key123';
  process.env.DISCORD_BOT_TOKEN = 'bot123';
  withTmpConfig({ clanTags: [], channelId: '42', oneStar: { channelId: '99', guildId: 'g', emojiName: 'LaugingPepe' } }, () => {
    assert.deepEqual(loadConfig(TMP).oneStar, { channelId: '99', guildId: 'g', emojiName: 'LaugingPepe' });
  });
  withTmpConfig({ clanTags: [], channelId: '42' }, () => {
    assert.deepEqual(loadConfig(TMP).oneStar, {});
  });
});
