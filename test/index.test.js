// test/index.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/index.js';

function makeDeps(overrides = {}) {
  const calls = { writes: 0, posts: [], renders: [] };
  const deps = {
    loadConfig: () => ({
      cocApiKey: 'k', webhookUrl: 'https://hook', clanTags: ['#C'],
      render: {}, messages: { promoted: 'gz', demoted: '' },
      snapshotPath: 'data/s.json', outDir: 'out',
    }),
    buildCurrentSnapshot: async () => ({ takenAt: 't', players: {
      '#A': { name: 'Alice', tier: 'I' }, '#B': { name: 'Bob', tier: 'II' },
    } }),
    readSnapshot: async () => ({ players: {
      '#A': { name: 'Alice', tier: 'II' }, '#B': { name: 'Bob', tier: 'I' },
    } }),
    writeSnapshot: async () => { calls.writes++; },
    renderUsername: async (type, name) => { calls.renders.push([type, name]); return Buffer.from([1]); },
    postGraphic: async (_url, { filename }) => { calls.posts.push(filename); },
    saveLocal: async () => {},
    ...overrides,
  };
  return { deps, calls };
}

test('run posts one graphic per transition and writes snapshot', async () => {
  const { deps, calls } = makeDeps();
  const result = await run({}, deps);
  assert.equal(result.firstRun, false);
  assert.deepEqual(calls.renders, [['promoted', 'Alice'], ['demoted', 'Bob']]);
  assert.equal(calls.posts.length, 2);
  assert.equal(calls.writes, 1);
});

test('first run writes snapshot and posts nothing', async () => {
  const { deps, calls } = makeDeps({ readSnapshot: async () => null });
  const result = await run({}, deps);
  assert.equal(result.firstRun, true);
  assert.equal(calls.posts.length, 0);
  assert.equal(calls.writes, 1);
});

test('snapshot is NOT written when a post fails', async () => {
  const { deps, calls } = makeDeps({ postGraphic: async () => { throw new Error('discord down'); } });
  await assert.rejects(() => run({}, deps), /discord down/);
  assert.equal(calls.writes, 0);
});

test('snapshot is NOT written when fetching fails', async () => {
  const { deps, calls } = makeDeps({ buildCurrentSnapshot: async () => { throw new Error('api down'); } });
  await assert.rejects(() => run({}, deps), /api down/);
  assert.equal(calls.writes, 0);
});

test('dry-run saves locally and does not post or write snapshot', async () => {
  let saved = 0;
  const { deps, calls } = makeDeps({ saveLocal: async () => { saved++; } });
  await run({ dryRun: true }, deps);
  assert.equal(saved, 2);
  assert.equal(calls.posts.length, 0);
  assert.equal(calls.writes, 0);
});
