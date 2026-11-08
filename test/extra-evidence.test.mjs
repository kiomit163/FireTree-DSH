import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateSarif, validateSbom } from '../src/lib/extra-evidence.js';

test('SARIF requires version, runs, and driver name', () => {
  assert.deepEqual(validateSarif({ version: '2.1.0', runs: [{ tool: { driver: { name: 'golangci-lint' } }, results: [] }] }), []);
  assert.notDeepEqual(validateSarif({ version: '2.0.0', runs: [] }), []);
  assert.notDeepEqual(validateSarif({ version: '2.1.0', runs: [{ tool: {} }] }), []);
});

test('SBOM accepts SPDX-2.x and CycloneDX', () => {
  assert.deepEqual(validateSbom({ spdxVersion: 'SPDX-2.3', packages: [{ name: 'x' }] }), []);
  assert.deepEqual(validateSbom({ bomFormat: 'CycloneDX', components: [] }), []);
  assert.notDeepEqual(validateSbom({ spdxVersion: 'SPDX-3.0', packages: [] }), []);
  assert.notDeepEqual(validateSbom({ something: 'else' }), []);
});
