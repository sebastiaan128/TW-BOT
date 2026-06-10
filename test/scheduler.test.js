// test/scheduler.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guarded, weekdayInZone, dayKeyInZone, makeMondayGate } from '../src/scheduler.js';

const silent = { warn() {}, error() {} };

test('guarded swallows errors so a failing run never throws', async () => {
  const task = guarded(async () => { throw new Error('boom'); }, { label: 't', log: silent });
  const r = await task();
  assert.equal(r.error.message, 'boom');
});

test('guarded returns the result of a successful run', async () => {
  const task = guarded(async () => 42, { label: 't', log: silent });
  const r = await task();
  assert.equal(r.result, 42);
});

test('guarded skips a tick while a previous run is still in progress', async () => {
  let release;
  const gate = new Promise((res) => { release = res; });
  let runs = 0;
  const task = guarded(async () => { runs++; await gate; }, { label: 't', log: silent });

  const first = task();        // starts, blocks on gate
  const second = await task();  // should be skipped, returns immediately
  assert.equal(second.skipped, true);
  assert.equal(runs, 1);

  release();
  await first;
  const third = await task();   // first finished, this one runs
  assert.equal(runs, 2);
  assert.equal(third.skipped, undefined);
});

test('weekdayInZone returns 1 for Monday in Europe/Amsterdam', () => {
  // 2026-06-08 is a Monday.
  assert.equal(weekdayInZone(new Date('2026-06-08T12:00:00Z'), 'Europe/Amsterdam'), 1);
  // 2026-06-09 is a Tuesday.
  assert.equal(weekdayInZone(new Date('2026-06-09T12:00:00Z'), 'Europe/Amsterdam'), 2);
});

test('weekdayInZone respects the timezone across midnight', () => {
  // 2026-06-08T23:30Z is still Monday in UTC but already Tuesday 01:30 in Amsterdam (UTC+2).
  assert.equal(weekdayInZone(new Date('2026-06-08T23:30:00Z'), 'Europe/Amsterdam'), 2);
});

test('dayKeyInZone returns the Amsterdam calendar date', () => {
  assert.equal(dayKeyInZone(new Date('2026-06-08T23:30:00Z'), 'Europe/Amsterdam'), '2026-06-09');
});

test('makeMondayGate fires once on Monday then not again that day', () => {
  let now = new Date('2026-06-08T08:00:00Z'); // Monday
  const gate = makeMondayGate({ now: () => now });
  assert.equal(gate(), true);   // first Monday tick
  assert.equal(gate(), false);  // same Monday, already fired
  now = new Date('2026-06-08T15:00:00Z');
  assert.equal(gate(), false);  // still same Monday
});

test('makeMondayGate does not fire on non-Mondays', () => {
  let now = new Date('2026-06-09T08:00:00Z'); // Tuesday
  const gate = makeMondayGate({ now: () => now });
  assert.equal(gate(), false);
  now = new Date('2026-06-10T08:00:00Z'); // Wednesday
  assert.equal(gate(), false);
});

test('makeMondayGate fires again on the next Monday', () => {
  let now = new Date('2026-06-08T08:00:00Z'); // Monday
  const gate = makeMondayGate({ now: () => now });
  assert.equal(gate(), true);
  now = new Date('2026-06-15T08:00:00Z'); // next Monday
  assert.equal(gate(), true);
});
