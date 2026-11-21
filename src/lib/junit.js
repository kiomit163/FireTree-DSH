/** JUnit XML validation using a maintained XML parser, with strict security limits. */

import { XMLParser, XMLValidator } from 'fast-xml-parser';

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_TESTCASES = 2_000_000;

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function attribute(node, name) {
  const value = node?.[`@_${name}`];
  return value === undefined ? undefined : String(value);
}

function integer(value, label, gaps, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    gaps.push(`${label} is not an integer`);
    return 0;
  }
  return Number(value);
}

function collectSuites(node, output) {
  if (node === undefined || node === null || typeof node !== 'object') return;
  if (Object.hasOwn(node, 'testsuite')) {
    for (const suite of asArray(node.testsuite)) {
      output.suites.push(suite);
      collectSuites(suite, output);
    }
  }
  for (const testcase of asArray(node.testcase)) {
    output.testcases.push(testcase);
    for (const failure of asArray(testcase.failure)) output.failures.push(failure);
    for (const error of asArray(testcase.error)) output.errors.push(error);
    for (const skipped of asArray(testcase.skipped)) output.skipped.push(skipped);
  }
  for (const child of asArray(node.testsuites)) {
    output.suites.push(child);
    collectSuites(child, output);
  }
}

/**
 * Validate a JUnit XML file for the pilot: well-formed envelope, numeric counts,
 * zero failures/errors, at least one test, and no failure/error elements.
 *
 * @param {string} text - JUnit XML.
 * @returns {{valid: boolean, gaps: string[], totals: {tests: number, failures: number, errors: number, skipped: number}}} Result.
 */
export function validateJunitXml(text) {
  const gaps = [];
  const totals = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  if (typeof text !== 'string' || text.trim().length === 0) return { valid: false, gaps: ['JUnit XML is empty'], totals };
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { valid: false, gaps: [`JUnit XML exceeds ${MAX_BYTES} bytes`], totals };
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
    return { valid: false, gaps: ['JUnit XML contains a DOCTYPE or ENTITY declaration'], totals };
  }
  const valid = XMLValidator.validate(text);
  if (valid !== true) {
    return { valid: false, gaps: [`JUnit XML is not well-formed: ${valid.err?.msg ?? 'invalid XML'}`], totals };
  }

  let parsed;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: false,
      parseTagValue: false,
      parseAttributeValue: false,
      processEntities: false,
      htmlEntities: false,
      trimValues: false,
      ignoreDeclaration: true,
      ignorePiTags: true,
    }).parse(text);
  } catch (error) {
    return { valid: false, gaps: [`JUnit XML parse failed: ${error instanceof Error ? error.message : String(error)}`], totals };
  }

  const root = parsed?.testsuites ?? parsed?.testsuite;
  if (root === undefined) return { valid: false, gaps: ['JUnit XML has no testsuites/testsuite root'], totals };
  const collected = { suites: [], testcases: [], failures: [], errors: [], skipped: [] };
  let rootDeclaredTests;
  if (parsed?.testsuites !== undefined) {
    // Node's JUnit reporter emits testcase elements directly under testsuites
    // without a wrapper testsuite. Accept that shape as long as testcases exist.
    if (typeof parsed.testsuites === 'object' && parsed.testsuites !== null) {
      const root = parsed.testsuites;
      rootDeclaredTests = integer(attribute(root, 'tests'), 'testsuites tests', gaps, undefined);
      const rootFailures = integer(attribute(root, 'failures'), 'testsuites failures', gaps, 0);
      const rootErrors = integer(attribute(root, 'errors'), 'testsuites errors', gaps, 0);
      const rootSkipped = integer(attribute(root, 'skipped'), 'testsuites skipped', gaps, 0);
      totals.failures += rootFailures;
      totals.errors += rootErrors;
      totals.skipped += rootSkipped;
    }
    for (const testcase of asArray(parsed.testsuites.testcase)) {
      collected.testcases.push(testcase);
      for (const failure of asArray(testcase.failure)) collected.failures.push(failure);
      for (const error of asArray(testcase.error)) collected.errors.push(error);
      for (const skipped of asArray(testcase.skipped)) collected.skipped.push(skipped);
    }
    for (const child of asArray(parsed.testsuites.testsuite)) {
      collected.suites.push(child);
      collectSuites(child, collected);
    }
    collected.failures.push(...asArray(parsed.testsuites.failure));
    collected.errors.push(...asArray(parsed.testsuites.error));
  } else {
    collected.suites.push(parsed.testsuite);
    collectSuites(parsed.testsuite, collected);
  }

  if (rootDeclaredTests !== undefined && rootDeclaredTests > collected.testcases.length) {
    gaps.push(`testsuites declares ${rootDeclaredTests} tests but only ${collected.testcases.length} testcase elements exist`);
  }
  if (collected.suites.length === 0 && collected.testcases.length === 0) gaps.push('JUnit XML has no testsuite or testcase elements');
  if (collected.testcases.length === 0) gaps.push('JUnit XML has no testcase elements');
  if (collected.testcases.length > MAX_TESTCASES) gaps.push(`JUnit XML exceeds ${MAX_TESTCASES} testcases`);
  totals.tests = collected.testcases.length;

  for (const suite of collected.suites) {
    const declaredTests = integer(attribute(suite, 'tests'), 'testsuite tests', gaps, undefined);
    const failures = integer(attribute(suite, 'failures'), 'testsuite failures', gaps, 0);
    const errors = integer(attribute(suite, 'errors'), 'testsuite errors', gaps, 0);
    const skipped = integer(attribute(suite, 'skipped'), 'testsuite skipped', gaps, 0);
    if (declaredTests !== undefined && declaredTests > collected.testcases.length) {
      gaps.push(`testsuite declares ${declaredTests} tests but only ${collected.testcases.length} testcase elements exist`);
    }
    totals.failures += failures;
    totals.errors += errors;
    totals.skipped += skipped;
  }
  totals.failures += collected.failures.length;
  totals.errors += collected.errors.length;
  totals.skipped += collected.skipped.length;

  if (totals.tests === 0) gaps.push('JUnit XML reports zero tests');
  if (totals.failures !== 0) gaps.push(`JUnit XML reports ${totals.failures} failures`);
  if (totals.errors !== 0) gaps.push(`JUnit XML reports ${totals.errors} errors`);
  return { valid: gaps.length === 0, gaps, totals };
}
