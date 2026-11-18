/** OIDC workload-identity claims used to derive assurance. */

import { sha256Text } from './artifacts.js';
import { canonicalJson } from './json.js';

/** Identity verification failure. */
export class IdentityError extends Error {
  /**
   * @param {string} code - Stable code.
   * @param {string} message - Human-readable message.
   */
  constructor(code, message) {
    super(message);
    this.name = 'IdentityError';
    this.code = code;
  }
}

const DEFAULT_ISSUER = 'https://token.actions.githubusercontent.com';
const DEFAULT_EVENTS = ['pull_request', 'push', 'workflow_dispatch'];

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

/**
 * Normalize a GitHub Actions OIDC claims object.
 *
 * @param {unknown} value - Parsed claims JSON.
 * @returns {object} Normalized claims.
 */
export function parseOidcClaims(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IdentityError('INVALID_CLAIMS', 'claims must be a JSON object');
  }
  const claims = value;
  const required = ['iss', 'aud', 'repository', 'workflow_ref', 'ref', 'sha', 'event_name', 'run_id'];
  for (const key of required) {
    if (typeof claims[key] !== 'string' || claims[key].length === 0) {
      throw new IdentityError('INVALID_CLAIMS', `claims.${key} must be a non-empty string`);
    }
  }
  if (!/^[a-f0-9]{7,64}$/.test(claims.sha)) throw new IdentityError('INVALID_CLAIMS', 'claims.sha must be a commit SHA');
  if (!/^\d+$/.test(claims.run_id)) throw new IdentityError('INVALID_CLAIMS', 'claims.run_id must be numeric');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(claims.repository)) {
    throw new IdentityError('INVALID_CLAIMS', 'claims.repository must be owner/repo');
  }
  return {
    iss: claims.iss,
    aud: asArray(claims.aud).filter((item) => typeof item === 'string' && item.length > 0),
    repository: claims.repository,
    workflow_ref: claims.workflow_ref,
    ref: claims.ref,
    sha: claims.sha.toLowerCase(),
    event_name: claims.event_name,
    run_id: claims.run_id,
    ...(typeof claims.run_attempt === 'string' && /^\d+$/.test(claims.run_attempt)
      ? { run_attempt: claims.run_attempt }
      : {}),
    ...(typeof claims.actor === 'string' && claims.actor.length > 0 ? { actor: claims.actor } : {}),
  };
}

/**
 * Verify normalized claims against the expected verifier policy.
 *
 * @param {object} claims - Normalized claims.
 * @param {{issuer?: string, audience?: string, repository?: string, workflowRef?: string, sha?: string, events?: string[]}} [policy] - Expected policy.
 * @returns {{valid: boolean, failures: string[], claimsSha256: string}} Result.
 */
export function verifyClaims(claims, policy = {}) {
  const failures = [];
  const issuer = policy.issuer ?? DEFAULT_ISSUER;
  if (claims.iss !== issuer) failures.push(`issuer must be ${issuer}`);
  if (policy.audience !== undefined && !claims.aud.includes(policy.audience)) {
    failures.push(`audience must include ${policy.audience}`);
  }
  if (policy.repository !== undefined && claims.repository !== policy.repository) {
    failures.push(`repository must be ${policy.repository}`);
  }
  if (policy.workflowRef !== undefined && claims.workflow_ref !== policy.workflowRef) {
    failures.push(`workflow_ref must be ${policy.workflowRef}`);
  } else if (!claims.workflow_ref.startsWith(`${claims.repository}/`)) {
    failures.push('workflow_ref does not belong to repository');
  }
  if (policy.sha !== undefined && claims.sha !== policy.sha.toLowerCase()) {
    failures.push('claims.sha does not match change head');
  }
  const events = policy.events ?? DEFAULT_EVENTS;
  if (!events.includes(claims.event_name)) failures.push(`event_name ${claims.event_name} is not allowed`);
  return {
    valid: failures.length === 0,
    failures,
    claimsSha256: sha256Text(canonicalJson(claims)),
  };
}

/**
 * @param {object} claims - Normalized claims.
 * @returns {{type: 'ci', id: string, repository: string, workflow_ref: string, run_id: string, claims_sha256: string}} Producer identity.
 */
export function producerFromClaims(claims) {
  return {
    type: 'ci',
    id: 'github-actions',
    repository: claims.repository,
    workflow_ref: claims.workflow_ref,
    run_id: claims.run_id,
    claims_sha256: sha256Text(canonicalJson(claims)),
  };
}

export { DEFAULT_EVENTS, DEFAULT_ISSUER };
