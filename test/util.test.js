// test/util.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from '../src/util.js';

const noSleep = () => Promise.resolve();

test('withRetry returns on first success', async () => {
  let calls = 0;
  const r = await withRetry(async () => { calls++; return 'ok'; }, { sleep: noSleep });
  assert.equal(r, 'ok');
  assert.equal(calls, 1);
});

test('withRetry retries then succeeds', async () => {
  let calls = 0;
  const r = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error('boom');
    return 'ok';
  }, { sleep: noSleep });
  assert.equal(r, 'ok');
  assert.equal(calls, 3);
});

test('withRetry throws after exhausting retries', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls++; throw new Error('boom'); }, { retries: 2, sleep: noSleep }),
    /boom/
  );
  assert.equal(calls, 3); // initial + 2 retries
});
