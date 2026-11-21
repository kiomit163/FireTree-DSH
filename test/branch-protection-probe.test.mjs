import assert from 'node:assert/strict';
import { test } from 'node:test';

test('intentional branch-protection failure probe', () => {
  assert.equal(1, 2);
});
