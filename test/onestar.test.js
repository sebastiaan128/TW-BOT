// test/onestar.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/onestar.js';

function makeDeps(overrides = {}) {
  const calls = { posts: [], reactions: [], writes: [], renders: [], saved: 0 };
  const battlelogs = {
    '#A': [
      { battleType: 'ranked', attack: true, stars: 1, opponentPlayerTag: '#O1', destructionPercentage: 79 },
      { battleType: 'ranked', attack: true, stars: 1, opponentPlayerTag: '#O2', destructionPercentage: 88 },
      { battleType: 'ranked', attack: true, stars: 3, opponentPlayerTag: '#O3', destructionPercentage: 100 },
    ],
    '#B': [
      { battleType: 'ranked', attack: true, stars: 1, opponentPlayerTag: '#O9', destructionPercentage: 50 },
    ],
  };
  calls.logs = [];
  const deps = {
    log: { log: (m) => calls.logs.push(m), warn: () => {} },
    loadConfig: () => ({
      cocApiKey: 'k', botToken: 'tok', clanTags: ['#C'],
      render: { onestar: {} }, outDir: 'out',
      oneStar: { channelId: '99', guildId: 'g', emojiName: 'LaugingPepe', statePath: 'data/os.json' },
    }),
    legendOnePlayers: async () => ([{ tag: '#A', name: 'Alice' }, { tag: '#B', name: 'Bob' }]),
    fetchBattleLog: async (tag) => battlelogs[tag] ?? [],
    readSnapshot: async () => ({ '#A': ['#O1|79'] }), // #A's #O1|79 already seen
    writeSnapshot: async (_p, s) => { calls.writes.push(s); },
    fetchEmojiId: async () => '222',
    renderFields: async (_type, values) => { calls.renders.push(values); return Buffer.from([1]); },
    postGraphic: async (_chan, { filename }) => { calls.posts.push(filename); return { id: 'm', channel_id: 'c' }; },
    addReaction: async (_chan, _msg, emoji) => { calls.reactions.push(emoji); },
    saveLocal: async () => { calls.saved++; },
    ...overrides,
  };
  return { deps, calls };
}

test('posts only new 1-star attacks, reacts with custom emoji, updates state', async () => {
  const { deps, calls } = makeDeps();
  const r = await run({}, deps);
  assert.deepEqual(calls.renders, [
    { name: 'Alice', destruction: '88%' },
    { name: 'Bob', destruction: '50%' },
  ]);
  assert.equal(calls.posts.length, 2);
  assert.deepEqual(calls.reactions, ['LaugingPepe:222', 'LaugingPepe:222']);
  const saved = calls.writes.at(-1);
  assert.deepEqual(saved['#A'].sort(), ['#O1|79', '#O2|88']);
  assert.deepEqual(saved['#B'], ['#O9|50']);
  assert.equal(r.posted.length, 2);
});

test('logs a one-line run summary of players, posts, and skips', async () => {
  const { deps, calls } = makeDeps({
    fetchBattleLog: async (tag) => { if (tag === '#A') throw new Error('boom'); return [{ battleType: 'ranked', attack: true, stars: 1, opponentPlayerTag: '#O9', destructionPercentage: 50 }]; },
    readSnapshot: async () => ({}),
  });
  await run({}, deps);
  assert.deepEqual(calls.logs, ['onestar: 2 player(s), 1 posted, 1 skipped (seen-state: 0 players)']);
});

test('mark-seen records signatures without posting', async () => {
  const { deps, calls } = makeDeps();
  const r = await run({ markSeen: true }, deps);
  assert.equal(r.marked, true);
  assert.equal(calls.posts.length, 0);
  const saved = calls.writes.at(-1);
  assert.deepEqual(saved['#A'].sort(), ['#O1|79', '#O2|88']);
  assert.deepEqual(saved['#B'], ['#O9|50']);
});

test('a player whose battlelog fetch fails is skipped without touching their state', async () => {
  const { deps, calls } = makeDeps({
    fetchBattleLog: async (tag) => { if (tag === '#A') throw new Error('boom'); return [{ battleType: 'ranked', attack: true, stars: 1, opponentPlayerTag: '#O9', destructionPercentage: 50 }]; },
    readSnapshot: async () => ({ '#A': ['#O1|79'] }),
  });
  const r = await run({}, deps);
  assert.equal(calls.posts.length, 1);
  const saved = calls.writes.at(-1);
  assert.deepEqual(saved['#A'], ['#O1|79']);
  assert.deepEqual(saved['#B'], ['#O9|50']);
  assert.equal(r.posted.length, 1);
});

test('a player keeps only successfully-posted sigs when a post fails (no double-post next run)', async () => {
  let n = 0;
  const { deps, calls } = makeDeps({
    legendOnePlayers: async () => ([{ tag: '#A', name: 'Alice' }]),
    readSnapshot: async () => ({}),
    postGraphic: async (_chan, { filename }) => { n++; if (n === 2) throw new Error('discord down'); calls.posts.push(filename); return { id: 'm', channel_id: 'c' }; },
  });
  await run({}, deps);
  assert.equal(calls.posts.length, 1);
  const saved = calls.writes.at(-1);
  assert.deepEqual(saved['#A'], ['#O1|79']);
});

test('reaction is skipped when the emoji is not found', async () => {
  const { deps, calls } = makeDeps({ fetchEmojiId: async () => null });
  await run({}, deps);
  assert.equal(calls.posts.length, 2);
  assert.equal(calls.reactions.length, 0);
});

test('dry-run renders locally and does not post or write state', async () => {
  const { deps, calls } = makeDeps();
  await run({ dryRun: true }, deps);
  assert.equal(calls.saved, 2);
  assert.equal(calls.posts.length, 0);
  assert.equal(calls.writes.length, 0);
});
