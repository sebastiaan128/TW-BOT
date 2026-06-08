// test/discord.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postGraphic } from '../src/discord.js';

test('postGraphic posts multipart form to the webhook', async () => {
  let seen = {};
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 200, text: async () => '' };
  };
  await postGraphic('https://hook', {
    filename: 'promoted-P1.png',
    imageBuffer: Buffer.from([1, 2, 3]),
    content: 'gefeliciteerd',
  }, { fetchImpl });

  assert.equal(seen.url, 'https://hook');
  assert.equal(seen.opts.method, 'POST');
  assert.ok(seen.opts.body instanceof FormData);
  assert.equal(seen.opts.body.get('content'), 'gefeliciteerd');
  assert.ok(seen.opts.body.get('files[0]'));
});

test('postGraphic throws on non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => 'bad' });
  await assert.rejects(
    () => postGraphic('https://hook', { filename: 'x.png', imageBuffer: Buffer.from([1]) }, { fetchImpl }),
    /400/
  );
});
