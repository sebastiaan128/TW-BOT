// test/diff.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots } from '../src/diff.js';

const prev = { players: {
  '#A': { name: 'Alice', tier: 'II' },  // -> promotes to I
  '#B': { name: 'Bob', tier: 'I' },     // -> demotes to II
  '#C': { name: 'Carol', tier: 'I' },   // -> stays I
  '#D': { name: 'Dave', tier: 'II' },   // -> drops to III (ignored)
  '#E': { name: 'Eve', tier: 'I' },     // -> leaves (ignored)
} };
const curr = { players: {
  '#A': { name: 'Alice', tier: 'I' },
  '#B': { name: 'Bob', tier: 'II' },
  '#C': { name: 'Carol', tier: 'I' },
  '#D': { name: 'Dave', tier: 'III' },
  '#F': { name: 'Frank', tier: 'I' },   // -> new player (ignored)
} };

test('diffSnapshots detects only I<->II transitions', () => {
  const { promotions, demotions } = diffSnapshots(prev, curr);
  assert.deepEqual(promotions, [{ tag: '#A', name: 'Alice' }]);
  assert.deepEqual(demotions, [{ tag: '#B', name: 'Bob' }]);
});

test('diffSnapshots returns empty when previous is null', () => {
  assert.deepEqual(diffSnapshots(null, curr), { promotions: [], demotions: [] });
});
