import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import { analyzeImpact } from '../src/lib/impact.js';
import { loadRegistry } from '../src/lib/registry.js';

test('every tracked path is covered by a subsystem or explicit policy', async () => {
  const root = process.cwd();
  const registry = await loadRegistry(root);
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file.length > 0);
  const analysis = analyzeImpact({
    files,
    subsystems: registry.subsystems,
    interfaces: registry.interfaces,
  });
  assert.deepEqual(analysis.impact.unknown, [], `uncovered paths: ${analysis.impact.unknown.join(', ')}`);
});
