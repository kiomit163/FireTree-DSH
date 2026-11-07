/** firetree_review: tiered review package, rounds, and verdict artifacts. */

import { readFileSync } from 'node:fs';

import { assertSafeId, firetreePath, listJsonFiles, readFiretreeJson, writeFiretreeJson } from '../lib/artifacts.js';
import { assertJsonSchemaValue } from '../lib/schema.js';
import { toToolSchema } from '../lib/tool-schema.js';

const REVIEW_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/review.schema.json', import.meta.url), 'utf8'));
const PACKAGE_SCHEMA = REVIEW_SCHEMA.$defs.package;
const ROUND_SCHEMA = REVIEW_SCHEMA.$defs.round;
const VERDICT_SCHEMA = REVIEW_SCHEMA.$defs.verdict;
const ACTIONS = new Set(['open', 'round', 'verdict']);
const FINDING_VERDICTS = new Set(['open', 'accepted', 'rejected', 'resolved']);
const ROUTES = new Set(['blocker', 'non-blocker', 'question']);
const LENSES = new Set(['correctness', 'security', 'compatibility', 'performance', 'operations', 'tests', 'other']);
const STEP_IDS = new Set(['criteria', 'review', 'conclusion', 'data', 'seats', 'pre_read', 'discussion', 'written_conclusion', 'notify']);
const REQUIRED_STEPS = Object.freeze({
  L1: ['criteria', 'review', 'conclusion'],
  L2: ['criteria', 'data', 'seats', 'pre_read', 'discussion', 'written_conclusion', 'notify'],
});
const ALLOWED_ARGS = new Set([
  'action',
  'change',
  'diff_sha256',
  'spec_sha256',
  'criteria',
  'evidence',
  'seats',
  'findings',
  'checked',
  'steps',
  'dissent',
  'zero_dissent_checks',
  'signoff',
  'decision',
]);

/** Review input/rule failure. */
export class ReviewError extends Error {
  /**
   * @param {string} code - Stable machine-readable code.
   * @param {string} message - Human-readable message.
   */
  constructor(code, message) {
    super(message);
    this.name = 'ReviewError';
    this.code = code;
  }
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'schema', 'action', 'change', 'tier', 'record', 'artifact'],
  properties: {
    ok: { type: 'boolean', const: true },
    schema: { type: 'string', const: 'firetree.review/v0' },
    action: { type: 'string', enum: [...ACTIONS] },
    change: { type: 'string' },
    tier: { type: 'string', enum: ['L1', 'L2'] },
    record: { type: 'object' },
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
    action: { type: 'string', enum: [...ACTIONS] },
    change: { type: 'string' },
    diff_sha256: { type: 'string' },
    spec_sha256: { type: 'string' },
    criteria: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
    seats: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          owner: { type: 'string' },
          role: { type: 'string', enum: ['reviewer', 'owner', 'architect', 'security', 'data'] },
          provider: { type: 'string' },
          model: { type: 'string' },
        },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          location: { type: 'string' },
          claim: { type: 'string' },
          evidence: { type: 'string' },
          verdict: { type: 'string', enum: [...FINDING_VERDICTS] },
          route: { type: 'string', enum: [...ROUTES] },
          lens: { type: 'string', enum: [...LENSES] },
        },
      },
    },
    checked: { type: 'array', items: { type: 'string' } },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
    dissent: { type: 'integer' },
    zero_dissent_checks: { type: 'array', items: { type: 'string' } },
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
    decision: { type: 'string', enum: ['ready', 'not-ready'] },
  },
};

function text(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ReviewError('INVALID_ARGS', `${label} must be a non-empty string`);
  return value;
}

function hash(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new ReviewError('INVALID_ARGS', `${label} must be a lowercase SHA-256`);
  return value;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new ReviewError('INVALID_ARGS', `${label} must be an array of non-empty strings`);
  }
  return [...value];
}

function validateSeats(value, tier) {
  if (!Array.isArray(value) || value.length === 0) throw new ReviewError('INVALID_ARGS', 'seats must be a non-empty array');
  const seats = [];
  const ids = new Set();
  for (const seat of value) {
    if (typeof seat !== 'object' || seat === null) throw new ReviewError('INVALID_ARGS', 'seat must be an object');
    const id = text(seat.id, 'seat.id');
    if (ids.has(id)) throw new ReviewError('INVALID_ARGS', `duplicate seat id ${id}`);
    ids.add(id);
    const owner = text(seat.owner, 'seat.owner');
    const normalized = { id, owner };
    if (seat.role !== undefined) normalized.role = seat.role;
    if (seat.provider !== undefined) normalized.provider = text(seat.provider, 'seat.provider');
    if (seat.model !== undefined) normalized.model = text(seat.model, 'seat.model');
    seats.push(normalized);
  }
  if (tier === 'L2') {
    if (seats.length < 2) throw new ReviewError('L2_SEATS_REQUIRED', 'L2 requires at least two review seats');
    if (new Set(seats.map((seat) => seat.owner)).size < 2) throw new ReviewError('L2_SEATS_NOT_INDEPENDENT', 'L2 seats must have distinct owners');
  }
  return seats;
}

function validateFindings(value) {
  if (!Array.isArray(value)) throw new ReviewError('INVALID_ARGS', 'findings must be an array');
  return value.map((finding, index) => {
    if (typeof finding !== 'object' || finding === null) throw new ReviewError('INVALID_ARGS', `findings[${index}] must be an object`);
    if (!FINDING_VERDICTS.has(finding.verdict)) throw new ReviewError('INVALID_ARGS', `findings[${index}].verdict is invalid`);
    if (!ROUTES.has(finding.route)) throw new ReviewError('INVALID_ARGS', `findings[${index}].route is invalid`);
    if (!LENSES.has(finding.lens)) throw new ReviewError('INVALID_ARGS', `findings[${index}].lens is invalid`);
    return {
      location: text(finding.location, `findings[${index}].location`),
      claim: text(finding.claim, `findings[${index}].claim`),
      evidence: text(finding.evidence, `findings[${index}].evidence`),
      verdict: finding.verdict,
      route: finding.route,
      lens: finding.lens,
    };
  });
}

function validateSteps(value, tier) {
  if (!Array.isArray(value)) throw new ReviewError('INVALID_ARGS', 'steps must be an array');
  const required = REQUIRED_STEPS[tier];
  const seen = new Set();
  const steps = [];
  for (const step of value) {
    if (typeof step !== 'object' || step === null) throw new ReviewError('INVALID_ARGS', 'step must be an object');
    if (!STEP_IDS.has(step.id)) throw new ReviewError('INVALID_ARGS', `unknown review step ${String(step.id)}`);
    if (seen.has(step.id)) throw new ReviewError('INVALID_ARGS', `duplicate review step ${step.id}`);
    seen.add(step.id);
    steps.push({ id: step.id, evidence: text(step.evidence, `steps.${step.id}.evidence`) });
  }
  for (const id of required) {
    if (!seen.has(id)) throw new ReviewError('MISSING_STEP', `missing required ${tier} step: ${id}`);
  }
  return steps;
}

function validateSignoff(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') throw new ReviewError('INVALID_ARGS', 'signoff must be an object');
  if (!['human', 'ci'].includes(value.by)) throw new ReviewError('INVALID_ARGS', 'signoff.by must be human or ci');
  return {
    by: value.by,
    identity: text(value.identity, 'signoff.identity'),
    at: text(value.at, 'signoff.at'),
    scope: text(value.scope, 'signoff.scope'),
  };
}

function validateArgs(args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new ReviewError('INVALID_ARGS', 'arguments must be an object');
  for (const key of Object.keys(args)) {
    if (!ALLOWED_ARGS.has(key)) throw new ReviewError('INVALID_ARGS', `unknown argument ${key}`);
  }
  if (!ACTIONS.has(args.action)) throw new ReviewError('INVALID_ARGS', 'action must be open, round, or verdict');
  const change = assertSafeId(args.change, 'change');

  if (args.action === 'open') {
    return {
      action: 'open',
      change,
      diff_sha256: hash(args.diff_sha256, 'diff_sha256'),
      spec_sha256: hash(args.spec_sha256, 'spec_sha256'),
      criteria: stringArray(args.criteria, 'criteria'),
      evidence: args.evidence === undefined ? [] : stringArray(args.evidence, 'evidence'),
      seats: args.seats,
    };
  }
  if (args.action === 'round') {
    return {
      action: 'round',
      change,
      findings: validateFindings(args.findings ?? []),
      checked: args.checked === undefined ? [] : stringArray(args.checked, 'checked'),
    };
  }
  if (!Number.isInteger(args.dissent) || args.dissent < 0) throw new ReviewError('INVALID_ARGS', 'dissent must be a non-negative integer');
  if (!['ready', 'not-ready'].includes(args.decision)) throw new ReviewError('INVALID_ARGS', 'decision must be ready or not-ready');
  const zeroChecks = args.zero_dissent_checks === undefined ? [] : stringArray(args.zero_dissent_checks, 'zero_dissent_checks');
  return {
    action: 'verdict',
    change,
    steps: args.steps,
    dissent: args.dissent,
    zero_dissent_checks: zeroChecks,
    signoff: validateSignoff(args.signoff),
    decision: args.decision,
  };
}

async function rootFor(ctx, exec) {
  if (!exec.agent) throw new ReviewError('AGENT_REQUIRED', 'firetree_review requires an owning agent session');
  return ctx.workingDirectory.ensure(exec.agent, exec.signal);
}

async function assessmentFor(root, change) {
  const record = await readFiretreeJson(root, `.firetree/changes/${change}/assessment.json`, { verifyHash: true, missing: 'null' });
  if (record === null) throw new ReviewError('ASSESSMENT_REQUIRED', 'run firetree_assess before opening a review');
  const tier = record.value.tier;
  if (tier !== 'L1' && tier !== 'L2') throw new ReviewError('TIER_NOT_REVIEWABLE', 'only L1/L2 changes require a review');
  return record.value;
}

async function readPackage(root, change) {
  const record = await readFiretreeJson(root, `.firetree/changes/${change}/package.json`, { verifyHash: true, missing: 'null' });
  if (record === null) throw new ReviewError('REVIEW_NOT_OPEN', 'review package is missing; call open first');
  assertJsonSchemaValue(record.value, PACKAGE_SCHEMA, { rootSchema: REVIEW_SCHEMA });
  return { value: record.value, sha256: record.sha256 ?? '' };
}

async function readRounds(root, change) {
  const files = await listJsonFiles(firetreePath(root, 'changes', change));
  const rounds = [];
  for (const file of files) {
    const match = /\/round-(\d+)\.json$/.exec(file.replaceAll('\\', '/'));
    if (!match) continue;
    const record = await readFiretreeJson(root, `.firetree/changes/${change}/round-${match[1]}.json`, { verifyHash: true, missing: 'null' });
    if (record === null) continue;
    assertJsonSchemaValue(record.value, ROUND_SCHEMA, { rootSchema: REVIEW_SCHEMA });
    rounds.push(record.value);
  }
  rounds.sort((left, right) => left.round - right.round);
  return rounds;
}

/**
 * @param {object} ctx - Cordis context carrying workingDirectory.
 * @returns {object} DSH tool definition.
 */
export function createReviewTool(ctx) {
  return {
    name: 'firetree_review',
    description: 'Open a tiered review package, record rounds of findings, and issue a verdict. L1 requires three steps; L2 requires seven steps, two rounds, and human sign-off.',
    parameters: PARAMETERS,
    output: {
      schema: toToolSchema(OUTPUT_SCHEMA),
      render: (_args, value) => [{
        type: 'text',
        text: `firetree_review ${value.action}: ${value.change} (${value.tier}); ${value.artifact.path}`,
      }],
    },
    async execute(args, exec) {
      const parsed = validateArgs(args);
      const root = await rootFor(ctx, exec);
      const assessment = await assessmentFor(root, parsed.change);
      const tier = assessment.tier;

      if (parsed.action === 'open') {
        const existing = await readFiretreeJson(root, `.firetree/changes/${parsed.change}/package.json`, { verifyHash: true, missing: 'null' });
        if (existing !== null) throw new ReviewError('REVIEW_ALREADY_OPEN', 'review package already exists');
        const pkg = {
          schema: 'firetree.review-package/v0',
          change: parsed.change,
          tier,
          diff_sha256: parsed.diff_sha256,
          spec_sha256: parsed.spec_sha256,
          criteria: parsed.criteria,
          evidence: parsed.evidence,
          seats: validateSeats(parsed.seats, tier),
          opened_at: new Date().toISOString(),
        };
        assertJsonSchemaValue(pkg, PACKAGE_SCHEMA, { rootSchema: REVIEW_SCHEMA });
        const artifact = await writeFiretreeJson(root, `.firetree/changes/${parsed.change}/package.json`, pkg);
        return {
          ok: true,
          schema: 'firetree.review/v0',
          action: 'open',
          change: parsed.change,
          tier,
          record: pkg,
          artifact: { path: artifact.path, sha256: artifact.sha256 },
        };
      }

      const pkg = await readPackage(root, parsed.change);
      const rounds = await readRounds(root, parsed.change);

      if (parsed.action === 'round') {
        const maxRounds = tier === 'L1' ? 2 : 3;
        const next = (rounds.at(-1)?.round ?? 0) + 1;
        if (next > maxRounds) throw new ReviewError('ROUND_LIMIT', `${tier} allows at most ${maxRounds} rounds`);
        if (parsed.findings.length === 0 && parsed.checked.length === 0) {
          throw new ReviewError('ZERO_FINDINGS_CHECK_REQUIRED', 'a zero-finding round must record what was checked');
        }
        const round = {
          schema: 'firetree.review-round/v0',
          change: parsed.change,
          round: next,
          findings: parsed.findings,
          ...(parsed.checked.length > 0 ? { checked: parsed.checked } : {}),
          created_at: new Date().toISOString(),
        };
        assertJsonSchemaValue(round, ROUND_SCHEMA, { rootSchema: REVIEW_SCHEMA });
        const artifact = await writeFiretreeJson(root, `.firetree/changes/${parsed.change}/round-${next}.json`, round);
        return {
          ok: true,
          schema: 'firetree.review/v0',
          action: 'round',
          change: parsed.change,
          tier,
          record: round,
          artifact: { path: artifact.path, sha256: artifact.sha256 },
        };
      }

      if (rounds.length === 0) throw new ReviewError('REVIEW_ROUNDS_REQUIRED', 'cannot issue a verdict without a round');
      if (tier === 'L2' && rounds.length < 2) throw new ReviewError('L2_ROUNDS_REQUIRED', 'L2 requires at least two rounds');
      const steps = validateSteps(parsed.steps, tier);
      const blockers = rounds
        .flatMap((round) => round.findings)
        .filter((finding) => finding.route === 'blocker' && !['resolved', 'rejected'].includes(finding.verdict));
      if (parsed.decision === 'ready' && blockers.length > 0) {
        throw new ReviewError('OPEN_BLOCKER', `ready verdict has ${blockers.length} unresolved blocker(s)`);
      }
      if (parsed.decision === 'ready' && (rounds.at(-1)?.findings.length ?? 0) !== 0) {
        throw new ReviewError('REVIEW_NOT_CONVERGED', 'ready verdict requires zero findings in the final round');
      }
      if (parsed.dissent === 0 && parsed.zero_dissent_checks.length === 0) {
        throw new ReviewError('ZERO_DISSENT_CHECK_REQUIRED', 'zero dissent requires what-was-checked evidence');
      }
      if (tier === 'L2') {
        if (parsed.signoff === null) throw new ReviewError('HUMAN_SIGNOFF_REQUIRED', 'L2 verdict requires human sign-off');
        if (parsed.signoff.by !== 'human') throw new ReviewError('HUMAN_SIGNOFF_REQUIRED', 'L2 verdict sign-off must be human');
      }
      const verdict = {
        schema: 'firetree.review-verdict/v0',
        change: parsed.change,
        tier,
        steps,
        rounds: rounds.length,
        new_findings: rounds.map((round) => round.findings.length),
        dissent: parsed.dissent,
        ...(parsed.zero_dissent_checks.length > 0 ? { zero_dissent_checks: parsed.zero_dissent_checks } : {}),
        ...(parsed.signoff === null ? {} : { signoff: parsed.signoff }),
        decision: parsed.decision,
        created_at: new Date().toISOString(),
      };
      assertJsonSchemaValue(verdict, VERDICT_SCHEMA, { rootSchema: REVIEW_SCHEMA });
      const artifact = await writeFiretreeJson(root, `.firetree/changes/${parsed.change}/verdict.json`, verdict);
      return {
        ok: true,
        schema: 'firetree.review/v0',
        action: 'verdict',
        change: parsed.change,
        tier,
        record: verdict,
        artifact: { path: artifact.path, sha256: artifact.sha256 },
      };
    },
  };
}
