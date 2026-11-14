import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestJson } from '../src/http.js';

test('does not retry a permanent authorization failure', async () => {
  let calls = 0;
  await assert.rejects(() => requestJson('https://example.test', {}, { fetchImpl: async () => { calls++; return { ok: false, status: 403, json: async () => ({}) }; } }), /403/);
  assert.equal(calls, 1);
});
test('safe requests retry temporary failures and honor Retry-After', async () => {
  const waits = []; let calls = 0;
  const result = await requestJson('x', {}, { sleep: async (ms) => waits.push(ms), fetchImpl: async () => ++calls === 1 ? { ok: false, status: 429, json: async () => ({ retry_after: 2 }) } : { ok: true, status: 200, json: async () => [1] } });
  assert.deepEqual(result, [1]); assert.equal(waits[0], 2000);
});
test('message POST does not blindly retry a network failure or 500', async () => {
  for (const response of [null, { ok: false, status: 500, json: async () => ({}) }]) {
    let calls = 0;
    await assert.rejects(() => requestJson('x', { method: 'POST' }, { fetchImpl: async () => { calls++; if (!response) throw Error('connection lost'); return response; } }));
    assert.equal(calls, 1);
  }
});
test('timeout includes stalled response bodies and aborts fetch', async () => {
  let signal;
  await assert.rejects(() => requestJson('x', {}, { retries: 0, timeoutMs: 15, fetchImpl: async (_, opts) => { signal = opts.signal; return { ok: true, status: 200, json: () => new Promise(() => {}) }; } }), /timed out/);
  assert.equal(signal.aborted, true);
});
test('very long Retry-After is returned to scheduler without blocking', async () => {
  let slept = false;
  await assert.rejects(() => requestJson('x', {}, { sleep: () => { slept = true; }, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ retry_after: 120 }) }) }), (e) => e.retryAfterMs === 120000);
  assert.equal(slept, false);
});
