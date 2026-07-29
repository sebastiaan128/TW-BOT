// test/index.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/index.js';

function makeDeps(overrides = {}) {
  const calls = { writes: [], posts: [], renders: [], reactions: [], remembered: [] };
  const deps = {
    loadConfig: () => ({
      cocApiKey: 'k', botToken: 'tok', channelId: '42', clanTags: ['#C'],
      render: {}, messages: { promoted: 'gz', demoted: '' },
      reactions: { promoted: '🔥', demoted: '🤡' },
      snapshotPath: 'data/s.json', outDir: 'out',
    }),
    detectMovements: async (_tags, _key, { remembered } = {}) => {
      calls.remembered.push(remembered);
      return {
        promotions: [{ tag: '#A', name: 'Alice' }],
        demotions: [{ tag: '#B', name: 'Bob' }],
        currentTiers: { '#A': 'I', '#B': 'II' },
      };
    },
    readSnapshot: async () => ({ tiers: {} }),
    writeSnapshot: async (_p, s) => { calls.writes.push(s); },
    renderUsername: async (type, name) => { calls.renders.push([type, name]); return Buffer.from([1]); },
    postGraphic: async (_chan, { filename }, _tok) => { calls.posts.push(filename); return { id: 'm', channel_id: 'c' }; },
    addReaction: async (_chan, _msg, emoji) => { calls.reactions.push(emoji); },
    saveLocal: async () => {},
    ...overrides,
  };
  return { deps, calls };
}

test('posts each movement, reacts 🔥/🤡, and writes the merged tiers', async () => {
  const { deps, calls } = makeDeps({ readSnapshot: async () => ({ tiers: { '#A': 'II', '#B': 'I' } }) });
  const r = await run({}, deps);
  assert.deepEqual(calls.renders, [['promoted', 'Alice'], ['demoted', 'Bob']]);
  assert.equal(calls.posts.length, 2);
  assert.deepEqual(calls.reactions, ['🔥', '🤡']);
  assert.equal(calls.writes.length, 1);
  assert.deepEqual(calls.writes[0].tiers, { '#A': 'I', '#B': 'II' });
  assert.equal(typeof calls.writes[0].updatedAt, 'string');
  assert.equal(r.posted.length, 2);
});

test('passes the remembered tiers from the snapshot into detection', async () => {
  const { deps, calls } = makeDeps({ readSnapshot: async () => ({ tiers: { '#A': 'II', '#B': 'I' } }) });
  await run({}, deps);
  assert.deepEqual(calls.remembered, [{ '#A': 'II', '#B': 'I' }]);
});

test('migration: an old lastAnnouncedSeason snapshot yields empty remembered but still writes tiers', async () => {
  const { deps, calls } = makeDeps({ readSnapshot: async () => ({ lastAnnouncedSeason: 1780290000 }) });
  await run({}, deps);
  assert.deepEqual(calls.remembered, [{}]);
  assert.deepEqual(calls.writes[0].tiers, { '#A': 'I', '#B': 'II' });
});

test('a missing snapshot (null) yields empty remembered', async () => {
  const { deps, calls } = makeDeps({ readSnapshot: async () => null });
  await run({}, deps);
  assert.deepEqual(calls.remembered, [{}]);
});

test('merge preserves remembered players not seen this run', async () => {
  const { deps, calls } = makeDeps({ readSnapshot: async () => ({ tiers: { '#A': 'II', '#B': 'I', '#Z': 'I' } }) });
  await run({}, deps);
  // #Z is from a clan absent this run (e.g. transient API failure); keep its tier.
  assert.deepEqual(calls.writes[0].tiers, { '#A': 'I', '#B': 'II', '#Z': 'I' });
});

test('--mark-seen writes the merged tiers without posting', async () => {
  const { deps, calls } = makeDeps({ readSnapshot: async () => ({ tiers: { '#A': 'II' } }) });
  const r = await run({ markSeen: true }, deps);
  assert.equal(r.marked, true);
  assert.equal(calls.posts.length, 0);
  assert.equal(calls.writes.length, 1);
  assert.deepEqual(calls.writes[0].tiers, { '#A': 'I', '#B': 'II' });
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
  assert.equal(calls.writes.length, 1);
});

test('dry-run saves locally and does not post or write state', async () => {
  let saved = 0;
  const { deps, calls } = makeDeps({ saveLocal: async () => { saved++; } });
  await run({ dryRun: true }, deps);
  assert.equal(saved, 2);
  assert.equal(calls.posts.length, 0);
  assert.equal(calls.writes.length, 0);
});
