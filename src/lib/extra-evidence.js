/** Minimal structural validation for SARIF and SBOM evidence files. */

export function validateSarif(value) {
  const gaps = [];
  if (value === null || typeof value !== 'object') return ['SARIF must be a JSON object'];
  if (value.version !== '2.1.0') gaps.push('SARIF version must be 2.1.0');
  if (!Array.isArray(value.runs) || value.runs.length === 0) {
    gaps.push('SARIF must contain at least one run');
    return gaps;
  }
  for (const [index, run] of value.runs.entries()) {
    if (run === null || typeof run !== 'object') {
      gaps.push(`SARIF run ${index} must be an object`);
      continue;
    }
    const driver = run.tool?.driver;
    if (driver === null || typeof driver !== 'object' || typeof driver.name !== 'string' || driver.name.length === 0) {
      gaps.push(`SARIF run ${index} has no tool.driver.name`);
    }
    if (run.results !== undefined && !Array.isArray(run.results)) gaps.push(`SARIF run ${index} results must be an array`);
  }
  return gaps;
}

export function validateSbom(value) {
  if (value === null || typeof value !== 'object') return ['SBOM must be a JSON object'];
  if (typeof value.spdxVersion === 'string') {
    const gaps = [];
    if (!/^SPDX-2\./.test(value.spdxVersion)) gaps.push('SPDX version must be SPDX-2.x');
    if (!Array.isArray(value.packages) || value.packages.length === 0) gaps.push('SPDX SBOM must contain packages');
    return gaps;
  }
  if (value.bomFormat === 'CycloneDX') {
    const gaps = [];
    if (!Array.isArray(value.components)) gaps.push('CycloneDX SBOM must contain components');
    return gaps;
  }
  return ['SBOM must be SPDX-2.x or CycloneDX'];
}
