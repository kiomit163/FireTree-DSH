import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateJunitXml } from '../src/lib/junit.js';

test('valid JUnit with zero failures passes strict checks', () => {
  const result = validateJunitXml('<?xml version="1.0"?><testsuites><testsuite tests="2" failures="0" errors="0" skipped="1"><testcase name="a"/><testcase name="b"/></testsuite></testsuites>');
  assert.equal(result.valid, true);
  assert.deepEqual(result.totals, { tests: 2, failures: 0, errors: 0, skipped: 1 });
});

test('JUnit failures, zero tests, and malformed roots are rejected', () => {
  assert.equal(validateJunitXml('<testsuite tests="1" failures="1"/>').valid, false);
  assert.equal(validateJunitXml('<testsuites><testsuite tests="0" failures="0"/></testsuites>').valid, false);
  assert.equal(validateJunitXml('not xml').valid, false);
  assert.equal(validateJunitXml('<!DOCTYPE x><testsuites><testsuite tests="1"/></testsuites>').valid, false);
  assert.equal(validateJunitXml('<testsuites><testsuite tests="1" failures="0"><failure/></testsuite></testsuites>').valid, false);
});
