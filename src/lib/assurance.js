/** Assurance levels derived by a verifier, never taken from the caller. */

export const ASSURANCE_LEVELS = Object.freeze(['A0', 'A1', 'A2', 'A3']);

/**
 * Derive assurance from externally verifiable facts.
 *
 * - A0: self-declared, no evidence.
 * - A1: local deterministic evidence (or local file hashes).
 * - A2: CI OIDC claims + CI-produced evidence.
 * - A3: A2 + verified human approval + a signed/attested bundle.
 *
 * @param {{claimsValid?: boolean, claims?: object|null, evidence?: object[], approval?: {verified?: boolean}|null, signed?: boolean}} input - Facts.
 * @returns {{level: 'A0'|'A1'|'A2'|'A3', reasons: string[]}} Derived level.
 */
export function deriveAssurance(input = {}) {
  const reasons = [];
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  let level = 'A0';
  if (evidence.length > 0) {
    level = 'A1';
    reasons.push('local or referenced evidence present');
  }
  const ciEvidence = evidence.some((item) => typeof item.producer === 'string' && item.producer.startsWith('ci:'));
  if (input.claimsValid === true && input.claims) {
    if (ciEvidence) {
      level = 'A2';
      reasons.push('CI OIDC claims verified and CI-produced evidence present');
    } else {
      reasons.push('CI claims present but evidence is not marked as CI-produced; capped at A1');
    }
  }
  if (level === 'A2' && input.approval?.verified === true && input.signed === true) {
    level = 'A3';
    reasons.push('verified human approval and signed/attested bundle present');
  } else if (level === 'A2' && (input.approval?.verified !== true || input.signed !== true)) {
    reasons.push('A3 requires verified human approval and a signed/attested bundle');
  }
  return { level, reasons };
}

/**
 * @param {string} level - Actual level.
 * @param {string} required - Required level.
 * @returns {boolean} Whether actual meets required.
 */
export function atLeast(level, required) {
  return ASSURANCE_LEVELS.indexOf(level) >= ASSURANCE_LEVELS.indexOf(required);
}
