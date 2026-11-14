import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankingText, enqueueReports, statusReport } from '../src/reports.js';
import { fixture, monday } from './support/fixtures.js';

test('leaderboard counts one-stars independently of message delivery, with clan filtering', (t) => {
  const { store, config } = fixture(t);
  const record = (id, player, clan, stars) => store.recordAttack({ id, player, clan, name: `${player} @everyone`, stars, destruction: 70, season: 'S1', observed: monday, attribution: 'api' });
  record('a', '#P0', '#C0', 1); record('b', '#P0', '#C0', 3); record('c', '#P2', '#C2', 1);
  record('a', '#P0', '#C0', 1);
  assert.equal(store.ranking('S1', { clan: '#C0' })[0].attacks, 2);
  assert.match(rankingText(store, config, { season: 'S1', clan: '#C0' }), /50%/);
  assert.doesNotMatch(rankingText(store, config, { season: 'S1' }), /@everyone/);
});
test('season rollover creates a final ranking only once, not every run', (t) => {
  const { store, config } = fixture(t);
  store.set('season', { id: 'S1' }); enqueueReports(store, config, monday);
  store.set('season', { id: 'S2' }); enqueueReports(store, config, monday + 1);
  enqueueReports(store, config, monday + 2);
  assert.equal(store.events().filter((e) => e.type === 'ranking').length, 1);
});
test('weekly report waits until recovery completes and requires this weeks coverage', (t) => {
  const { store, config } = fixture(t); store.set('health:movements', { at: monday });
  enqueueReports(store, config, monday);
  assert.equal(store.events().length, 0);
  enqueueReports(store, config, Date.parse('2026-11-11T18:00:00Z'));
  enqueueReports(store, config, Date.parse('2026-11-11T19:00:00Z'));
  assert.equal(store.events().filter((e) => e.type === 'summary').length, 1);
});
test('monitoring distinguishes idle movement window from failed or stale scans', (t) => {
  const { store, config } = fixture(t);
  assert.equal(statusReport(store, config, monday).tasks.movements.stale, true);
  assert.equal(statusReport(store, config, monday + 3 * 86400000).tasks.movements.stale, false);
  store.set('health:attacks', { at: monday, failed: [{ clan: '#C0' }] });
  assert.equal(statusReport(store, config, monday).ok, false);
});
