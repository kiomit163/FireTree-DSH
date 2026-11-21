/** Receipt v0 semantic checks: evidence, sign-off, tier rules, expiry, and artifact consistency. */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { firetreePath, listJsonFiles, readFiretreeJson, resolveWithin, sha256File, sha256Text } from './artifacts.js';
import { validateCorrectnessCase } from './correctness.js';
import { validateCoverageText } from './coverage.js';
import { validateSarif, validateSbom } from './extra-evidence.js';
import { validateJunitXml } from './junit.js';
import { canonicalJson } from './json.js';
import { validateJsonSchema } from './schema.js';

const RECEIPT_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/receipt.schema.json', import.meta.url), 'utf8'));
const HYPOTHESES_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/hypotheses.schema.json', import.meta.url), 'utf8'));
const REVIEW_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/review.schema.json', import.meta.url), 'utf8'));
const SYNTHESIS_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/synthesis.schema.json', import.meta.url), 'utf8'));

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
  if (/^https?:\/\//i.test(evidence.run_ref)) {
    return `remote evidence is not accepted: ${evidence.run_ref}; use a bundle/local artifact`;
  }
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
  if (actual !== evidence.sha256) return `evidence hash mismatch: ${evidence.run_ref}`;
  try {
    if (evidence.kind === 'test') {
      const text = await readFile(file, 'utf8');
      const result = validateJunitXml(text);
      if (!result.valid) return `${evidence.run_ref}: ${result.gaps.join('; ')}`;
    } else if (evidence.kind === 'coverage') {
      const text = await readFile(file, 'utf8');
      const result = validateCoverageText(text);
      if (!result.valid) return `${evidence.run_ref}: ${result.gaps.join('; ')}`;
    } else if (evidence.kind === 'sarif' || evidence.kind === 'sbom') {
      const text = await readFile(file, 'utf8');
      const value = JSON.parse(text);
      const gaps = evidence.kind === 'sarif' ? validateSarif(value) : validateSbom(value);
      if (gaps.length > 0) return `${evidence.run_ref}: ${gaps.join('; ')}`;
    }
  } catch (error) {
    return `${evidence.run_ref}: evidence format is invalid (${error instanceof Error ? error.message : String(error)})`;
  }
  return null;
}

/**
 * Read and validate the review verdict artifact.
 *
 * @param {string} root - Repository root.
 * @param {string} change - Change id.
 * @returns {Promise<{value: object, sha256: string, path: string}|null>} Verdict record.
 */
export async function readReviewVerdict(root, change) {
  const relativePath = `.firetree/changes/${change}/verdict.json`;
  const record = await readFiretreeJson(root, relativePath, { verifyHash: true, missing: 'null' });
  if (record === null) return null;
  const errors = validateJsonSchema(record.value, REVIEW_SCHEMA.$defs.verdict, { rootSchema: REVIEW_SCHEMA });
  if (errors.length > 0) return { value: null, sha256: record.sha256 ?? '', path: relativePath, errors };
  return { value: record.value, sha256: record.sha256 ?? '', path: relativePath };
}

/**
 * @param {object} review - Review verdict value.
 * @returns {object} Receipt review object.
 */
export function reviewToReceipt(review) {
  return {
    mode: review.mode,
    assessment_sha256: review.assessment_sha256,
    package_sha256: review.package_sha256,
    rounds: review.rounds,
    new_findings: [...review.new_findings],
    dissent: review.dissent,
    verdict: review.decision,
    ...(review.zero_dissent_checks === undefined ? {} : { zero_dissent_checks: [...review.zero_dissent_checks] }),
    ...(review.human_spot_check === undefined ? {} : { human_spot_check: { ...review.human_spot_check } }),
  };
}

/**
 * Read and validate the synthesis plan and its rounds.
 *
 * @param {string} root - Repository root.
 * @param {string} change - Change id.
 * @returns {Promise<{plan: object, planSha256: string, planPath: string, rounds: object[], lastRound: object, lastRoundSha256: string, lastRoundPath: string, converged: boolean}|null>} Synthesis state.
 */
export async function readSynthesisArtifacts(root, change) {
  const planPath = `.firetree/changes/${change}/synthesis/plan.json`;
  const planRecord = await readFiretreeJson(root, planPath, { verifyHash: true, missing: 'null' });
  if (planRecord === null) return null;
  const planErrors = validateJsonSchema(planRecord.value, SYNTHESIS_SCHEMA.$defs.plan, { rootSchema: SYNTHESIS_SCHEMA });
  if (planErrors.length > 0) return { plan: null, errors: planErrors, planPath };

  const files = await listJsonFiles(firetreePath(root, 'changes', change, 'synthesis'));
  const rounds = [];
  for (const file of files) {
    const match = /\/round-(\d+)\.json$/.exec(file.replaceAll('\\', '/'));
    if (!match) continue;
    const path = `.firetree/changes/${change}/synthesis/round-${match[1]}.json`;
    const record = await readFiretreeJson(root, path, { verifyHash: true, missing: 'null' });
    if (record === null) continue;
    const errors = validateJsonSchema(record.value, SYNTHESIS_SCHEMA.$defs.round, { rootSchema: SYNTHESIS_SCHEMA });
    if (errors.length > 0) return { plan: planRecord.value, errors, planPath };
    rounds.push({ value: record.value, sha256: record.sha256 ?? '', path });
  }
  rounds.sort((left, right) => left.value.round - right.value.round);
  const last = rounds.at(-1);
  if (last === undefined) return { plan: planRecord.value, planSha256: planRecord.sha256 ?? '', planPath, rounds: [], lastRound: null, lastRoundSha256: '', lastRoundPath: '', converged: false };
  return {
    plan: planRecord.value,
    planSha256: planRecord.sha256 ?? '',
    planPath,
    rounds: rounds.map((round) => round.value),
    lastRound: last.value,
    lastRoundSha256: last.sha256,
    lastRoundPath: last.path,
    converged: last.value.metrics.converged === true && last.value.metrics.timed_out !== true,
  };
}

/**
 * @param {object} synthesis - Result of readSynthesisArtifacts.
 * @returns {object|null} Receipt synthesis summary.
 */
export function synthesisSummary(synthesis) {
  if (synthesis === null || synthesis === undefined || synthesis.plan === null || synthesis.plan === undefined || synthesis.lastRound === null || synthesis.lastRound === undefined) return null;
  return {
    plan: { path: synthesis.planPath, sha256: synthesis.planSha256 },
    rounds: synthesis.rounds.length,
    last_round: { path: synthesis.lastRoundPath, sha256: synthesis.lastRoundSha256 },
    converged: synthesis.converged,
  };
}

function requiredReviewSteps(tier) {
  return tier === 'L2'
    ? ['criteria', 'data', 'seats', 'pre_read', 'discussion', 'written_conclusion', 'notify']
    : ['criteria', 'review', 'conclusion'];
}

async function readReviewRounds(root, change) {
  const files = await listJsonFiles(firetreePath(root, 'changes', change));
  const rounds = [];
  for (const file of files) {
    const match = /\/round-(\d+)\.json$/.exec(file.replaceAll('\\', '/'));
    if (!match) continue;
    const path = `.firetree/changes/${change}/round-${match[1]}.json`;
    const record = await readFiretreeJson(root, path, { verifyHash: true, missing: 'null' });
    if (record === null) continue;
    const errors = validateJsonSchema(record.value, REVIEW_SCHEMA.$defs.round, { rootSchema: REVIEW_SCHEMA });
    if (errors.length > 0) throw new Error('review round is invalid');
    rounds.push(record.value);
  }
  return rounds.sort((left, right) => left.round - right.round);
}

async function reviewGaps(root, change, receipt) {
  const gaps = [];
  let review;
  try {
    review = await readReviewVerdict(root, change);
  } catch {
    return ['review verdict artifact is unreadable or has a bad hash'];
  }
  if (review === null) return ['review verdict artifact is missing'];
  if (review.value === null) return ['review verdict artifact is invalid'];
  if (review.value.tier !== receipt.tier) gaps.push('review tier does not match receipt tier');
  if (review.value.mode !== receipt.review.mode) gaps.push('review mode does not match receipt');
  if (review.value.assessment_sha256 !== receipt.review.assessment_sha256) gaps.push('review assessment hash does not match receipt');
  if (review.value.package_sha256 !== receipt.review.package_sha256) gaps.push('review package hash does not match receipt');
  if (review.value.decision !== receipt.review.verdict) gaps.push('receipt review verdict does not match review artifact');
  if (review.value.rounds !== receipt.review.rounds) gaps.push('receipt review rounds do not match review artifact');
  if (!sameArray(review.value.new_findings, receipt.review.new_findings)) gaps.push('receipt new findings do not match review artifact');
  if (review.value.dissent !== receipt.review.dissent) gaps.push('receipt dissent does not match review artifact');
  if (JSON.stringify(review.value.human_spot_check ?? null) !== JSON.stringify(receipt.review.human_spot_check ?? null)) {
    gaps.push('receipt human spot-check does not match review artifact');
  }
  const steps = new Set(review.value.steps.map((step) => step.id));
  for (const step of requiredReviewSteps(receipt.tier)) {
    if (!steps.has(step)) gaps.push(`review artifact is missing ${step} step`);
  }

  let rounds;
  try {
    rounds = await readReviewRounds(root, change);
  } catch {
    return [...gaps, 'review rounds are unreadable or have a bad hash'];
  }
  if (rounds.length !== review.value.rounds) gaps.push('review round count does not match verdict');
  if (!sameArray(rounds.map((round) => round.findings.length), review.value.new_findings)) {
    gaps.push('review round findings do not match verdict');
  }
  if (review.value.decision === 'ready' && (rounds.at(-1)?.findings.length ?? 0) !== 0) {
    gaps.push('review final round is not empty');
  }
  const blockers = rounds.flatMap((round) => round.findings)
    .filter((finding) => finding.route === 'blocker' && !['resolved', 'rejected'].includes(finding.verdict));
  if (review.value.decision === 'ready' && blockers.length > 0) gaps.push('review artifact has unresolved blockers');

  if (receipt.signoff !== null && review.value.signoff !== undefined) {
    for (const key of ['by', 'identity', 'at', 'scope']) {
      if (receipt.signoff[key] !== review.value.signoff[key]) gaps.push(`receipt signoff ${key} does not match review artifact`);
    }
  }

  let packageRecord;
  try {
    packageRecord = await readFiretreeJson(root, `.firetree/changes/${change}/package.json`, { verifyHash: true, missing: 'null' });
  } catch {
    return [...gaps, 'review package is unreadable or has a bad hash'];
  }
  if (packageRecord === null) {
    gaps.push('review package is missing');
  } else if (packageRecord.sha256 !== review.value.package_sha256) {
    gaps.push('review package hash does not match verdict');
  }
  return gaps;
}

async function synthesisGaps(root, change, receipt) {
  const gaps = [];
  let synthesis;
  try {
    synthesis = await readSynthesisArtifacts(root, change);
  } catch {
    return ['synthesis artifacts are unreadable or have a bad hash'];
  }
  if (synthesis === null) return gaps;
  if (synthesis.plan === null) return ['synthesis plan is invalid'];
  if (receipt.synthesis === undefined) return ['receipt does not reference synthesis artifacts'];
  if (receipt.synthesis.converged !== true || synthesis.converged !== true) gaps.push('synthesis did not converge');
  if (synthesis.lastRound?.metrics?.timed_out === true) gaps.push('synthesis timed out');
  if (receipt.synthesis.plan.path !== synthesis.planPath || receipt.synthesis.plan.sha256 !== synthesis.planSha256) {
    gaps.push('receipt synthesis plan reference does not match artifact');
  }
  if (receipt.synthesis.rounds !== synthesis.rounds.length) gaps.push('receipt synthesis round count does not match artifacts');
  if (synthesis.lastRound === null || receipt.synthesis.last_round.path !== synthesis.lastRoundPath || receipt.synthesis.last_round.sha256 !== synthesis.lastRoundSha256) {
    gaps.push('receipt synthesis last-round reference does not match artifact');
  }
  return gaps;
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

  const reviewRequired = receipt.tier !== 'L0' || receipt.policy.sampling === 'sampled';
  if (reviewRequired && receipt.review === null) {
    gaps.push('review is required for this tier/sampling decision');
  } else if (receipt.review !== null) {
    if (receipt.tier === 'L0' && receipt.review.mode !== 'light' && receipt.policy.sampling === 'sampled') {
      gaps.push('sampled L0 requires a light human spot-check review');
    }
    if (receipt.tier === 'L0' && receipt.review.human_spot_check === undefined) {
      gaps.push('sampled L0 requires a human spot-check record');
    }
    if (receipt.review.verdict !== 'ready') gaps.push('review verdict is not ready');
    if (receipt.review.new_findings.at(-1) !== 0) gaps.push('review did not converge to zero new findings');
  }
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
    if (receipt.review !== null && receipt.review.assessment_sha256 !== assessmentRecord.sha256) {
      gaps.push('receipt review assessment hash does not match assessment artifact');
    }
    if (assessment.tier !== receipt.tier) gaps.push('receipt tier does not match assessment tier');
    if (assessment.change.base !== receipt.change.base) gaps.push('receipt base does not match assessment base');
    if (assessment.change.head !== receipt.change.head) gaps.push('receipt head does not match assessment head');
    const filesHash = sha256Text(canonicalJson(assessment.change.files));
    if (filesHash !== receipt.change.files_sha256) gaps.push('receipt change hash does not match assessment files');
    if (assessment.git !== undefined) {
      if (receipt.change.diff_sha256 !== assessment.git.diff_sha256) {
        gaps.push('receipt diff hash does not match assessment');
      }
      if (receipt.change.tree_sha !== assessment.git.tree_sha) {
        gaps.push('receipt tree hash does not match assessment');
      }
    }
    if (assessment.policy.version !== receipt.policy.version) gaps.push('receipt policy version does not match assessment');
    if (assessment.confidence !== receipt.impact.confidence) gaps.push('receipt impact confidence does not match assessment');
    for (const key of ['files', 'subsystems', 'interfaces', 'owners', 'unknown', 'unresolved_consumers']) {
      if (!sameArray(assessment.impact[key], receipt.impact[key])) gaps.push(`receipt impact ${key} does not match assessment`);
    }
    if (!sameArray(assessment.reasons, receipt.impact.reasons)) gaps.push('receipt impact reasons do not match assessment');
    if (assessment.impact.traversed !== receipt.impact.traversed) gaps.push('receipt impact traversal does not match assessment');
    if (receipt.tier === 'L2' && receipt.impact.unknown.length === 0
      && (receipt.impact.subsystems.length === 0 || receipt.impact.owners.length === 0)) {
      gaps.push('L2 receipt with no unknown paths requires subsystems and owners');
    }
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
    const activeAccepted = (ledgerRecord.value.accepted_risks ?? []).filter((risk) => {
      const hypothesis = ledgerRecord.value.hypotheses.find((candidate) => candidate.id === risk.hypothesis_id);
      return hypothesis?.status === 'untested' && Date.parse(risk.expires_at) > now.getTime();
    }).length;
    if (receipt.hypotheses.total !== total) gaps.push('receipt hypothesis total does not match ledger');
    if (receipt.hypotheses.verified !== verified) gaps.push('receipt verified hypothesis count does not match ledger');
    if (receipt.hypotheses.accepted_risk !== activeAccepted) gaps.push('receipt accepted risk count does not match active ledger acceptances');
  }

  if (reviewRequired && receipt.review !== null) {
    gaps.push(...await reviewGaps(options.root, options.change, receipt));
  }
  if (receipt.tier === 'L2' || receipt.synthesis !== undefined) {
    gaps.push(...await synthesisGaps(options.root, options.change, receipt));
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
      const semantic = validateCorrectnessCase(caseFile, RECEIPT_SCHEMA.$defs.correctnessCase, {
        rootSchema: RECEIPT_SCHEMA,
        now,
        evidenceRefs: receipt.evidence.map((item) => item.run_ref),
      });
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
