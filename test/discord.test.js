// test/discord.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postGraphic, addReaction } from '../src/discord.js';

test('postGraphic uploads an image to the channel via the bot and returns the message', async () => {
  let seen = {};
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 200, json: async () => ({ id: '999', channel_id: '1513470511126937731' }) };
  };
  const msg = await postGraphic('1513470511126937731', {
    filename: 'promoted-P1.png',
    imageBuffer: Buffer.from([1, 2, 3]),
    content: 'gefeliciteerd',
  }, 'tok', { fetchImpl });

  assert.equal(seen.url, 'https://discord.com/api/v10/channels/1513470511126937731/messages');
  assert.equal(seen.opts.method, 'POST');
  assert.equal(seen.opts.headers.Authorization, 'Bot tok');
  assert.ok(seen.opts.body instanceof FormData);
  assert.equal(JSON.parse(seen.opts.body.get('payload_json')).content, 'gefeliciteerd');
  assert.ok(seen.opts.body.get('files[0]'));
  assert.deepEqual(msg, { id: '999', channel_id: '1513470511126937731' });
});

test('postGraphic throws on non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
  await assert.rejects(
    () => postGraphic('42', { filename: 'x.png', imageBuffer: Buffer.from([1]) }, 'tok', { fetchImpl }),
    /403/
  );
});

test('addReaction PUTs an URL-encoded emoji with a bot token', async () => {
  let seen = {};
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 204 }; };
  await addReaction('42', '999', '🔥', 'tok', { fetchImpl });
  assert.equal(seen.url, 'https://discord.com/api/v10/channels/42/messages/999/reactions/%F0%9F%94%A5/@me');
  assert.equal(seen.opts.method, 'PUT');
  assert.equal(seen.opts.headers.Authorization, 'Bot tok');
});

test('addReaction throws on non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
  await assert.rejects(() => addReaction('42', '999', '🤡', 'tok', { fetchImpl }), /403/);
});

// test/discord.test.js — toevoegen onderaan
import { fetchEmojiId } from '../src/discord.js';

test('fetchEmojiId returns the id of a custom emoji matched by name (case-insensitive)', async () => {
  let seen = {};
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 200, json: async () => ([
      { name: 'wave', id: '111' },
      { name: 'LaugingPepe', id: '222' },
    ]) };
  };
  const id = await fetchEmojiId('GUILD', 'laugingpepe', 'tok', { fetchImpl });
  assert.equal(seen.url, 'https://discord.com/api/v10/guilds/GUILD/emojis');
  assert.equal(seen.opts.headers.Authorization, 'Bot tok');
  assert.equal(id, '222');
});

test('fetchEmojiId returns null when no emoji matches', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ([{ name: 'wave', id: '111' }]) });
  assert.equal(await fetchEmojiId('GUILD', 'LaugingPepe', 'tok', { fetchImpl }), null);
});

test('fetchEmojiId throws on non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
  await assert.rejects(() => fetchEmojiId('GUILD', 'x', 'tok', { fetchImpl }), /403/);
});
