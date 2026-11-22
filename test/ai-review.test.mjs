import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import { evaluateAiReview, reviewSignaturePayload } from '../src/lib/ai-review.js';

const H = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

function review(overrides = {}) {
  return {
    schema: 'firetree.ai-review/v1',
    change: { head: 'a'.repeat(40), diff_sha256: H, assessment_sha256: H2 },
    mode: 'single-provider',
    author: { provider: 'deepseek-account', model: 'deepseek-flash' },
    seats: [
      {
        id: 'seat-1', provider: 'deepseek-account', model: 'deepseek-flash',
        context_sha256: '1'.repeat(64), prompt_sha256: '2'.repeat(64), transcript_sha256: '3'.repeat(64),
        verdict: 'ready', findings: [],
      },
      {
        id: 'seat-2', provider: 'deepseek-account', model: 'deepseek-flash',
        context_sha256: '4'.repeat(64), prompt_sha256: '5'.repeat(64), transcript_sha256: '6'.repeat(64),
        verdict: 'ready', findings: [],
      },
    ],
    unresolved: 0,
    converged: true,
    created_at: '2026-11-22T00:00:00Z',
    ...overrides,
  };
}

test('single-provider AI review is structurally valid with two contexts', () => {
  const result = evaluateAiReview(review(), { head: 'a'.repeat(40), diffSha256: H, assessmentSha256: H2 });
  assert.equal(result.valid, true, result.gaps.join('; '));
  assert.equal(result.mode, 'single-provider');
  assert.equal(result.seats, 2);
});

test('AI review rejects open findings, duplicate contexts, and wrong bindings', () => {
  assert.equal(evaluateAiReview(review({ unresolved: 1 }), {}).valid, false);
  const duplicate = review();
  duplicate.seats[1].context_sha256 = duplicate.seats[0].context_sha256;
  assert.equal(evaluateAiReview(duplicate, {}).valid, false);
  assert.equal(evaluateAiReview(review(), { diffSha256: 'f'.repeat(64) }).valid, false);
  assert.equal(evaluateAiReview(review({ mode: 'multi-provider' }), {}).valid, false);
});

test('A3-AI review requires a valid server-held HMAC signature', () => {
  const key = 'server-signing-key';
  const signed = review();
  signed.signature = createHmac('sha256', key).update(reviewSignaturePayload(signed)).digest('hex');
  assert.equal(evaluateAiReview(signed, { diffSha256: H }, { requireSignature: true, signingKey: key }).valid, true);
  assert.equal(evaluateAiReview(signed, { diffSha256: H }, { requireSignature: true, signingKey: 'wrong' }).valid, false);
  signed.change.head = 'c'.repeat(40);
  assert.equal(evaluateAiReview(signed, { diffSha256: H }, { requireSignature: true, signingKey: key }).valid, false);
  assert.equal(evaluateAiReview(review(), { diffSha256: H }, { requireSignature: true, signingKey: key }).valid, false);
});

