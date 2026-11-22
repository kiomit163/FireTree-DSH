import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyzeImpact } from '../src/lib/impact.js';
import { evaluatePolicy } from '../src/lib/policy.js';

test('a policy exception cannot waive a protected-path L2 trigger', () => {
  const policy = {
    triggers: { L2: [] },
    exceptions: [{
      id: 'waive-cross-subsystem',
      scope: 'chg-protected',
      waives: ['cross-subsystem'],
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2030-01-01T00:00:00Z',
    }],
  };
  const decision = evaluatePolicy(policy, {
    change: 'chg-protected',
    files: ['.firetree/policy.json'],
    rawTier: 'L2',
    reasons: ['protected path: .firetree/policy.json', 'cross-subsystem: core, governance'],
    now: new Date('2026-06-01T00:00:00Z'),
  });
  assert.equal(decision.tier, 'L2');
  assert.ok(decision.reasons.includes('exception active: waive-cross-subsystem'));
});

test('control-defining paths are always L2 even when registered', () => {
  const subsystems = [{
    id: 'governance',
    paths: ['.firetree/**', '.gitignore', '.github/workflows/**'],
    owners: ['@owner'],
  }];
  for (const file of ['.firetree/policy.json', '.gitignore', '.github/workflows/ci.yml']) {
    const result = analyzeImpact({ files: [file], subsystems, interfaces: [] });
    assert.equal(result.auto_tier, 'L2', file);
    assert.ok(result.reasons.some((reason) => /protected path/.test(reason)), file);
  }
});
