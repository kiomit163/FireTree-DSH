/** Structural coverage evidence validation (Codecov, Istanbul, LCOV). */

/**
 * @param {unknown} value - Parsed coverage JSON.
 * @returns {{valid: boolean, gaps: string[], coverage: number|null, format: string|null}} Result.
 */
export function validateCoverageJson(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { valid: false, gaps: ['coverage must be a JSON object'], coverage: null, format: null };
  }
  if (typeof value.totals === 'object' && value.totals !== null && typeof value.totals.coverage === 'number') {
    return validatePercentage(value.totals.coverage, 'Codecov', 'codecov');
  }
  if (typeof value.total === 'object' && value.total !== null) {
    const lines = value.total.lines;
    if (typeof lines === 'object' && lines !== null && typeof lines.pct === 'number') {
      return validatePercentage(lines.pct, 'Istanbul total.lines.pct', 'istanbul');
    }
  }
  for (const key of ['coverage', 'line_coverage', 'lines']) {
    if (typeof value[key] === 'number') return validatePercentage(value[key], key, 'generic');
  }
  return { valid: false, gaps: ['coverage JSON has no recognized percentage'], coverage: null, format: null };
}

function validatePercentage(value, label, format) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return { valid: false, gaps: [`${label} must be a percentage between 0 and 100`], coverage: null, format };
  }
  return { valid: true, gaps: [], coverage: value, format };
}

/**
 * @param {string} text - Coverage file text (JSON or LCOV).
 * @returns {{valid: boolean, gaps: string[], coverage: number|null, format: string|null}} Result.
 */
export function validateCoverageText(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { valid: false, gaps: ['coverage file is empty'], coverage: null, format: null };
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    let value;
    try {
      value = JSON.parse(trimmed);
    } catch (error) {
      return { valid: false, gaps: [`coverage JSON is invalid: ${error instanceof Error ? error.message : String(error)}`], coverage: null, format: null };
    }
    return validateCoverageJson(value);
  }
  const linesFound = /^LF:(\d+)$/gm;
  const linesHit = /^LH:(\d+)$/gm;
  const found = [...trimmed.matchAll(linesFound)].reduce((sum, match) => sum + Number(match[1]), 0);
  const hit = [...trimmed.matchAll(linesHit)].reduce((sum, match) => sum + Number(match[1]), 0);
  if (found === 0) return { valid: false, gaps: ['coverage file is neither JSON nor LCOV with LF/LH records'], coverage: null, format: null };
  const coverage = (hit / found) * 100;
  if (!Number.isFinite(coverage) || coverage < 0 || coverage > 100) {
    return { valid: false, gaps: ['LCOV coverage must be between 0 and 100'], coverage: null, format: null };
  }
  return { valid: true, gaps: [], coverage, format: 'lcov' };
}
