// test/coc.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTier } from '../src/coc.js';

test('getTier reads Legend tiers from league name', () => {
  assert.equal(getTier({ league: { name: 'Legend League I' } }), 'I');
  assert.equal(getTier({ league: { name: 'Legend League II' } }), 'II');
  assert.equal(getTier({ league: { name: 'Legend League III' } }), 'III');
});

test('getTier handles digit form', () => {
  assert.equal(getTier({ league: { name: 'Legend League 1' } }), 'I');
  assert.equal(getTier({ league: { name: 'Legend League 2' } }), 'II');
});

test('getTier returns null for non-legend or missing league', () => {
  assert.equal(getTier({ league: { name: 'Titan League I' } }), null);
  assert.equal(getTier({}), null);
  assert.equal(getTier({ league: null }), null);
});
