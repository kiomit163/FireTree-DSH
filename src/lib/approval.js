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
  if (!['github-review', 'dsh-approval'].includes(approval.source)) {
    throw new ApprovalError('INVALID_APPROVAL', 'approval.source must be github-review or dsh-approval');
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
  if (policy.reviewer !== undefined && approval.reviewer !== policy.reviewer) {
    failures.push(`approval reviewer must be ${policy.reviewer}`);
  }
  if (policy.source !== undefined && approval.source !== policy.source) {
    failures.push(`approval source must be ${policy.source}`);
  }
  return { valid: failures.length === 0, failures, reviewer: approval.reviewer };
}
