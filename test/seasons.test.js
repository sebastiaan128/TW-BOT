import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSeason, clashPerkSeason, seasonForBattle } from '../src/seasons.js';
const config = { seasons: { leagueId: 29000022, fallback: 'clashperk' } };
test('prefers the current timed season supplied by API', async () => {
  const s = await resolveSeason(config, [], { now: 15000, catalog: async () => ({ items: [{ id: 'real', startTime: '1970-01-01T00:00:10Z', endTime: '1970-01-01T00:00:20Z' }] }) });
  assert.equal(s.id, 'real'); assert.equal(s.source, 'coc-api');
});
test('completed season list is not assumed to be the active season', async () => {
  const s = await resolveSeason(config, [{ tag: '#P0' }], { catalog: async () => ({ items: [{ id: '2026-10' }] }), player: async () => ({ legendStatistics: { currentSeason: { id: 'custom-current' } } }) });
  assert.equal(s.id, 'custom-current'); assert.equal(s.source, 'coc-api/player');
});
test('ClashPerk fallback changes at 28-day UTC boundaries, not the calendar month', () => {
  const boundary = Date.parse('2025-11-03T05:00:00Z');
  assert.equal(clashPerkSeason(boundary - 1).label, '2025-10');
  assert.equal(clashPerkSeason(boundary).label, '2025-11');
  assert.equal(clashPerkSeason(boundary).end - clashPerkSeason(boundary).start, 28 * 86400000);
});
test('fallback source and API failure remain visible; disabled fallback fails closed', async () => {
  const deps = { catalog: async () => { throw Error('api down'); } };
  const s = await resolveSeason(config, [], deps);
  assert.equal(s.source, 'clashperk-convention'); assert.match(s.warning, /api down/);
  await assert.rejects(() => resolveSeason({ seasons: { ...config.seasons, fallback: 'none' } }, [], deps), /Season unavailable/);
});
test('battle season supplied by API takes precedence over observation', () => {
  assert.deepEqual(seasonForBattle({ seasonId: 'old' }, { id: 'new' }), { id: 'old', attribution: 'api' });
});
test('real API currentLeagueSeasonId and battleTimestamp assign the actual season', async () => {
  const now = Date.parse('2026-11-14T10:00:00Z');
  const s = await resolveSeason(config, [{ tag: '#P0' }], { now, catalog: async () => ({ items: [{ id: 'v2-2026-10-26T05:00:00Z' }] }), player: async () => ({ currentLeagueSeasonId: 1793595600 }) });
  assert.equal(s.id, '1793595600'); assert.equal(s.source, 'coc-api/player');
  assert.deepEqual(seasonForBattle({ battleTime: 73, battleTimestamp: '20261112T055012.000Z' }, s, now), { id: s.id, attribution: 'timestamp' });
  assert.deepEqual(seasonForBattle({ battleTime: 73 }, s, now), { id: s.id, attribution: 'observed' });
  assert.equal(clashPerkSeason(now).id, s.id);
});
