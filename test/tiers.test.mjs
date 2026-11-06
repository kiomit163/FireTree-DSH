import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertTier,
  higherTier,
  isAtLeast,
  isTier,
  rankOf,
  TIER_LABEL,
  TIER_RANK,
  TIER_TOKEN_BUDGET,
  TIERS,
} from '../src/lib/tiers.js';

test('exposes exactly L0, L1, L2 in order and frozen', () => {
  assert.deepEqual([...TIERS], ['L0', 'L1', 'L2']);
  assert.equal(Object.isFrozen(TIERS), true);
  assert.equal(Object.isFrozen(TIER_RANK), true);
  assert.equal(Object.isFrozen(TIER_LABEL), true);
  assert.equal(Object.isFrozen(TIER_TOKEN_BUDGET), true);
});

test('recognizes only valid tier strings', () => {
  for (const tier of ['L0', 'L1', 'L2']) assert.equal(isTier(tier), true);
  for (const value of ['L3', 'l0', '', null, undefined, 0]) assert.equal(isTier(value), false);
});

test('assertTier returns valid tiers and rejects invalid ones', () => {
  assert.equal(assertTier('L1'), 'L1');
  assert.throws(() => assertTier('L3'), RangeError);
  assert.throws(() => assertTier(undefined), RangeError);
});

test('orders tiers without allowing a downgrade', () => {
  assert.equal(rankOf('L0'), 0);
  assert.equal(rankOf('L2'), 2);
  assert.equal(higherTier('L0', 'L1'), 'L1');
  assert.equal(higherTier('L2', 'L1'), 'L2');
  assert.equal(higherTier('L2', 'L2'), 'L2');
  assert.equal(isAtLeast('L2', 'L1'), true);
  assert.equal(isAtLeast('L0', 'L1'), false);
  assert.equal(isAtLeast('L1', 'L1'), true);
});

test('records the pre-registered token budgets', () => {
  assert.equal(TIER_TOKEN_BUDGET.L0, 20000);
  assert.equal(TIER_TOKEN_BUDGET.L1, 100000);
  assert.equal(TIER_TOKEN_BUDGET.L2, 400000);
});
