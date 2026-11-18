/** Detached signature verification for offline A3 bundles. */

import { createPublicKey, verify } from 'node:crypto';

/** Signature verification failure. */
export class SignatureError extends Error {
  /**
   * @param {string} code - Stable code.
   * @param {string} message - Human-readable message.
   */
  constructor(code, message) {
    super(message);
    this.name = 'SignatureError';
    this.code = code;
  }
}

/**
 * Validate a signature document.
 *
 * @param {unknown} value - Signature JSON.
 * @returns {{schema: string, algorithm: string, digest: string, signature: string}} Normalized signature.
 */
export function parseSignature(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SignatureError('INVALID_SIGNATURE', 'signature must be an object');
  }
  const signature = value;
  if (signature.schema !== 'firetree.signature/v1') {
    throw new SignatureError('INVALID_SIGNATURE', 'signature schema must be firetree.signature/v1');
  }
  if (signature.algorithm !== 'ed25519') {
    throw new SignatureError('INVALID_SIGNATURE', 'signature algorithm must be ed25519');
  }
  if (typeof signature.digest !== 'string' || !/^[a-f0-9]{64}$/.test(signature.digest)) {
    throw new SignatureError('INVALID_SIGNATURE', 'signature.digest must be a lowercase SHA-256');
  }
  if (typeof signature.signature !== 'string' || signature.signature.length === 0) {
    throw new SignatureError('INVALID_SIGNATURE', 'signature.signature must be base64');
  }
  return {
    schema: 'firetree.signature/v1',
    algorithm: 'ed25519',
    digest: signature.digest,
    signature: signature.signature,
  };
}

/**
 * Verify an Ed25519 detached signature over the signed digest string.
 *
 * @param {{digest: string, signature: string}} signature - Normalized signature.
 * @param {string} expectedDigest - Digest the signature must cover.
 * @param {string} publicKeyPem - Ed25519 public key in PEM.
 * @returns {{valid: boolean, reason: string|null}} Result.
 */
export function verifySignature(signature, expectedDigest, publicKeyPem) {
  if (signature.digest !== expectedDigest) {
    return { valid: false, reason: 'signature digest does not match bundle digest' };
  }
  let key;
  try {
    key = createPublicKey(publicKeyPem);
  } catch (error) {
    return { valid: false, reason: `invalid public key: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    const ok = verify(null, Buffer.from(signature.digest, 'utf8'), key, Buffer.from(signature.signature, 'base64'));
    return ok ? { valid: true, reason: null } : { valid: false, reason: 'signature verification failed' };
  } catch (error) {
    return { valid: false, reason: `signature verification failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
