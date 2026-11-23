/** Validate a machine-generated adversarial review artifact. */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { validateJsonSchema } from './schema.js';

const SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/ai-review.schema.json', import.meta.url), 'utf8'));

/**
 * Validate an AI review artifact against a change.
 *
 * This proves structure, provenance hashes, and quorum. It cannot prove that a
 * model actually executed a transcript or that the model is unbiased; that
 * residual risk is explicit in the A3-AI documentation.
 *
 * @param {unknown} value - Parsed review artifact.
 * @param {{head?: string, diffSha256?: string, assessmentSha256?: string}} expected - Binding values.
 * @returns {{valid: boolean, mode: string|null, gaps: string[], seats: number}} Result.
 */
export function reviewSignaturePayload(review) {
  const { signature: _signature, ...payload } = review;
  return JSON.stringify(payload);
}

/** @param {unknown} review @param {string} key */
export function verifyAiReviewSignature(review, key) {
  if (typeof review !== 'object' || review === null || typeof review.signature !== 'string') return false;
  if (typeof key !== 'string' || key.length === 0) return false;
  const expected = createHmac('sha256', key).update(reviewSignaturePayload(review)).digest();
  try {
    const actual = Buffer.from(review.signature, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function evaluateAiReview(value, expected = {}, options = {}) {
  const gaps = validateJsonSchema(value, SCHEMA)
    .map((gap) => (typeof gap === 'string' ? gap : `schema ${gap.path ?? ''}: ${gap.message ?? JSON.stringify(gap)}`));
  if (gaps.length > 0) return { valid: false, mode: null, gaps, seats: 0 };
  const review = value;
  if (options.requireSignature === true) {
    if (typeof review.signature !== 'string') gaps.push('AI review signature is required');
    else if (typeof options.signingKey !== 'string' || options.signingKey.length === 0) gaps.push('AI review signing key is not configured');
    else if (!verifyAiReviewSignature(review, options.signingKey)) gaps.push('AI review signature is invalid');
  } else if (review.signature !== undefined && options.signingKey !== undefined && !verifyAiReviewSignature(review, options.signingKey)) {
    gaps.push('AI review signature is invalid');
  }
  if (expected.head !== undefined && review.change.head !== expected.head.toLowerCase()) {
    gaps.push('AI review head does not match change head');
  }
  if (expected.diffSha256 !== undefined && review.change.diff_sha256 !== expected.diffSha256) {
    gaps.push('AI review diff hash does not match assessment');
  }
  const ids = new Set();
  const contexts = new Set();
  const transcripts = new Set();
  const providers = new Set();
  let openFindings = 0;
  for (const seat of review.seats) {
    if (ids.has(seat.id)) gaps.push(`duplicate AI seat id: ${seat.id}`);
    if (contexts.has(seat.context_sha256)) gaps.push(`duplicate AI context hash: ${seat.context_sha256}`);
    if (transcripts.has(seat.transcript_sha256)) gaps.push(`duplicate AI transcript hash: ${seat.transcript_sha256}`);
    if (seat.diff_sha256 !== undefined && expected.diffSha256 !== undefined && seat.diff_sha256 !== expected.diffSha256) {
      gaps.push(`AI seat ${seat.id} diff hash does not match the reviewed change`);
    }
    ids.add(seat.id);
    contexts.add(seat.context_sha256);
    transcripts.add(seat.transcript_sha256);
    providers.add(seat.provider);
    if (seat.verdict !== 'ready') gaps.push(`AI seat ${seat.id} verdict is ${seat.verdict}`);
    for (const finding of seat.findings) {
      if (finding.status === 'open') openFindings += 1;
      if (finding.severity === 'blocker' && finding.status === 'accepted') {
        gaps.push(`blocker AI finding ${finding.id} cannot be accepted without a human acceptance record`);
      }
      if (finding.status === 'resolved' && (typeof finding.evidence !== 'string' || finding.evidence.length === 0)) {
        gaps.push(`resolved AI finding ${finding.id} has no evidence`);
      }
    }
  }
  if (openFindings !== review.unresolved) gaps.push('AI unresolved count does not match open findings');
  if (review.unresolved !== 0) gaps.push('AI review has unresolved findings');
  if (review.converged !== true) gaps.push('AI review did not converge');
  if (review.mode === 'multi-provider') {
    if (review.seats.length < 3) gaps.push('multi-provider AI review requires at least three model seats');
    const models = new Set(review.seats.map((seat) => seat.model));
    if (models.size < 3) gaps.push('multi-provider AI review requires at least three distinct models');
  } else {
    if (providers.size !== 1) gaps.push('single-provider AI review must use one provider');
    if (!providers.has(review.author.provider)) gaps.push('single-provider AI review must use the author provider');
  }
  return { valid: gaps.length === 0, mode: review.mode, gaps, seats: review.seats.length };
}
