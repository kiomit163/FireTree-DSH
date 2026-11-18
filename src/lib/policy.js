/** Policy chain resolution: tighten-only inheritance, digest, and validation. */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readJsonFile, resolveWithin, sha256Text } from './artifacts.js';
import { canonicalJson } from './json.js';
import { validateJsonSchema } from './schema.js';

const POLICY_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/policy.schema.json', import.meta.url), 'utf8'));

const SIGNOFF_RANK = { none: 0, peer: 1, human: 2 };
const CORRECTNESS_RANK = { none: 0, light: 1, full: 2 };

/** Policy load/merge failure. */
export class PolicyError extends Error {
  /**
   * @param {string} code - Stable code.
   * @param {string} message - Human-readable message.
   * @param {{path?: string, errors?: object[]}} [details] - Details.
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
    this.path = details.path;
    this.errors = details.errors ?? [];
  }
}

/**
 * @param {object} policy - Policy value.
 * @returns {string} Content digest excluding the version field.
 */
export function policyDigest(policy) {
  const { version, ...rest } = policy;
  return sha256Text(canonicalJson(rest));
}

function mergeTier(name, parent, child, path) {
  if (child.sample_rate < parent.sample_rate) {
    throw new PolicyError('POLICY_RELAXATION', `${path}: ${name}.sample_rate cannot decrease`);
  }
  if (child.review_rounds < parent.review_rounds) {
    throw new PolicyError('POLICY_RELAXATION', `${path}: ${name}.review_rounds cannot decrease`);
  }
  if (SIGNOFF_RANK[child.signoff] < SIGNOFF_RANK[parent.signoff]) {
    throw new PolicyError('POLICY_RELAXATION', `${path}: ${name}.signoff cannot weaken`);
  }
  if (CORRECTNESS_RANK[child.correctness_case] < CORRECTNESS_RANK[parent.correctness_case]) {
    throw new PolicyError('POLICY_RELAXATION', `${path}: ${name}.correctness_case cannot weaken`);
  }
  if (child.token_budget > parent.token_budget) {
    throw new PolicyError('POLICY_RELAXATION', `${path}: ${name}.token_budget cannot increase`);
  }
  return {
    sample_rate: Math.max(parent.sample_rate, child.sample_rate),
    review_rounds: Math.max(parent.review_rounds, child.review_rounds),
    signoff: SIGNOFF_RANK[child.signoff] >= SIGNOFF_RANK[parent.signoff] ? child.signoff : parent.signoff,
    correctness_case: CORRECTNESS_RANK[child.correctness_case] >= CORRECTNESS_RANK[parent.correctness_case]
      ? child.correctness_case
      : parent.correctness_case,
    token_budget: Math.min(parent.token_budget, child.token_budget),
  };
}

/**
 * Merge a child policy over its parent. Only tightening is allowed.
 *
 * @param {object} parent - Parent policy.
 * @param {object} child - Child policy.
 * @param {string} [path] - Source label for errors.
 * @returns {object} Merged policy (version not recomputed).
 */
export function mergePolicies(parent, child, path = 'policy') {
  return {
    schema: child.schema,
    version: child.version,
    scope: child.scope,
    extends: child.extends,
    tiers: {
      L0: mergeTier('L0', parent.tiers.L0, child.tiers.L0, path),
      L1: mergeTier('L1', parent.tiers.L1, child.tiers.L1, path),
      L2: mergeTier('L2', parent.tiers.L2, child.tiers.L2, path),
    },
    triggers: {
      L0: [...new Set([...parent.triggers.L0, ...child.triggers.L0])],
      L1: [...new Set([...parent.triggers.L1, ...child.triggers.L1])],
      L2: [...new Set([...parent.triggers.L2, ...child.triggers.L2])],
    },
    sampling: child.sampling,
    exceptions: [...parent.exceptions, ...child.exceptions],
    inheritance: child.inheritance,
  };
}

async function loadOne(root, policyPath, seen) {
  if (seen.has(policyPath)) throw new PolicyError('POLICY_CYCLE', `policy inheritance cycle at ${policyPath}`);
  seen.add(policyPath);
  const file = resolveWithin(root, policyPath);
  let value;
  try {
    value = await readJsonFile(file);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'READ_FAILED' && error.cause?.code === 'ENOENT') {
      throw new PolicyError('POLICY_MISSING', `policy not found at ${policyPath}`, { path: policyPath });
    }
    throw error;
  }
  const errors = validateJsonSchema(value, POLICY_SCHEMA);
  if (errors.length > 0) throw new PolicyError('SCHEMA_INVALID', `${policyPath} does not match its schema`, { path: policyPath, errors });

  let resolved = value;
  if (typeof value.extends === 'string') {
    const parentPath = join(dirname(policyPath), value.extends).replaceAll('\\', '/');
    const parent = await loadOne(root, parentPath, seen);
    resolved = mergePolicies(parent, value, policyPath);
  }
  resolved.version = policyDigest(resolved);
  const finalErrors = validateJsonSchema(resolved, POLICY_SCHEMA);
  if (finalErrors.length > 0) throw new PolicyError('SCHEMA_INVALID', `${policyPath} merged policy is invalid`, { path: policyPath, errors: finalErrors });
  return resolved;
}

/**
 * Load a policy and resolve its `extends` chain.
 *
 * @param {string} root - Repository root.
 * @param {string} [policyPath] - Repo-relative policy path.
 * @returns {Promise<object>} Resolved policy with a content digest in `version`.
 */
export async function loadPolicyChain(root, policyPath = '.firetree/policy.json') {
  return loadOne(root, policyPath, new Set());
}

export { POLICY_SCHEMA };
