// test/daemon.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDaemon } from '../src/daemon.js';

const silent = { warn() {}, error() {}, log() {} };

function fakeTimers() {
  const cbs = [];
  const setIntervalFn = (cb, ms) => { cbs.push({ cb, ms }); return { ms }; };
  return { setIntervalFn, cbs };
}

// Base options that keep tests off the real filesystem/config.
function base(overrides = {}) {
  return {
    runOneStarFn: async () => {},
    runMovementsFn: async () => {},
    movementsNeedsSeed: () => false,
    now: () => new Date('2026-06-09T08:00:00Z'), // Tuesday
    setIntervalFn: fakeTimers().setIntervalFn,
    log: silent,
    ...overrides,
  };
}

test('seeds onestar on boot with mark-seen, never posting the backlog', async () => {
  const onestarCalls = [];
  startDaemon(base({ runOneStarFn: async (opts) => { onestarCalls.push(opts); } }));
  await new Promise((r) => setImmediate(r));
  // After downtime the current battlelog is recorded as seen, not posted, so
  // only attacks that occur while online are posted.
  assert.deepEqual(onestarCalls, [{ markSeen: true }]);
});

test('runs the movements check on boot when it is Monday', async () => {
  let movements = 0;
  startDaemon(base({
    runMovementsFn: async () => { movements++; },
    now: () => new Date('2026-06-08T08:00:00Z'), // Monday
  }));
  await new Promise((r) => setImmediate(r));
  assert.equal(movements, 1);
});

test('does not run the movements check on boot when it is not Monday', async () => {
  let movements = 0;
  startDaemon(base({ runMovementsFn: async () => { movements++; } }));
  await new Promise((r) => setImmediate(r));
  assert.equal(movements, 0);
});

test('registers two interval timers with the expected periods', () => {
  const { setIntervalFn, cbs } = fakeTimers();
  startDaemon(base({ setIntervalFn }));
  const periods = cbs.map((c) => c.ms).sort((a, b) => a - b);
  assert.deepEqual(periods, [15 * 60 * 1000, 60 * 60 * 1000]);
});

test('the movements interval tick only runs the check on a Monday', async () => {
  let movements = 0;
  let now = new Date('2026-06-09T08:00:00Z'); // Tuesday at boot
  const { setIntervalFn, cbs } = fakeTimers();
  startDaemon(base({
    runMovementsFn: async () => { movements++; },
    now: () => now,
    setIntervalFn,
  }));
  await new Promise((r) => setImmediate(r));
  assert.equal(movements, 0); // boot tick on Tuesday: nothing

  const movementsTick = cbs.find((c) => c.ms === 60 * 60 * 1000).cb;
  now = new Date('2026-06-08T08:00:00Z'); // pretend it's now Monday
  await movementsTick();
  assert.equal(movements, 1);
  await movementsTick(); // same Monday again -> gated
  assert.equal(movements, 1);
});

test('seeds movements off-Monday when there is no tier baseline yet', async () => {
  const movementsCalls = [];
  startDaemon(base({
    movementsNeedsSeed: () => true, // the movements snapshot has no tiers
    runMovementsFn: async (opts) => { movementsCalls.push(opts); },
    now: () => new Date('2026-06-09T08:00:00Z'), // Tuesday
  }));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(movementsCalls, [{ markSeen: true }]);
});

test('does not seed movements on boot when a tier baseline already exists', async () => {
  const movementsCalls = [];
  startDaemon(base({
    movementsNeedsSeed: () => false,
    runMovementsFn: async (opts) => { movementsCalls.push(opts); },
    now: () => new Date('2026-06-09T08:00:00Z'), // Tuesday: normal gated tick -> nothing
  }));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(movementsCalls, []);
});

test('the onestar interval tick posts normally after the boot seed', async () => {
  const onestarCalls = [];
  const { setIntervalFn, cbs } = fakeTimers();
  startDaemon(base({
    runOneStarFn: async (opts) => { onestarCalls.push(opts); },
    setIntervalFn,
  }));
  await new Promise((r) => setImmediate(r));
  const onestarTick = cbs.find((c) => c.ms === 15 * 60 * 1000).cb;
  await onestarTick();
  // Boot seeded with mark-seen; the interval tick runs normally (no opts -> real post).
  assert.deepEqual(onestarCalls, [{ markSeen: true }, undefined]);
});

test('logs that onestar is seeding its baseline on boot', async () => {
  const logs = [];
  startDaemon(base({ log: { warn() {}, error() {}, log: (m) => logs.push(m) } }));
  await new Promise((r) => setImmediate(r));
  assert.ok(logs.some((m) => /onestar.*seed/i.test(m)), `expected an onestar-seeding line, got: ${JSON.stringify(logs)}`);
});

test('stop clears all timers', () => {
  const cleared = [];
  const { stop } = startDaemon(base({
    setIntervalFn: (cb, ms) => ({ ms }),
    clearIntervalFn: (t) => cleared.push(t.ms),
  }));
  stop();
  assert.equal(cleared.length, 2);
});
