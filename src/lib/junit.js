/** Strict-enough JUnit XML validation without external XML dependencies. */

const ATTRIBUTE = /([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/g;

function attributes(text) {
  const result = {};
  for (const match of text.matchAll(ATTRIBUTE)) result[match[1]] = match[2];
  return result;
}

function integer(value, label, gaps, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    gaps.push(`${label} is not an integer`);
    return 0;
  }
  return Number(value);
}

/**
 * Validate a JUnit XML file for the pilot: well-formed envelope, numeric counts,
 * zero failures/errors, at least one test, and no failure/error elements.
 *
 * @param {string} text - JUnit XML.
 * @returns {{valid: boolean, gaps: string[], totals: {tests: number, failures: number, errors: number, skipped: number}}}
 */
export function validateJunitXml(text) {
  const gaps = [];
  const totals = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  if (typeof text !== 'string' || text.trim().length === 0) return { valid: false, gaps: ['JUnit XML is empty'], totals };
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) gaps.push('JUnit XML contains a DOCTYPE or ENTITY declaration');
  const trimmed = text.trim();
  const body = trimmed.replace(/^<\?xml[^>]*\?>\s*/i, '');
  const root = /^<\s*(testsuites|testsuite)\b[^>]*>/.exec(body);
  if (root === null) gaps.push('JUnit XML has no testsuites/testsuite root');
  if (!/<\/\s*(testsuites|testsuite)\s*>\s*$/.test(body)) gaps.push('JUnit XML has no closing root element');

  const suiteTags = [...body.matchAll(/<testsuite\b([^>]*)>/g)].map((match) => match[1]);
  if (suiteTags.length === 0) gaps.push('JUnit XML has no testsuite elements');

  for (const tag of suiteTags) {
    const attrs = attributes(tag);
    const tests = integer(attrs.tests, 'testsuite tests', gaps, 0);
    totals.tests += tests;
    totals.failures += integer(attrs.failures, 'testsuite failures', gaps, 0);
    totals.errors += integer(attrs.errors, 'testsuite errors', gaps, 0);
    totals.skipped += integer(attrs.skipped, 'testsuite skipped', gaps, 0);
  }
  if (totals.tests === 0) gaps.push('JUnit XML reports zero tests');
  if (totals.failures !== 0) gaps.push(`JUnit XML reports ${totals.failures} failures`);
  if (totals.errors !== 0) gaps.push(`JUnit XML reports ${totals.errors} errors`);
  if (/<failure\b|<error\b/i.test(body)) gaps.push('JUnit XML contains failure/error elements');

  return { valid: gaps.length === 0, gaps, totals };
}
