/** Assurance levels derived by a verifier, never taken from the caller. */

export const ASSURANCE_LEVELS = Object.freeze(['A0', 'A1', 'A2', 'A3-AI-S', 'A3-AI', 'A3']);

/**
 * Derive assurance from externally verifiable facts.
 *
 * - A0: self-declared, no evidence.
 * - A1: local deterministic evidence (or local file hashes).
 * - A2: CI OIDC claims + CI-produced evidence.
 * - A3-AI-S: A2 + single-provider adversarial AI review + signed/attested bundle.
 * - A3-AI: A2 + multi-provider adversarial AI review + signed/attested bundle.
 * - A3: A2 + verified human approval + a signed/attested bundle.
 *
 * @param {{claimsValid?: boolean, claims?: object|null, evidence?: object[], approval?: {verified?: boolean}|null, aiReview?: {valid?: boolean, mode?: string}|null, signed?: boolean, attested?: boolean}} input - Facts.
 * @returns {{level: 'A0'|'A1'|'A2'|'A3-AI-S'|'A3-AI'|'A3', reasons: string[]}} Derived level.
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
  const provenance = input.signed === true || input.attested === true;
  const aiMode = input.aiReview?.mode;
  const aiValid = input.aiReview?.valid === true && (aiMode === 'single-provider' || aiMode === 'multi-provider');
  if (level === 'A2' && input.approval?.verified === true && provenance) {
    level = 'A3';
    reasons.push('verified human approval and signed/attested bundle present');
  } else if (level === 'A2' && aiValid && provenance) {
    level = aiMode === 'multi-provider' ? 'A3-AI' : 'A3-AI-S';
    reasons.push(`${level} derives from adversarial AI review and a signed/attested bundle`);
  } else if (level === 'A2' && aiValid && !provenance) {
    reasons.push('A3-AI requires adversarial AI review and a signed/attested bundle');
  } else if (level === 'A2') {
    reasons.push('A3 requires verified human approval or adversarial AI review and a signed/attested bundle');
  }
  return { level, reasons };
}

/**
 * @param {string} level - Actual level.
 * @param {string} required - Required level.
 * @returns {boolean} Whether actual meets required.
 */
export function atLeast(level, required) {
  const actual = ASSURANCE_LEVELS.indexOf(level);
  const expected = ASSURANCE_LEVELS.indexOf(required);
  return actual >= 0 && expected >= 0 && actual >= expected;
}
