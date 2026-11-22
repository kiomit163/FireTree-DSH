import assert from 'node:assert/strict';
import { test } from 'node:test';

import { approvalFromEnvironment, approvalFromGithubReview, parseApproval, verifyApproval } from '../src/lib/approval.js';

const HEAD = 'a'.repeat(40);

test('GitHub review normalizes into a human approval and verifies against head', () => {
  const approval = parseApproval(approvalFromGithubReview({
    id: 7,
    user: { login: 'alice' },
    state: 'APPROVED',
    commit_id: HEAD,
    submitted_at: '2026-11-18T00:00:00Z',
    html_url: 'https://github.com/owner/repo/pull/1#pullrequestreview-7',
  }, { head: HEAD, change: 'chg-1' }));
  assert.equal(approval.schema, 'firetree.approval/v1');
  assert.equal(approval.reviewer, 'github:alice');
  assert.equal(approval.change.head, HEAD);
  assert.deepEqual(verifyApproval(approval, { head: HEAD }).failures, []);
  assert.ok(verifyApproval(approval, { head: 'b'.repeat(40) }).failures.length > 0);
});

test('GitHub environment review normalizes to an approval bound to head', () => {
  const approval = parseApproval(approvalFromEnvironment([{
    state: 'approved',
    created_at: '2026-11-18T00:00:00Z',
    user: { login: 'alice' },
    environments: [{ name: 'firetree-a3' }],
  }], { environment: 'firetree-a3', head: HEAD, change: 'chg-1' }));
  assert.equal(approval.source, 'github-environment');
  assert.equal(approval.reviewer, 'github:alice');
  assert.deepEqual(verifyApproval(approval, { head: HEAD, change: 'chg-1' }).failures, []);
  assert.ok(verifyApproval(approval, { head: HEAD, change: 'other' }).failures.length > 0);
  assert.throws(
    () => approvalFromEnvironment([], { environment: 'firetree-a3', head: HEAD }),
    (error) => error.code === 'APPROVAL_NOT_FOUND',
  );
  assert.throws(
    () => approvalFromEnvironment([{
      user: { login: 'alice' }, environments: [{ name: 'firetree-a3' }],
    }], { environment: 'firetree-a3', head: HEAD }),
    (error) => error.code === 'APPROVAL_NOT_FOUND',
  );
});

test('approval can bind diff and assessment hashes', () => {
  const diff = 'd'.repeat(64);
  const assessment = 'e'.repeat(64);
  const approval = parseApproval(approvalFromEnvironment([{
    state: 'approved',
    user: { login: 'alice' },
    environments: [{ name: 'firetree-a3' }],
  }], { environment: 'firetree-a3', head: HEAD, change: 'chg-1', diffSha256: diff, assessmentSha256: assessment }));
  assert.deepEqual(verifyApproval(approval, {
    head: HEAD, change: 'chg-1', diffSha256: diff, assessmentSha256: assessment,
  }).failures, []);
  assert.ok(verifyApproval(approval, { head: HEAD, diffSha256: 'f'.repeat(64) }).failures.length > 0);
  assert.ok(verifyApproval(approval, { head: HEAD, assessmentSha256: 'f'.repeat(64) }).failures.length > 0);
  assert.throws(
    () => parseApproval(approvalFromEnvironment([{
      state: 'approved', user: { login: 'alice' }, environments: [{ name: 'firetree-a3' }],
    }], { environment: 'firetree-a3', head: HEAD, diffSha256: 'bad' })),
    (error) => error.code === 'INVALID_APPROVAL',
  );
});

test('environment approval without a top-level timestamp uses observation time', () => {
  const approval = parseApproval(approvalFromEnvironment([{
    state: 'approved',
    user: { login: 'alice' },
    environments: [{ name: 'firetree-a3' }],
  }], { environment: 'firetree-a3', head: HEAD }));
  assert.ok(Number.isFinite(Date.parse(approval.submitted_at)));
});

test('approval parsing rejects non-approved reviews and mismatched commits', () => {
  assert.throws(() => parseApproval({ schema: 'firetree.approval/v1' }));
  assert.throws(() => approvalFromGithubReview({
    state: 'COMMENTED', user: { login: 'alice' }, commit_id: HEAD, submitted_at: '2026-11-18T00:00:00Z',
  }, { head: HEAD }));
  assert.throws(() => approvalFromGithubReview({
    state: 'APPROVED', user: { login: 'alice' }, commit_id: 'b'.repeat(40), submitted_at: '2026-11-18T00:00:00Z',
  }, { head: HEAD }));
});
