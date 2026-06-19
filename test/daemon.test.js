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
    isFreshInstall: () => false,
    now: () => new Date('2026-06-09T08:00:00Z'), // Tuesday
    setIntervalFn: fakeTimers().setIntervalFn,
    log: silent,
    ...overrides,
  };
}

test('runs onestar once on boot', async () => {
  let onestar = 0;
  startDaemon(base({ runOneStarFn: async () => { onestar++; } }));
  await new Promise((r) => setImmediate(r));
  assert.equal(onestar, 1);
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

test('on a fresh install the boot pass seeds state via mark-seen instead of posting', async () => {
  const onestarCalls = [];
  const movementsCalls = [];
  startDaemon(base({
    isFreshInstall: () => true,
    runOneStarFn: async (opts) => { onestarCalls.push(opts); },
    runMovementsFn: async (opts) => { movementsCalls.push(opts); },
    now: () => new Date('2026-06-09T08:00:00Z'), // Tuesday: movements would normally NOT run
  }));
  await new Promise((r) => setImmediate(r));
  // Both seeded with markSeen, even though it is not Monday.
  assert.deepEqual(onestarCalls, [{ markSeen: true }]);
  assert.deepEqual(movementsCalls, [{ markSeen: true }]);
});

test('after a fresh boot, interval ticks run normally (no mark-seen)', async () => {
  const onestarCalls = [];
  const { setIntervalFn, cbs } = fakeTimers();
  startDaemon(base({
    isFreshInstall: () => true,
    runOneStarFn: async (opts) => { onestarCalls.push(opts); },
    setIntervalFn,
  }));
  await new Promise((r) => setImmediate(r));
  const onestarTick = cbs.find((c) => c.ms === 15 * 60 * 1000).cb;
  await onestarTick();
  // Boot seeded with mark-seen; the interval tick runs normally (no opts -> run() defaults to a real post).
  assert.deepEqual(onestarCalls, [{ markSeen: true }, undefined]);
});

test('logs that it is running normally when state already exists', async () => {
  const logs = [];
  startDaemon(base({
    isFreshInstall: () => false,
    log: { warn() {}, error() {}, log: (m) => logs.push(m) },
  }));
  await new Promise((r) => setImmediate(r));
  assert.ok(logs.some((m) => /existing state.*running normally/i.test(m)), `expected a running-normally line, got: ${JSON.stringify(logs)}`);
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
