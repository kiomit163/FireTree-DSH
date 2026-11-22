import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadPolicyChain } from '../src/lib/policy.js';

test('repository policy keeps a human spot-check rate for L0', async () => {
  const policy = await loadPolicyChain(process.cwd());
  assert.ok(policy.tiers.L0.sample_rate >= 0.1, 'L0 sample_rate must remain at least 10%');
});
