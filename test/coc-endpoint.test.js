import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cocApiBase } from '../src/coc-endpoint.js';
import { fetchClanMembers, fetchLeagueHistory, fetchBattleLog, fetchPlayer, fetchLeagueSeasons, collectMembers } from '../src/coc.js';

test('only official and explicitly selected RoyaleAPI endpoints may receive credentials', () => {
  assert.equal(cocApiBase('https://api.clashofclans.com/v1/'), 'https://api.clashofclans.com/v1');
  assert.equal(cocApiBase('https://cocproxy.royaleapi.dev/v1'), 'https://cocproxy.royaleapi.dev/v1');
  for (const base of ['http://cocproxy.royaleapi.dev/v1', 'https://evil.test/v1', 'https://cocproxy.royaleapi.dev.evil.test/v1', 'https://user:secret@cocproxy.royaleapi.dev/v1', 'https://cocproxy.royaleapi.dev/v1?key=x']) assert.throws(() => cocApiBase(base), /COC_API_BASE_URL/);
});
test('all five API readers use the selected proxy, encode tags and refuse redirects', async (t) => {
  const old = process.env.COC_API_BASE_URL;
  t.after(() => { if (old === undefined) delete process.env.COC_API_BASE_URL; else process.env.COC_API_BASE_URL = old; });
  process.env.COC_API_BASE_URL = 'https://cocproxy.royaleapi.dev/v1';
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ items: [] }) }; };
  for (const reader of [fetchClanMembers, fetchLeagueHistory, fetchBattleLog, fetchPlayer]) await reader('#P0', 'fake', { fetchImpl });
  await fetchLeagueSeasons(29000022, 'fake', { fetchImpl });
  assert.equal(calls.length, 5);
  assert.ok(calls.every((c) => c.url.startsWith('https://cocproxy.royaleapi.dev/v1/') && c.opts.redirect === 'error' && c.opts.headers.Authorization === 'Bearer fake'));
  assert.ok(calls.slice(0, 4).every((c) => c.url.includes('%23P0')));
});
test('aggregate errors preserve the actionable API authorization reason', async () => {
  await assert.rejects(() => collectMembers(['#P0'], 'fake', { fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ message: 'Invalid IP address' }) }), sleep: async () => {} }), /HTTP 403: Invalid IP address/);
});
