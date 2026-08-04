// test/index.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/index.js';
import { MAX_TIER_AGE_MS } from '../src/snapshot.js';

// The confirmation layer (src/movements.js) only announces a tier change that
// two separate runs agree on. Most tests below exercise the announcing path, so
// they start from a snapshot where the change is already pending its second
// read; `snap()` builds that. Tests for the first-sighting path pass no pending.
const confirming = () => ({
  '#A': { tier: 'I', at: new Date().toISOString() },
  '#B': { tier: 'II', at: new Date().toISOString() },
});
const snap = (tiers, extra = {}) => ({ tiers, pending: confirming(), ...extra });

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
    readSnapshot: async () => snap({ '#A': 'II', '#B': 'I' }),
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
  const { deps, calls } = makeDeps({ readSnapshot: async () => snap({ '#A': 'II', '#B': 'I' }) });
  const r = await run({}, deps);
  assert.deepEqual(calls.renders, [['promoted', 'Alice'], ['demoted', 'Bob']]);
  assert.equal(calls.posts.length, 2);
  assert.deepEqual(calls.reactions, ['🔥', '🤡']);
  assert.equal(calls.writes.length, 1);
  assert.deepEqual(calls.writes[0].tiers, { '#A': 'I', '#B': 'II' });
  assert.equal(typeof calls.writes[0].updatedAt, 'string');
  assert.equal(r.posted.length, 2);
});

test('a tier change seen for the first time posts nothing and holds the baseline', async () => {
  // No pending entry: this is the first run that saw the change. The live
  // members-list tier is volatile around the reset, so nothing is announced and
  // the baseline stays put until a second run agrees.
  const { deps, calls } = makeDeps({
    readSnapshot: async () => ({ tiers: { '#A': 'II', '#B': 'I' } }),
  });
  const r = await run({}, deps);
  assert.equal(calls.posts.length, 0);
  assert.equal(r.posted.length, 0);
  assert.deepEqual(calls.writes[0].tiers, { '#A': 'II', '#B': 'I' });
  assert.deepEqual(calls.writes[0].pending, {
    '#A': { tier: 'I', at: calls.writes[0].pending['#A'].at },
    '#B': { tier: 'II', at: calls.writes[0].pending['#B'].at },
  });
});

test('a pending change that reverts is dropped without ever posting', async () => {
  // The akash case: run 1 read L1, run 2 reads L2 again. Nothing is announced
  // and the baseline never moves, so no phantom demotion follows a week later.
  const { deps, calls } = makeDeps({
    readSnapshot: async () => ({
      tiers: { '#A': 'II' },
      pending: { '#A': { tier: 'I', at: new Date().toISOString() } },
    }),
    detectMovements: async () => ({ promotions: [], demotions: [], currentTiers: { '#A': 'II' } }),
  });
  await run({}, deps);
  assert.equal(calls.posts.length, 0);
  assert.deepEqual(calls.writes[0].tiers, { '#A': 'II' });
  assert.deepEqual(calls.writes[0].pending, {});
});

test('--mark-seen takes the raw observation as the baseline and clears pending', async () => {
  const { deps, calls } = makeDeps({
    readSnapshot: async () => ({
      tiers: { '#A': 'II', '#B': 'I' },
      pending: { '#A': { tier: 'below', at: new Date().toISOString() } },
    }),
  });
  await run({ markSeen: true }, deps);
  assert.deepEqual(calls.writes[0].tiers, { '#A': 'I', '#B': 'II' });
  assert.deepEqual(calls.writes[0].pending, {});
});

test('passes the remembered tiers from the snapshot into detection', async () => {
  const { deps, calls } = makeDeps({ readSnapshot: async () => snap({ '#A': 'II', '#B': 'I' }) });
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
  const { deps, calls } = makeDeps({ readSnapshot: async () => snap({ '#A': 'II', '#B': 'I', '#Z': 'I' }) });
  await run({}, deps);
  // #Z is from a clan absent this run (e.g. transient API failure); keep its tier.
  assert.deepEqual(calls.writes[0].tiers, { '#A': 'I', '#B': 'II', '#Z': 'I' });
});

test('--mark-seen writes the merged tiers without posting', async () => {
  const { deps, calls } = makeDeps({ readSnapshot: async () => snap({ '#A': 'II' }) });
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

test('stamps seenAt for every player observed this run', async () => {
  const { deps, calls } = makeDeps({ readSnapshot: async () => snap({ '#A': 'II', '#B': 'I' }) });
  const before = Date.now();
  await run({}, deps);
  const { seenAt } = calls.writes[0];
  assert.deepEqual(Object.keys(seenAt).sort(), ['#A', '#B']);
  assert.ok(Date.parse(seenAt['#A']) >= before);
  assert.ok(Date.parse(seenAt['#B']) >= before);
});

test('expires a player who left every tracked clan, so a rejoin is not a phantom move', async () => {
  // #GONE was remembered as 'I' but has not been observed for over the window.
  // They must be absent from both the comparison and the written snapshot.
  const stale = new Date(Date.now() - MAX_TIER_AGE_MS - 1000).toISOString();
  const { deps, calls } = makeDeps({
    readSnapshot: async () => ({
      tiers: { '#A': 'II', '#B': 'I', '#GONE': 'I' },
      pending: confirming(),
      seenAt: { '#A': new Date().toISOString(), '#B': new Date().toISOString(), '#GONE': stale },
      updatedAt: new Date().toISOString(),
    }),
  });
  await run({}, deps);
  assert.deepEqual(calls.remembered, [{ '#A': 'II', '#B': 'I' }]); // #GONE not compared against
  assert.deepEqual(calls.writes[0].tiers, { '#A': 'I', '#B': 'II' }); // and pruned from the write
  assert.ok(!('#GONE' in calls.writes[0].seenAt));
});

test('keeps a player merely missed this run (transient clan-API failure)', async () => {
  // #Z is absent from currentTiers but was seen recently: the merge must keep
  // them, otherwise one flaky run silently forgets a real baseline.
  const recent = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // ~1 week
  const { deps, calls } = makeDeps({
    readSnapshot: async () => ({
      tiers: { '#A': 'II', '#B': 'I', '#Z': 'I' },
      pending: confirming(),
      seenAt: { '#A': recent, '#B': recent, '#Z': recent },
      updatedAt: recent,
    }),
  });
  await run({}, deps);
  assert.equal(calls.writes[0].tiers['#Z'], 'I');
  assert.equal(calls.writes[0].seenAt['#Z'], recent); // stamp untouched: not re-observed
});

test('--mark-seen also prunes and stamps', async () => {
  const stale = new Date(Date.now() - MAX_TIER_AGE_MS - 1000).toISOString();
  const { deps, calls } = makeDeps({
    readSnapshot: async () => ({
      tiers: { '#GONE': 'I' }, seenAt: { '#GONE': stale }, updatedAt: new Date().toISOString(),
    }),
  });
  await run({ markSeen: true }, deps);
  assert.deepEqual(calls.writes[0].tiers, { '#A': 'I', '#B': 'II' });
  assert.deepEqual(Object.keys(calls.writes[0].seenAt).sort(), ['#A', '#B']);
});
