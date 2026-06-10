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

test('runs onestar once on boot', async () => {
  let onestar = 0;
  const { setIntervalFn } = fakeTimers();
  startDaemon({
    runOneStarFn: async () => { onestar++; },
    runMovementsFn: async () => {},
    now: () => new Date('2026-06-09T08:00:00Z'), // Tuesday
    setIntervalFn, log: silent,
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(onestar, 1);
});

test('runs the movements check on boot when it is Monday', async () => {
  let movements = 0;
  const { setIntervalFn } = fakeTimers();
  startDaemon({
    runOneStarFn: async () => {},
    runMovementsFn: async () => { movements++; },
    now: () => new Date('2026-06-08T08:00:00Z'), // Monday
    setIntervalFn, log: silent,
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(movements, 1);
});

test('does not run the movements check on boot when it is not Monday', async () => {
  let movements = 0;
  const { setIntervalFn } = fakeTimers();
  startDaemon({
    runOneStarFn: async () => {},
    runMovementsFn: async () => { movements++; },
    now: () => new Date('2026-06-09T08:00:00Z'), // Tuesday
    setIntervalFn, log: silent,
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(movements, 0);
});

test('registers two interval timers with the expected periods', () => {
  const { setIntervalFn, cbs } = fakeTimers();
  startDaemon({
    runOneStarFn: async () => {},
    runMovementsFn: async () => {},
    now: () => new Date('2026-06-09T08:00:00Z'),
    setIntervalFn, log: silent,
  });
  const periods = cbs.map((c) => c.ms).sort((a, b) => a - b);
  assert.deepEqual(periods, [15 * 60 * 1000, 60 * 60 * 1000]);
});

test('the movements interval tick only runs the check on a Monday', async () => {
  let movements = 0;
  let now = new Date('2026-06-09T08:00:00Z'); // Tuesday at boot
  const { setIntervalFn, cbs } = fakeTimers();
  startDaemon({
    runOneStarFn: async () => {},
    runMovementsFn: async () => { movements++; },
    now: () => now,
    setIntervalFn, log: silent,
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(movements, 0); // boot tick on Tuesday: nothing

  const movementsTick = cbs.find((c) => c.ms === 60 * 60 * 1000).cb;
  now = new Date('2026-06-08T08:00:00Z'); // pretend it's now Monday
  await movementsTick();
  assert.equal(movements, 1);
  await movementsTick(); // same Monday again -> gated
  assert.equal(movements, 1);
});

test('stop clears all timers', () => {
  const cleared = [];
  const setIntervalFn = (cb, ms) => ({ ms });
  const { stop } = startDaemon({
    runOneStarFn: async () => {},
    runMovementsFn: async () => {},
    now: () => new Date('2026-06-09T08:00:00Z'),
    setIntervalFn,
    clearIntervalFn: (t) => cleared.push(t.ms),
    log: silent,
  });
  stop();
  assert.equal(cleared.length, 2);
});
