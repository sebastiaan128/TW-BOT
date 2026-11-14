import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDaemon } from '../src/daemon.js';
import { resetWindow } from '../src/calendar.js';
import { fixture, monday } from './support/fixtures.js';
const silent = { log() {}, error() {}, warn() {} };
const settle = () => new Promise((r) => setImmediate(r));
function daemon(runtime, overrides = {}) {
  const ticks = [], calls = [];
  const instance = startDaemon(runtime, { startServers: false, log: silent, now: () => new Date(monday),
    scanAttacksFn: async (_, __, opts) => { calls.push(['attacks', opts]); return {}; },
    scanMovementsFn: async (_, __, opts) => { calls.push(['movements', opts]); return {}; },
    drainQueueFn: async () => ({}), setIntervalFn: (fn, ms) => { ticks.push({ fn, ms }); return ms; }, clearIntervalFn() {}, ...overrides });
  return { ...instance, ticks, calls };
}
test('restart resumes attack scan without mark-seen and seeds only missing movement baseline', async (t) => {
  const runtime = fixture(t), d = daemon(runtime); await settle();
  assert.equal(d.calls.find(([name]) => name === 'attacks')[1].markSeen, undefined);
  assert.equal(d.calls.find(([name]) => name === 'movements')[1].markSeen, true); await d.stop();
});
test('Tuesday can finish late movement confirmations; Wednesday is outside default window', () => {
  const cfg = { timeZone: 'Europe/Amsterdam', afterHour: 10, recoveryDays: 2 };
  assert.equal(resetWindow(new Date('2026-11-10T10:00:00Z'), cfg).open, true);
  assert.equal(resetWindow(new Date('2026-11-11T10:00:00Z'), cfg).open, false);
});
test('Monday gate respects Amsterdam DST and starts at configured hour', () => {
  const config = { afterHour: 10 };
  assert.equal(resetWindow(new Date('2026-06-08T07:59:00Z'), config).open, false);
  assert.equal(resetWindow(new Date('2026-06-08T08:00:00Z'), config).open, true);
});
test('configured intervals cover detection and a separate queue worker', async (t) => {
  const runtime = fixture(t), d = daemon(runtime); await settle();
  assert.deepEqual(d.ticks.map((x) => x.ms), [900000, 1800000, 60000]); await d.stop();
});
test('graceful stop waits for active scan and prevents future starts', async (t) => {
  let release, done = false, calls = 0;
  const runtime = fixture(t), d = daemon(runtime, { scanAttacksFn: async () => { calls++; await new Promise((r) => release = r); } });
  await settle(); const stopping = d.stop().then(() => { done = true; });
  await settle(); assert.equal(done, false); release(); await stopping;
  await d.attacks(); assert.equal(calls, 1);
});
test('task failure is persisted for monitoring without killing subsequent ticks', async (t) => {
  const runtime = fixture(t); let calls = 0;
  const d = daemon(runtime, { scanAttacksFn: async () => { if (++calls === 1) throw Error('api down'); return {}; } });
  await settle(); assert.match(runtime.store.get('error:attacks').message, /api down/);
  await d.attacks(); assert.equal(runtime.store.get('error:attacks'), null); await d.stop();
});
