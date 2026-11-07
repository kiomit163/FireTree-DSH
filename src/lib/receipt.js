/** Receipt v0 semantic checks: evidence, sign-off, tier rules, expiry, and artifact consistency. */

import { readFileSync } from 'node:fs';

import { readFiretreeJson, resolveWithin, sha256File, sha256Text } from './artifacts.js';
import { validateCorrectnessCase } from './correctness.js';
import { validateJsonSchema } from './schema.js';

const RECEIPT_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/receipt.schema.json', import.meta.url), 'utf8'));
const HYPOTHESES_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/hypotheses.schema.json', import.meta.url), 'utf8'));

function sameArray(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function schemaGaps(value) {
  return validateJsonSchema(value, RECEIPT_SCHEMA).map((error) => `schema ${error.path}: ${error.message}`);
}

async function localEvidenceGap(root, evidence) {
  if (/^https?:\/\//i.test(evidence.run_ref)) return null;
  let file;
  try {
    file = resolveWithin(root, evidence.run_ref);
  } catch {
    return `evidence run_ref is not a safe local path: ${evidence.run_ref}`;
  }
  let actual;
  try {
    actual = await sha256File(file);
  } catch {
    return `evidence file is missing: ${evidence.run_ref}`;
  }
  return actual === evidence.sha256 ? null : `evidence hash mismatch: ${evidence.run_ref}`;
}

/**
 * Check a receipt against its change assessment, hypothesis ledger, evidence
 * files, correctness case, sign-off, and expiry.
 *
 * @param {unknown} receipt - Receipt value.
 * @param {{root: string, change: string, now?: Date}} options - Context.
 * @returns {Promise<{valid: boolean, gaps: string[]}>} Check result.
 */
export async function checkReceiptSemantics(receipt, options) {
  const gaps = schemaGaps(receipt);
  if (gaps.length > 0) return { valid: false, gaps };

  const now = options.now ?? new Date();
  if (Number.isNaN(Date.parse(receipt.expires_at)) || Date.parse(receipt.expires_at) <= now.getTime()) {
    gaps.push('receipt has expired');
  }

  for (const evidence of receipt.evidence) {
    const gap = await localEvidenceGap(options.root, evidence);
    if (gap !== null) gaps.push(gap);
  }

  if (receipt.review.verdict !== 'ready') gaps.push('review verdict is not ready');
  if (receipt.review.new_findings.at(-1) !== 0) gaps.push('review did not converge to zero new findings');
  if (receipt.tier === 'L2' && receipt.signoff?.by !== 'human') gaps.push('L2 receipt requires human sign-off');

  const untested = receipt.hypotheses.total - receipt.hypotheses.verified;
  if (untested > receipt.hypotheses.accepted_risk) {
    gaps.push(`untested hypotheses exceed accepted risk (${untested} > ${receipt.hypotheses.accepted_risk})`);
  }

  let assessmentRecord;
  try {
    assessmentRecord = await readFiretreeJson(
      options.root,
      `.firetree/changes/${options.change}/assessment.json`,
      { verifyHash: true, missing: 'null' },
    );
  } catch {
    gaps.push('assessment artifact is unreadable or has a bad hash');
    assessmentRecord = undefined;
  }
  if (assessmentRecord === null) {
    gaps.push('assessment artifact is missing');
  } else if (assessmentRecord !== undefined) {
    const assessment = assessmentRecord.value;
    if (assessment.tier !== receipt.tier) gaps.push('receipt tier does not match assessment tier');
    if (assessment.change.base !== receipt.change.base) gaps.push('receipt base does not match assessment base');
    if (assessment.change.head !== receipt.change.head) gaps.push('receipt head does not match assessment head');
    const filesHash = sha256Text(assessment.change.files.join('\n'));
    if (filesHash !== receipt.change.files_sha256) gaps.push('receipt change hash does not match assessment files');
    if (assessment.policy.version !== receipt.policy.version) gaps.push('receipt policy version does not match assessment');
    if (assessment.confidence !== receipt.impact.confidence) gaps.push('receipt impact confidence does not match assessment');
    for (const key of ['files', 'subsystems', 'interfaces', 'owners']) {
      if (!sameArray(assessment.impact[key], receipt.impact[key])) gaps.push(`receipt impact ${key} does not match assessment`);
    }
    if (assessment.impact.traversed !== receipt.impact.traversed) gaps.push('receipt impact traversal does not match assessment');
  }

  let ledgerRecord;
  try {
    ledgerRecord = await readFiretreeJson(
      options.root,
      `.firetree/changes/${options.change}/hypotheses.json`,
      { verifyHash: true, missing: 'null' },
    );
  } catch {
    gaps.push('hypotheses ledger is unreadable or has a bad hash');
    ledgerRecord = undefined;
  }
  if (ledgerRecord === null) {
    if (receipt.hypotheses.total !== 0) gaps.push('receipt claims hypotheses but no ledger exists');
  } else if (ledgerRecord !== undefined) {
    const ledgerErrors = validateJsonSchema(ledgerRecord.value, HYPOTHESES_SCHEMA);
    if (ledgerErrors.length > 0) gaps.push('hypotheses ledger is invalid');
    const total = ledgerRecord.value.hypotheses.length;
    const verified = ledgerRecord.value.hypotheses.filter((hypothesis) => hypothesis.status === 'verified').length;
    if (receipt.hypotheses.total !== total) gaps.push('receipt hypothesis total does not match ledger');
    if (receipt.hypotheses.verified !== verified) gaps.push('receipt verified hypothesis count does not match ledger');
  }

  if (receipt.correctness_case !== null) {
    const summary = receipt.correctness_case;
    let caseValue;
    try {
      caseValue = await readFiretreeJson(options.root, summary.path, { verifyHash: false, missing: 'null' });
    } catch {
      gaps.push('correctness case file is not readable');
      caseValue = null;
    }
    if (caseValue === null) {
      gaps.push('correctness case file is missing');
    } else {
      const caseFile = caseValue.value;
      const caseErrors = validateJsonSchema(caseFile, RECEIPT_SCHEMA.$defs.correctnessCase, { rootSchema: RECEIPT_SCHEMA });
      if (caseErrors.length > 0) gaps.push('correctness case does not match schema');
      const semantic = validateCorrectnessCase(caseFile, RECEIPT_SCHEMA.$defs.correctnessCase, { rootSchema: RECEIPT_SCHEMA, now });
      for (const error of semantic.errors) gaps.push(`correctness case ${error.path}: ${error.message}`);
      const actualHash = await sha256File(resolveWithin(options.root, summary.path));
      if (actualHash !== summary.sha256) gaps.push('correctness case hash does not match receipt');
      if ((caseFile.claims?.length ?? 0) !== summary.claims) gaps.push('correctness case claim count does not match receipt');
      const mapped = new Set((caseFile.mapping ?? []).map((mapping) => mapping.claim_id)).size;
      if (mapped !== summary.mapped_claims) gaps.push('correctness case mapped count does not match receipt');
    }
  } else if (receipt.tier === 'L2') {
    gaps.push('L2 receipt requires a correctness case');
  }

  return { valid: gaps.length === 0, gaps };
}

export { RECEIPT_SCHEMA };
