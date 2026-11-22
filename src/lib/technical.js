/** Autonomous technical evidence checks. This artifact is not a delivery receipt. */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { evaluateAiReview } from './ai-review.js';
import { readEvents } from './events.js';
import { readFiretreeJson, resolveWithin, sha256File, sha256Text } from './artifacts.js';
import { canonicalJson } from './json.js';
import { validateCoverageText } from './coverage.js';
import { validateSarif, validateSbom } from './extra-evidence.js';
import { validateJunitXml } from './junit.js';
import { validateJsonSchema } from './schema.js';

const TECHNICAL_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/technical-evidence.schema.json', import.meta.url), 'utf8'));
const HYPOTHESES_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/hypotheses.schema.json', import.meta.url), 'utf8'));

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

async function evidenceFormatGaps(file, item) {
  if (item.kind === 'test') {
    const text = await readFile(file, 'utf8');
    return validateJunitXml(text).gaps.map((gap) => `${item.run_ref}: ${gap}`);
  }
  if (item.kind === 'coverage') {
    const text = await readFile(file, 'utf8');
    return validateCoverageText(text).gaps.map((gap) => `${item.run_ref}: ${gap}`);
  }
  if (item.kind !== 'sarif' && item.kind !== 'sbom') return [];
  let value;
  try {
    value = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return [`evidence is not valid JSON: ${item.run_ref}`];
  }
  const gaps = item.kind === 'sarif' ? validateSarif(value) : validateSbom(value);
  return gaps.map((gap) => `${item.run_ref}: ${gap}`);
}

async function evidenceGap(root, item) {
  if (/^https?:\/\//i.test(item.run_ref)) {
    return `remote evidence is not accepted: ${item.run_ref}; use a bundle/local artifact`;
  }
  let file;
  try {
    file = resolveWithin(root, item.run_ref);
  } catch {
    return `evidence run_ref is not a safe local path: ${item.run_ref}`;
  }
  let actual;
  try {
    actual = await sha256File(file);
  } catch {
    return `evidence file is missing: ${item.run_ref}`;
  }
  return actual === item.sha256 ? null : `evidence hash mismatch: ${item.run_ref}`;
}

/**
 * @param {object} evidence - Technical evidence value.
 * @param {{root: string, change: string, now?: Date}} options - Context.
 * @returns {Promise<{valid: boolean, gaps: string[]}>} Check result.
 */
export async function checkTechnicalEvidenceSemantics(evidence, options) {
  const gaps = validateJsonSchema(evidence, TECHNICAL_SCHEMA).map((error) => `schema ${error.path}: ${error.message}`);
  if (gaps.length > 0) return { valid: false, gaps };

  if (Number.isNaN(Date.parse(evidence.expires_at)) || Date.parse(evidence.expires_at) <= (options.now ?? new Date()).getTime()) {
    gaps.push('technical evidence has expired');
  }
  if (evidence.human_signoff !== false || evidence.completion_claim !== false || evidence.milestone_claim !== false) {
    gaps.push('autonomous technical evidence must not claim human signoff, completion, or a milestone');
  }

  for (const item of evidence.evidence) {
    if (/^agent(?:$|[:/])/i.test(item.producer)) gaps.push('evidence producer must not be the agent');
    const gap = await evidenceGap(options.root, item);
    if (gap !== null) gaps.push(gap);
    if (gap === null && !/^https?:\/\//i.test(item.run_ref)) {
      const formatGaps = await evidenceFormatGaps(resolveWithin(options.root, item.run_ref), item);
      gaps.push(...formatGaps);
    }
  }

  if (evidence.events !== undefined) {
    const eventLog = await readEvents(options.root);
    if (!eventLog.valid) gaps.push(...eventLog.gaps.map((gap) => `event chain ${gap}`));
    if (eventLog.events.length !== evidence.events.count) gaps.push('technical evidence event count does not match chain');
    const head = eventLog.events.length === 0 ? null : eventLog.events.at(-1).hash;
    if (head !== evidence.events.head) gaps.push('technical evidence event head does not match chain');
  }

  if (evidence.ai_review !== undefined) {
    let reviewFile;
    try {
      reviewFile = resolveWithin(options.root, evidence.ai_review.path);
    } catch {
      gaps.push('technical evidence ai_review path is unsafe');
    }
    if (reviewFile !== undefined) {
      let review;
      try {
        const text = await readFile(reviewFile, 'utf8');
        if (sha256Text(text) !== evidence.ai_review.sha256) {
          gaps.push('technical evidence ai_review hash does not match artifact');
        }
        review = JSON.parse(text);
      } catch {
        gaps.push('technical evidence ai_review file is missing or invalid');
      }
      if (review !== undefined) {
        try {
          const expectedDiff = evidence.change.diff_sha256;
          const result = evaluateAiReview(review, expectedDiff === undefined ? {} : { diffSha256: expectedDiff });
          if (!result.valid) gaps.push(...result.gaps.map((gap) => `ai_review ${gap}`));
          if (review.mode !== evidence.ai_review.mode) gaps.push('technical evidence ai_review mode does not match artifact');
          if (review.unresolved !== evidence.ai_review.unresolved) gaps.push('technical evidence ai_review unresolved does not match artifact');
          const actualProviders = [...new Set(review.seats.map((seat) => seat.provider))].sort();
          const declaredProviders = [...evidence.ai_review.providers].sort();
          if (JSON.stringify(actualProviders) !== JSON.stringify(declaredProviders)) {
            gaps.push('technical evidence ai_review providers do not match artifact');
          }
          if (evidence.assurance === 'A3-AI' && (review.mode !== 'multi-provider' || actualProviders.length < 2)) {
            gaps.push('A3-AI technical evidence requires a multi-provider review');
          }
          if (evidence.assurance === 'A3-AI-S' && (review.mode !== 'single-provider' || actualProviders.length !== 1)) {
            gaps.push('A3-AI-S technical evidence requires a single-provider review');
          }
        } catch {
          gaps.push('ai_review artifact is malformed');
        }
      }
    }
    if (evidence.ai_review.unresolved !== 0) gaps.push('technical evidence ai_review has unresolved findings');
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
    if (evidence.assessment.path !== `.firetree/changes/${options.change}/assessment.json`) gaps.push('technical evidence assessment path does not match change');
    if (evidence.assessment.sha256 !== assessmentRecord.sha256) gaps.push('technical evidence assessment hash does not match artifact');
    if (assessment.tier !== evidence.tier) gaps.push('technical evidence tier does not match assessment');
    if (evidence.assessment.tier !== assessment.tier) gaps.push('technical evidence assessment tier does not match assessment');
    if (evidence.assessment.auto_tier !== assessment.auto_tier) gaps.push('technical evidence auto tier does not match assessment');
    if (evidence.assessment.confidence !== assessment.confidence) gaps.push('technical evidence confidence does not match assessment');
    if (assessment.change.base !== evidence.change.base) gaps.push('technical evidence base does not match assessment');
    if (assessment.change.head !== evidence.change.head) gaps.push('technical evidence head does not match assessment');
    if (sha256Text(canonicalJson(assessment.change.files)) !== evidence.change.files_sha256) gaps.push('technical evidence files hash does not match assessment');
    if (assessment.git !== undefined) {
      if (evidence.change.diff_sha256 !== assessment.git.diff_sha256) gaps.push('technical evidence diff hash does not match assessment');
      if (evidence.change.tree_sha !== assessment.git.tree_sha) gaps.push('technical evidence tree hash does not match assessment');
    }
    for (const key of ['files', 'subsystems', 'interfaces', 'owners']) {
      if (!sameArray(assessment.impact[key], evidence.impact[key])) gaps.push(`technical evidence impact ${key} does not match assessment`);
    }
    if (assessment.impact.traversed !== evidence.impact.traversed) gaps.push('technical evidence traversal does not match assessment');
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
    if (evidence.hypotheses.total !== 0) gaps.push('technical evidence claims hypotheses but no ledger exists');
  } else if (ledgerRecord !== undefined) {
    const ledgerErrors = validateJsonSchema(ledgerRecord.value, HYPOTHESES_SCHEMA);
    if (ledgerErrors.length > 0) gaps.push('hypotheses ledger is invalid');
    const total = ledgerRecord.value.hypotheses.length;
    const verified = ledgerRecord.value.hypotheses.filter((hypothesis) => hypothesis.status === 'verified').length;
    if (evidence.hypotheses.total !== total) gaps.push('technical evidence hypothesis total does not match ledger');
    if (evidence.hypotheses.verified !== verified) gaps.push('technical evidence verified hypothesis count does not match ledger');
  }

  return { valid: gaps.length === 0, gaps };
}

export { TECHNICAL_SCHEMA };
