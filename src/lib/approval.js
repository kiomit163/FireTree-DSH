/** Human approval records for A3 governed receipts. */

/** Approval validation failure. */
export class ApprovalError extends Error {
  /**
   * @param {string} code - Stable code.
   * @param {string} message - Human-readable message.
   */
  constructor(code, message) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
  }
}

/**
 * Validate the normalized approval record written by CI or DSH.
 *
 * @param {unknown} value - Approval JSON.
 * @returns {object} Normalized approval.
 */
export function parseApproval(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApprovalError('INVALID_APPROVAL', 'approval must be a JSON object');
  }
  const approval = value;
  if (approval.schema !== 'firetree.approval/v1') {
    throw new ApprovalError('INVALID_APPROVAL', 'approval schema must be firetree.approval/v1');
  }
  const change = approval.change;
  if (typeof change !== 'object' || change === null || typeof change.head !== 'string' || !/^[a-f0-9]{7,64}$/.test(change.head)) {
    throw new ApprovalError('INVALID_APPROVAL', 'approval.change.head must be a commit SHA');
  }
  if (typeof approval.reviewer !== 'string' || approval.reviewer.length === 0) {
    throw new ApprovalError('INVALID_APPROVAL', 'approval.reviewer is required');
  }
  if (!['github-review', 'github-environment', 'dsh-approval'].includes(approval.source)) {
    throw new ApprovalError('INVALID_APPROVAL', 'approval.source must be github-review, github-environment, or dsh-approval');
  }
  if (approval.decision !== 'approved') {
    throw new ApprovalError('INVALID_APPROVAL', 'approval.decision must be approved');
  }
  const submittedAt = approval.submitted_at;
  if (typeof submittedAt !== 'string' || Number.isNaN(Date.parse(submittedAt))) {
    throw new ApprovalError('INVALID_APPROVAL', 'approval.submitted_at must be a date-time');
  }
  if (typeof approval.ref !== 'string' || approval.ref.length === 0) {
    throw new ApprovalError('INVALID_APPROVAL', 'approval.ref is required');
  }
  return {
    schema: 'firetree.approval/v1',
    change: { ...(typeof change.id === 'string' ? { id: change.id } : {}), head: change.head.toLowerCase() },
    reviewer: approval.reviewer,
    source: approval.source,
    decision: 'approved',
    submitted_at: submittedAt,
    ref: approval.ref,
  };
}

/**
 * Normalize a GitHub PR review object into a FireTree approval.
 *
 * @param {object} review - GitHub review object.
 * @param {{head: string, change?: string}} options - Expected head and change id.
 * @returns {object} Approval record.
 */
export function approvalFromGithubReview(review, options) {
  if (typeof review !== 'object' || review === null) throw new ApprovalError('INVALID_APPROVAL', 'review must be an object');
  if (review.state !== 'APPROVED') throw new ApprovalError('INVALID_APPROVAL', `review state is ${String(review.state)}, not APPROVED`);
  const login = review.user?.login;
  if (typeof login !== 'string' || login.length === 0) throw new ApprovalError('INVALID_APPROVAL', 'review.user.login is missing');
  if (typeof review.commit_id !== 'string' || review.commit_id.toLowerCase() !== options.head.toLowerCase()) {
    throw new ApprovalError('INVALID_APPROVAL', 'review commit does not match --head');
  }
  if (typeof review.submitted_at !== 'string' || Number.isNaN(Date.parse(review.submitted_at))) {
    throw new ApprovalError('INVALID_APPROVAL', 'review.submitted_at is missing or invalid');
  }
  return {
    schema: 'firetree.approval/v1',
    change: {
      ...(options.change === undefined ? {} : { id: options.change }),
      head: options.head.toLowerCase(),
    },
    reviewer: `github:${login}`,
    source: 'github-review',
    decision: 'approved',
    submitted_at: review.submitted_at,
    ref: String(review.html_url ?? `github-review:${review.id ?? 'unknown'}`),
  };
}

/**
 * Normalize a GitHub environment approval from the run approvals API.
 *
 * @param {unknown} value - `GET /actions/runs/{id}/approvals` response.
 * @param {{environment: string, head: string, change?: string}} options - Expected environment and change.
 * @returns {object} Approval record.
 */
export function approvalFromEnvironment(value, options) {
  if (!Array.isArray(value)) throw new ApprovalError('INVALID_APPROVAL', 'environment approvals must be an array');
  const match = value.find((item) => {
    const approved = item?.state === 'approved';
    const inEnvironment = Array.isArray(item?.environments)
      && item.environments.some((entry) => entry?.name === options.environment);
    return approved && inEnvironment && typeof item?.user?.login === 'string';
  });
  if (match === undefined) {
    throw new ApprovalError('APPROVAL_NOT_FOUND', `no approved environment review found for ${options.environment}`);
  }
  // GitHub's run approvals API does not expose the approval timestamp. Record
  // the time this verifier observed the approved environment, not a fabricated
  // earlier time.
  const createdAt = match.created_at ?? match.createdAt ?? new Date().toISOString();
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
    throw new ApprovalError('INVALID_APPROVAL', 'environment approval has no usable timestamp');
  }
  return {
    schema: 'firetree.approval/v1',
    change: {
      ...(options.change === undefined ? {} : { id: options.change }),
      head: options.head.toLowerCase(),
    },
    reviewer: `github:${match.user.login}`,
    source: 'github-environment',
    decision: 'approved',
    submitted_at: createdAt,
    ref: `environment:${options.environment}`,
  };
}

/**
 * Verify approval against the change head and optional reviewer policy.
 *
 * @param {object} approval - Normalized approval.
 * @param {{head: string, reviewer?: string, source?: string}} policy - Expected values.
 * @returns {{valid: boolean, failures: string[], reviewer: string}} Result.
 */
export function verifyApproval(approval, policy) {
  const failures = [];
  if (typeof policy.head !== 'string' || approval.change.head !== policy.head.toLowerCase()) {
    failures.push('approval head does not match change head');
  }
  if (policy.change !== undefined && approval.change.id !== policy.change) {
    failures.push(`approval change id must be ${policy.change}`);
  }
  if (policy.reviewer !== undefined && approval.reviewer !== policy.reviewer) {
    failures.push(`approval reviewer must be ${policy.reviewer}`);
  }
  if (policy.source !== undefined && approval.source !== policy.source) {
    failures.push(`approval source must be ${policy.source}`);
  }
  return { valid: failures.length === 0, failures, reviewer: approval.reviewer };
}
