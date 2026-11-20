/** Verify GitHub artifact attestations through the GitHub CLI (Fulcio/Rekor keyless path). */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { sha256File } from './artifacts.js';

/** Attestation verification failure. */
export class AttestationError extends Error {
  /**
   * @param {string} code - Stable code.
   * @param {string} message - Human-readable message.
   */
  constructor(code, message) {
    super(message);
    this.name = 'AttestationError';
    this.code = code;
  }
}

/**
 * Parse the JSON emitted by `gh attestation verify --format json`.
 *
 * @param {unknown} value - Parsed output.
 * @param {string} digest - SHA-256 of the artifact being verified.
 * @returns {{valid: boolean, attestations: number, reason: string|null}} Result.
 */
export function parseAttestationVerification(value, digest) {
  const attestations = Array.isArray(value) ? value : [value];
  if (attestations.length === 0 || attestations[0] === undefined || attestations[0] === null) {
    return { valid: false, attestations: 0, reason: 'gh returned no verified attestations' };
  }
  const match = attestations.some((item) => {
    const subjects = item?.verificationResult?.statement?.subject;
    if (!Array.isArray(subjects)) return false;
    return subjects.some((subject) => subject?.digest?.sha256 === digest);
  });
  if (!match) return { valid: false, attestations: attestations.length, reason: 'attestation subject digest does not match artifact' };
  return { valid: true, attestations: attestations.length, reason: null };
}

/**
 * Verify an artifact against a GitHub attestation bundle using `gh`.
 *
 * @param {{artifact: string, bundle: string, repository: string, signerWorkflow?: string, sourceDigest?: string, ghPath?: string, runner?: Function}} input - Verification input.
 * @returns {Promise<{valid: boolean, digest: string, attestations: number, reason: string|null}>} Result.
 */
export async function verifyGithubAttestation(input) {
  if (typeof input.artifact !== 'string' || !existsSync(input.artifact)) {
    throw new AttestationError('ARTIFACT_MISSING', `attested artifact not found: ${input.artifact}`);
  }
  if (typeof input.bundle !== 'string' || !existsSync(input.bundle)) {
    throw new AttestationError('BUNDLE_MISSING', `attestation bundle not found: ${input.bundle}`);
  }
  if (typeof input.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository)) {
    throw new AttestationError('REPOSITORY_INVALID', 'repository must be owner/repo');
  }
  const args = [
    'attestation', 'verify', input.artifact,
    '--repo', input.repository,
    '--bundle', input.bundle,
    '--format', 'json',
  ];
  if (input.signerWorkflow !== undefined) args.push('--signer-workflow', input.signerWorkflow);
  if (input.sourceDigest !== undefined) args.push('--source-digest', input.sourceDigest);
  const runner = input.runner ?? execFileSync;
  let stdout;
  try {
    stdout = runner(input.ghPath ?? 'gh', args, { encoding: 'utf8' });
  } catch (error) {
    const stderr = typeof error.stderr === 'string' ? error.stderr : error.stderr?.toString('utf8') ?? '';
    throw new AttestationError('ATTESTATION_FAILED', `gh attestation verify failed: ${stderr || error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new AttestationError('ATTESTATION_OUTPUT_INVALID', 'gh attestation verify did not return JSON');
  }
  const digest = await sha256File(input.artifact);
  const result = parseAttestationVerification(parsed, digest);
  return { ...result, digest };
}
