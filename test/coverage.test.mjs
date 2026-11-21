import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateCoverageJson, validateCoverageText } from '../src/lib/coverage.js';

test('coverage accepts Codecov, Istanbul, generic, and LCOV formats', () => {
  assert.deepEqual(validateCoverageText('{"totals":{"coverage":91.25}}').gaps, []);
  assert.equal(validateCoverageText('{"totals":{"coverage":91.25}}').coverage, 91.25);
  assert.equal(validateCoverageJson({ total: { lines: { pct: 80 } } }).format, 'istanbul');
  assert.equal(validateCoverageJson({ coverage: 0.9 }).coverage, 0.9);
  const lcov = validateCoverageText('TN:\nSF:a.js\nLF:10\nLH:9\nend_of_record\n');
  assert.equal(lcov.valid, true);
  assert.equal(lcov.format, 'lcov');
  assert.equal(lcov.coverage, 90);
});

test('coverage rejects missing or out-of-range percentages', () => {
  assert.equal(validateCoverageText('').valid, false);
  assert.equal(validateCoverageText('{"something":true}').valid, false);
  assert.equal(validateCoverageJson({ totals: { coverage: 140 } }).valid, false);
  assert.equal(validateCoverageText('not coverage').valid, false);
  assert.equal(validateCoverageText('LF:1\nLH:5\n').valid, false);
});
