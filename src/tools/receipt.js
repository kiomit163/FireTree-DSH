/** firetree_receipt: assemble and check the versioned delivery receipt. */

import { readFileSync } from 'node:fs';

import { ArtifactError, assertSafeId, readFiretreeJson, readJsonFile, resolveWithin, sha256File, sha256Text, writeFiretreeJson } from '../lib/artifacts.js';
import { validateCorrectnessCase } from '../lib/correctness.js';
import {
  checkReceiptSemantics,
  readReviewVerdict,
  readSynthesisArtifacts,
  RECEIPT_SCHEMA,
  reviewToReceipt,
  synthesisSummary,
} from '../lib/receipt.js';
import { assertJsonSchemaValue } from '../lib/schema.js';
import { toToolSchema } from '../lib/tool-schema.js';

const KINDS = new Set(['test', 'coverage', 'sarif', 'sbom', 'bench']);
const ALLOWED_ARGS = new Set([
  'action',
  'change',
  'intent',
  'classification',
  'evidence',
  'review',
  'signoff',
  'correctness_case',
  'expires_at',
  'assurance',
]);

/** Receipt input/build failure. */
export class ReceiptError extends Error {
  /**
   * @param {string} code - Stable machine-readable code.
   * @param {string} message - Human-readable message.
   */
  constructor(code, message) {
    super(message);
    this.name = 'ReceiptError';
    this.code = code;
  }
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'schema', 'gaps'],
  properties: {
    ok: { type: 'boolean' },
    schema: { type: 'string', const: 'firetree.receipt-tool/v0' },
    gaps: { type: 'array', items: { type: 'string' } },
    receipt: { type: 'object' },
    artifact: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'sha256'],
      properties: {
        path: { type: 'string' },
        sha256: { type: 'string' },
      },
    },
  },
};

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'change'],
  properties: {
    action: { type: 'string', enum: ['build', 'check'] },
    change: { type: 'string' },
    intent: {
      type: 'object',
      additionalProperties: false,
      properties: {
        spec: { type: 'string' },
        sha256: { type: 'string' },
      },
    },
    classification: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subsystem: { type: 'string' },
        kind: { type: 'string', enum: ['simple', 'large', 'simple-giant', 'open-complex-giant', 'unknown'] },
        method: { type: 'string', enum: ['decompose', 'metasynthesis'] },
        dossier_sha256: { type: 'string' },
      },
    },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: [...KINDS] },
          producer: { type: 'string' },
          run_ref: { type: 'string' },
          sha256: { type: 'string' },
          produced_at: { type: 'string' },
        },
      },
    },
    review: {
      type: 'object',
      additionalProperties: false,
      properties: {
        rounds: { type: 'integer' },
        new_findings: { type: 'array', items: { type: 'integer' } },
        dissent: { type: 'integer' },
        verdict: { type: 'string', enum: ['ready', 'not-ready'] },
        zero_dissent_checks: { type: 'array', items: { type: 'string' } },
      },
    },
    signoff: {
      type: 'object',
      additionalProperties: false,
      properties: {
        by: { type: 'string', enum: ['human', 'ci'] },
        identity: { type: 'string' },
        at: { type: 'string' },
        scope: { type: 'string' },
      },
    },
    correctness_case: { type: 'string' },
    expires_at: { type: 'string' },
    assurance: { type: 'string', enum: ['A1', 'A2'] },
  },
};

function text(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ReceiptError('INVALID_ARGS', `${label} must be a non-empty string`);
  return value;
}

function hash(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new ReceiptError('INVALID_ARGS', `${label} must be a lowercase SHA-256`);
  return value;
}

function validateIntent(value) {
  if (typeof value !== 'object' || value === null) throw new ReceiptError('INVALID_ARGS', 'intent must be an object');
  return { spec: text(value.spec, 'intent.spec'), sha256: hash(value.sha256, 'intent.sha256') };
}

function validateClassification(value) {
  if (typeof value !== 'object' || value === null) throw new ReceiptError('INVALID_ARGS', 'classification must be an object');
  const kind = value.kind;
  const method = value.method;
  if (!['simple', 'large', 'simple-giant', 'open-complex-giant', 'unknown'].includes(kind)) throw new ReceiptError('INVALID_ARGS', 'classification.kind is invalid');
  if (!['decompose', 'metasynthesis'].includes(method)) throw new ReceiptError('INVALID_ARGS', 'classification.method is invalid');
  return {
    subsystem: text(value.subsystem, 'classification.subsystem'),
    kind,
    method,
    dossier_sha256: hash(value.dossier_sha256, 'classification.dossier_sha256'),
  };
}

function validateReview(value) {
  if (typeof value !== 'object' || value === null) throw new ReceiptError('INVALID_ARGS', 'review must be an object');
  if (!Number.isInteger(value.rounds) || value.rounds < 1 || value.rounds > 3) throw new ReceiptError('INVALID_ARGS', 'review.rounds must be 1..3');
  if (!Array.isArray(value.new_findings) || value.new_findings.length === 0 || value.new_findings.some((item) => !Number.isInteger(item) || item < 0)) {
    throw new ReceiptError('INVALID_ARGS', 'review.new_findings must be non-empty non-negative integers');
  }
  if (!Number.isInteger(value.dissent) || value.dissent < 0) throw new ReceiptError('INVALID_ARGS', 'review.dissent must be a non-negative integer');
  if (!['ready', 'not-ready'].includes(value.verdict)) throw new ReceiptError('INVALID_ARGS', 'review.verdict must be ready or not-ready');
  const review = { rounds: value.rounds, new_findings: [...value.new_findings], dissent: value.dissent, verdict: value.verdict };
  if (value.zero_dissent_checks !== undefined) {
    if (!Array.isArray(value.zero_dissent_checks) || value.zero_dissent_checks.some((item) => typeof item !== 'string' || item.length === 0)) {
      throw new ReceiptError('INVALID_ARGS', 'review.zero_dissent_checks must be strings');
    }
    review.zero_dissent_checks = [...value.zero_dissent_checks];
  }
  return review;
}

function validateSignoff(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') throw new ReceiptError('INVALID_ARGS', 'signoff must be an object or omitted');
  if (!['human', 'ci'].includes(value.by)) throw new ReceiptError('INVALID_ARGS', 'signoff.by must be human or ci');
  if (Number.isNaN(Date.parse(value.at))) throw new ReceiptError('INVALID_ARGS', 'signoff.at must be a date-time');
  return {
    by: value.by,
    identity: text(value.identity, 'signoff.identity'),
    at: text(value.at, 'signoff.at'),
    scope: text(value.scope, 'signoff.scope'),
  };
}

async function prepareEvidence(root, items) {
  if (!Array.isArray(items) || items.length === 0) throw new ReceiptError('INVALID_ARGS', 'evidence must be a non-empty array');
  const gaps = [];
  const evidence = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) {
      gaps.push('evidence entry must be an object');
      continue;
    }
    if (!KINDS.has(item.kind)) gaps.push(`evidence kind is invalid: ${String(item.kind)}`);
    if (typeof item.producer !== 'string' || item.producer.length === 0 || /^agent(?:$|[:/])/i.test(item.producer)) {
      gaps.push('evidence producer must be a non-agent tool or CI producer');
    }
    if (typeof item.run_ref !== 'string' || item.run_ref.length === 0) gaps.push('evidence run_ref is required');
    if (Number.isNaN(Date.parse(item.produced_at))) gaps.push('evidence produced_at must be a date-time');
    let digest = item.sha256;
    if (digest !== undefined) {
      try {
        hash(digest, 'evidence.sha256');
      } catch (error) {
        gaps.push(error.message);
      }
    }
    if (typeof item.run_ref === 'string' && !/^https?:\/\//i.test(item.run_ref)) {
      let file;
      try {
        file = resolveWithin(root, item.run_ref);
      } catch {
        gaps.push(`evidence run_ref is not a safe path: ${item.run_ref}`);
        continue;
      }
      let actual;
      try {
        actual = await sha256File(file);
      } catch {
        gaps.push(`evidence file is missing: ${item.run_ref}`);
        continue;
      }
      if (digest === undefined) digest = actual;
      else if (digest !== actual) gaps.push(`evidence hash mismatch: ${item.run_ref}`);
    } else if (digest === undefined) {
      gaps.push(`remote evidence requires sha256: ${String(item.run_ref)}`);
    }
    evidence.push({
      kind: item.kind,
      producer: item.producer,
      run_ref: item.run_ref,
      sha256: digest ?? '',
      produced_at: item.produced_at,
    });
  }
  return { evidence, gaps };
}

async function prepareCase(root, relativePath) {
  if (relativePath === undefined || relativePath === null) return { summary: null, gaps: [] };
  if (typeof relativePath !== 'string' || relativePath.length === 0) return { summary: null, gaps: ['correctness_case must be a path'] };
  let file;
  try {
    file = resolveWithin(root, relativePath);
  } catch {
    return { summary: null, gaps: ['correctness_case path escapes the repository'] };
  }
  let caseValue;
  try {
    caseValue = await readJsonFile(file, 'null');
  } catch {
    return { summary: null, gaps: ['correctness_case is not readable JSON'] };
  }
  if (caseValue === null) return { summary: null, gaps: ['correctness_case file is missing'] };
  try {
    assertJsonSchemaValue(caseValue, RECEIPT_SCHEMA.$defs.correctnessCase, { rootSchema: RECEIPT_SCHEMA });
  } catch (error) {
    return { summary: null, gaps: [`correctness_case schema error: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const semantic = validateCorrectnessCase(caseValue, RECEIPT_SCHEMA.$defs.correctnessCase, { rootSchema: RECEIPT_SCHEMA });
  if (!semantic.valid) return { summary: null, gaps: semantic.errors.map((error) => `correctness case ${error.path}: ${error.message}`) };
  const actualHash = await sha256File(file);
  const mapped = new Set(caseValue.mapping.map((mapping) => mapping.claim_id)).size;
  return {
    summary: {
      path: relativePath,
      sha256: actualHash,
      claims: caseValue.claims.length,
      mapped_claims: mapped,
      unaccepted_residuals: 0,
    },
    gaps: [],
  };
}

function validateArgs(args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new ReceiptError('INVALID_ARGS', 'arguments must be an object');
  for (const key of Object.keys(args)) {
    if (!ALLOWED_ARGS.has(key)) throw new ReceiptError('INVALID_ARGS', `unknown argument ${key}`);
  }
  if (!['build', 'check'].includes(args.action)) throw new ReceiptError('INVALID_ARGS', 'action must be build or check');
  const change = assertSafeId(args.change, 'change');
  if (args.action === 'check') return { action: 'check', change };
  if (args.correctness_case !== undefined && typeof args.correctness_case !== 'string') {
    throw new ReceiptError('INVALID_ARGS', 'correctness_case must be a path');
  }
  if (!['A1', 'A2'].includes(args.assurance)) throw new ReceiptError('INVALID_ARGS', 'assurance must be A1 or A2');
  if (Number.isNaN(Date.parse(args.expires_at))) throw new ReceiptError('INVALID_ARGS', 'expires_at must be a date-time');
  return {
    action: 'build',
    change,
    intent: validateIntent(args.intent),
    classification: validateClassification(args.classification),
    evidence: args.evidence,
    review: args.review === undefined ? null : validateReview(args.review),
    signoff: validateSignoff(args.signoff),
    correctness_case: args.correctness_case,
    expires_at: args.expires_at,
    assurance: args.assurance,
  };
}

async function rootFor(ctx, exec) {
  if (!exec.agent) throw new ReceiptError('AGENT_REQUIRED', 'firetree_receipt requires an owning agent session');
  return ctx.workingDirectory.ensure(exec.agent, exec.signal);
}

function failure(gaps) {
  return { ok: false, schema: 'firetree.receipt-tool/v0', gaps };
}

/**
 * @param {object} ctx - Cordis context carrying workingDirectory.
 * @returns {object} DSH tool definition.
 */
export function createReceiptTool(ctx) {
  return {
    name: 'firetree_receipt',
    description: 'Build or check the delivery receipt from external evidence, review, hypotheses, human sign-off, and an optional correctness case. check returns gaps instead of auto-fixing.',
    parameters: PARAMETERS,
    output: {
      schema: toToolSchema(OUTPUT_SCHEMA),
      render: (_args, value) => [{
        type: 'text',
        text: `firetree_receipt: ok=${String(value.ok)}; ${value.gaps.length} gap(s)${value.artifact === undefined ? '' : `; ${value.artifact.path}`}`,
      }],
    },
    async execute(args, exec) {
      const parsed = validateArgs(args);
      const root = await rootFor(ctx, exec);

      if (parsed.action === 'check') {
        let record;
        try {
          record = await readFiretreeJson(root, `.firetree/receipts/${parsed.change}.json`, { verifyHash: true, missing: 'null' });
        } catch (error) {
          return failure([error instanceof ArtifactError ? error.message : 'receipt hash check failed']);
        }
        if (record === null) return failure(['receipt is missing']);
        const semantics = await checkReceiptSemantics(record.value, { root, change: parsed.change });
        if (!semantics.valid) return failure(semantics.gaps);
        return {
          ok: true,
          schema: 'firetree.receipt-tool/v0',
          gaps: [],
          receipt: record.value,
          artifact: { path: `.firetree/receipts/${parsed.change}.json`, sha256: record.sha256 ?? '' },
        };
      }

      const assessmentRecord = await readFiretreeJson(
        root,
        `.firetree/changes/${parsed.change}/assessment.json`,
        { verifyHash: true, missing: 'null' },
      );
      if (assessmentRecord === null) return failure(['assessment is missing; run firetree_assess first']);
      const assessment = assessmentRecord.value;

      const ledgerRecord = await readFiretreeJson(
        root,
        `.firetree/changes/${parsed.change}/hypotheses.json`,
        { verifyHash: true, missing: 'null' },
      );
      const hypotheses = ledgerRecord === null
        ? { total: 0, verified: 0, accepted_risk: 0 }
        : {
            total: ledgerRecord.value.hypotheses.length,
            verified: ledgerRecord.value.hypotheses.filter((hypothesis) => hypothesis.status === 'verified').length,
            accepted_risk: 0,
          };

      const preparedEvidence = await prepareEvidence(root, parsed.evidence);
      const preparedCase = await prepareCase(root, parsed.correctness_case);
      const gaps = [...preparedEvidence.gaps, ...preparedCase.gaps];
      if (gaps.length > 0) return failure(gaps);

      let review = null;
      let reviewSignoff = null;
      if (assessment.tier !== 'L0') {
        const reviewRecord = await readReviewVerdict(root, parsed.change);
        if (reviewRecord === null) return failure(['review verdict artifact is missing']);
        if (reviewRecord.value === null) return failure(['review verdict artifact is invalid']);
        review = reviewToReceipt(reviewRecord.value);
        reviewSignoff = reviewRecord.value.signoff ?? null;
      }

      let synthesis = null;
      if (assessment.tier === 'L2' || assessment.tier === 'L1') {
        const synthesisArtifacts = await readSynthesisArtifacts(root, parsed.change);
        synthesis = synthesisSummary(synthesisArtifacts);
      }
      if (assessment.tier === 'L2' && synthesis === null) {
        return failure(['L2 receipt requires synthesis artifacts']);
      }
      const signoff = parsed.signoff ?? reviewSignoff;

      const sampling = assessment.sampling.rate >= 1
        ? { sampling: 'full' }
        : assessment.sampling.selected
          ? {
              sampling: 'sampled',
              sample: {
                decided_by: 'firetree_assess',
                decided_at: assessment.created_at,
                conclusion: `deterministic selection at rate ${assessment.sampling.rate}`,
              },
            }
          : { sampling: 'none' };

      const receipt = {
        schema: 'firetree.receipt/v0',
        change: {
          base: assessment.change.base,
          head: assessment.change.head,
          files_sha256: sha256Text(assessment.change.files.join('\n')),
        },
        tier: assessment.tier,
        policy: {
          version: assessment.policy.version,
          ...sampling,
        },
        intent: parsed.intent,
        classification: parsed.classification,
        hypotheses,
        evidence: preparedEvidence.evidence,
        review,
        correctness_case: preparedCase.summary,
        ...(synthesis === null ? {} : { synthesis }),
        impact: {
          files: assessment.impact.files,
          subsystems: assessment.impact.subsystems,
          interfaces: assessment.impact.interfaces,
          owners: assessment.impact.owners,
          traversed: assessment.impact.traversed,
          confidence: assessment.confidence,
        },
        signoff,
        expires_at: parsed.expires_at,
        assurance: parsed.assurance,
      };

      const semantics = await checkReceiptSemantics(receipt, { root, change: parsed.change });
      if (!semantics.valid) return failure(semantics.gaps);
      const artifact = await writeFiretreeJson(root, `.firetree/receipts/${parsed.change}.json`, receipt);
      return {
        ok: true,
        schema: 'firetree.receipt-tool/v0',
        gaps: [],
        receipt,
        artifact: { path: artifact.path, sha256: artifact.sha256 },
      };
    },
  };
}
