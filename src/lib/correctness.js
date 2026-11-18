/** Correctness-case v0 validation: schema plus claim coverage and residual acceptance. */

import { validateJsonSchema } from './schema.js';

function push(errors, path, keyword, message) {
  errors.push({ path, keyword, message });
}

/**
 * Validate a correctness-case file.
 *
 * The schema enforces the shape. This checker adds the cross-field rules JSON
 * Schema cannot express: every claim is mapped, every mapping references known
 * claims and invariants, every mapping has at least one evidence reference,
 * and every residual is human-accepted and unexpired.
 *
 * @param {unknown} value - Correctness-case value.
 * @param {object} schema - `#/$defs/correctnessCase` from receipt.schema.json.
 * @param {{now?: Date, rootSchema?: object, evidenceRefs?: string[]}} [options] - Clock, root schema, and known evidence references.
 * @returns {{valid: boolean, errors: Array<{path: string, keyword: string, message: string}>}} Result.
 */
export function validateCorrectnessCase(value, schema, options = {}) {
  const errors = validateJsonSchema(value, schema, { rootSchema: options.rootSchema ?? schema });
  if (errors.length > 0) return { valid: false, errors };

  const evidenceRefs = options.evidenceRefs === undefined ? null : new Set(options.evidenceRefs);
  const now = options.now ?? new Date();
  const claims = new Map();
  for (let index = 0; index < value.claims.length; index += 1) {
    const claim = value.claims[index];
    if (claims.has(claim.id)) push(errors, `$.claims[${index}].id`, 'unique', `duplicate claim id "${claim.id}"`);
    claims.set(claim.id, claim);
  }

  const invariants = new Map();
  for (let index = 0; index < value.invariants.length; index += 1) {
    const invariant = value.invariants[index];
    if (invariants.has(invariant.id)) push(errors, `$.invariants[${index}].id`, 'unique', `duplicate invariant id "${invariant.id}"`);
    invariants.set(invariant.id, invariant);
  }

  const mappedClaims = new Set();
  for (let index = 0; index < value.mapping.length; index += 1) {
    const mapping = value.mapping[index];
    if (!claims.has(mapping.claim_id)) {
      push(errors, `$.mapping[${index}].claim_id`, 'coverage', `unknown claim "${mapping.claim_id}"`);
    } else {
      mappedClaims.add(mapping.claim_id);
    }

    if (mapping.invariant_ids.length === 0) {
      push(errors, `$.mapping[${index}].invariant_ids`, 'coverage', 'a mapping needs at least one invariant');
    }
    for (let invariantIndex = 0; invariantIndex < mapping.invariant_ids.length; invariantIndex += 1) {
      const id = mapping.invariant_ids[invariantIndex];
      if (!invariants.has(id)) {
        push(errors, `$.mapping[${index}].invariant_ids[${invariantIndex}]`, 'coverage', `unknown invariant "${id}"`);
      }
    }

    if (mapping.evidence_refs.length === 0) {
      push(errors, `$.mapping[${index}].evidence_refs`, 'coverage', 'a mapping needs at least one evidence reference');
    }
    if (evidenceRefs !== null) {
      for (let refIndex = 0; refIndex < mapping.evidence_refs.length; refIndex += 1) {
        const ref = mapping.evidence_refs[refIndex];
        if (!evidenceRefs.has(ref)) {
          push(errors, `$.mapping[${index}].evidence_refs[${refIndex}]`, 'evidence_ref', `unknown evidence reference "${ref}"`);
        }
      }
    }
  }

  for (let index = 0; index < value.invariants.length; index += 1) {
    const invariant = value.invariants[index];
    if (evidenceRefs !== null && !evidenceRefs.has(invariant.evidence_ref)) {
      push(errors, `$.invariants[${index}].evidence_ref`, 'evidence_ref', `unknown evidence reference "${invariant.evidence_ref}"`);
    }
  }

  for (const [claimId] of claims) {
    if (!mappedClaims.has(claimId)) {
      push(errors, '$', 'mapping', `claim "${claimId}" has no mapping (empty mapping is rejected)`);
    }
  }

  for (let index = 0; index < value.residual.length; index += 1) {
    const residual = value.residual[index];
    if (!claims.has(residual.claim_id)) {
      push(errors, `$.residual[${index}].claim_id`, 'coverage', `unknown claim "${residual.claim_id}"`);
    }
    if (!residual.accepted_by.startsWith('human:')) {
      push(errors, `$.residual[${index}].accepted_by`, 'human_signoff', 'residual risk must be accepted by a human');
    }
    const expiresAt = Date.parse(residual.expires_at);
    if (Number.isNaN(expiresAt)) {
      push(errors, `$.residual[${index}].expires_at`, 'format', 'residual expiry must be a date-time');
    } else if (expiresAt <= now.getTime()) {
      push(errors, `$.residual[${index}].expires_at`, 'expired', 'residual acceptance has expired');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * @param {unknown} value - Correctness-case value.
 * @param {object} schema - Correctness-case schema.
 * @param {{now?: Date, rootSchema?: object, evidenceRefs?: string[]}} [options] - Clock, root schema, and known evidence references.
 * @returns {void}
 */
export function assertCorrectnessCase(value, schema, options = {}) {
  const result = validateCorrectnessCase(value, schema, options);
  if (!result.valid) {
    throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join('; '));
  }
}
