// test/index.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/index.js';

function makeDeps(overrides = {}) {
  const calls = { writes: [], posts: [], renders: [], reactions: [] };
  const deps = {
    loadConfig: () => ({
      cocApiKey: 'k', botToken: 'tok', channelId: '42', clanTags: ['#C'],
      render: {}, messages: { promoted: 'gz', demoted: '' },
      reactions: { promoted: '🔥', demoted: '🤡' },
      snapshotPath: 'data/s.json', outDir: 'out',
    }),
    detectMovements: async () => ({
      season: 1780290000,
      promotions: [{ tag: '#A', name: 'Alice' }],
      demotions: [{ tag: '#B', name: 'Bob' }],
    }),
    readSnapshot: async () => null, // no prior announcement
    writeSnapshot: async (_p, s) => { calls.writes.push(s); },
    renderUsername: async (type, name) => { calls.renders.push([type, name]); return Buffer.from([1]); },
    postGraphic: async (_chan, { filename }, _tok) => { calls.posts.push(filename); return { id: 'm', channel_id: 'c' }; },
    addReaction: async (_chan, _msg, emoji) => { calls.reactions.push(emoji); },
    saveLocal: async () => {},
    ...overrides,
  };
  return { deps, calls };
}

test('posts each movement, reacts 🔥/🤡, and records the season', async () => {
  const { deps, calls } = makeDeps();
  const r = await run({}, deps);
  assert.deepEqual(calls.renders, [['promoted', 'Alice'], ['demoted', 'Bob']]);
  assert.equal(calls.posts.length, 2);
  assert.deepEqual(calls.reactions, ['🔥', '🤡']);
  assert.deepEqual(calls.writes, [{ lastAnnouncedSeason: 1780290000 }]);
  assert.equal(r.season, 1780290000);
});

test('skips posting when this reset was already announced', async () => {
  const { deps, calls } = makeDeps({ readSnapshot: async () => ({ lastAnnouncedSeason: 1780290000 }) });
  const r = await run({}, deps);
  assert.equal(r.alreadyAnnounced, true);
  assert.equal(calls.posts.length, 0);
  assert.equal(calls.writes.length, 0);
});

test('--force re-posts even when already announced', async () => {
  const { deps, calls } = makeDeps({ readSnapshot: async () => ({ lastAnnouncedSeason: 1780290000 }) });
  await run({ force: true }, deps);
  assert.equal(calls.posts.length, 2);
  assert.deepEqual(calls.writes, [{ lastAnnouncedSeason: 1780290000 }]);
});

test('--mark-seen records the season without posting', async () => {
  const { deps, calls } = makeDeps();
  const r = await run({ markSeen: true }, deps);
  assert.equal(r.marked, true);
  assert.equal(calls.posts.length, 0);
  assert.deepEqual(calls.writes, [{ lastAnnouncedSeason: 1780290000 }]);
});

test('state is NOT written when a post fails', async () => {
  const { deps, calls } = makeDeps({ postGraphic: async () => { throw new Error('discord down'); } });
  await assert.rejects(() => run({}, deps), /discord down/);
  assert.equal(calls.writes.length, 0);
});

test('state is NOT written when detection fails', async () => {
  const { deps, calls } = makeDeps({ detectMovements: async () => { throw new Error('api down'); } });
  await assert.rejects(() => run({}, deps), /api down/);
  assert.equal(calls.writes.length, 0);
});

test('reaction failure does not abort the run or block the state write', async () => {
  const { deps, calls } = makeDeps({ addReaction: async () => { throw new Error('no perms'); } });
  const r = await run({}, deps);
  assert.equal(r.posted.length, 2);
  assert.deepEqual(calls.writes, [{ lastAnnouncedSeason: 1780290000 }]);
});

test('dry-run saves locally and does not post or write state', async () => {
  let saved = 0;
  const { deps, calls } = makeDeps({ saveLocal: async () => { saved++; } });
  await run({ dryRun: true }, deps);
  assert.equal(saved, 2);
  assert.equal(calls.posts.length, 0);
  assert.equal(calls.writes.length, 0);
});
