/** firetree_synthesize: L2 independent-seat synthesis planning and round records. */

import { readFileSync } from 'node:fs';

import { assertSafeId, firetreePath, listJsonFiles, readFiretreeJson, writeFiretreeJson } from '../lib/artifacts.js';
import { withChangeLock } from '../lib/change-lock.js';
import { appendEvent } from '../lib/events.js';
import { assertJsonSchemaValue } from '../lib/schema.js';
import { toToolSchema } from '../lib/tool-schema.js';

const SYNTHESIS_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/synthesis.schema.json', import.meta.url), 'utf8'));
const PLAN_SCHEMA = SYNTHESIS_SCHEMA.$defs.plan;
const ROUND_SCHEMA = SYNTHESIS_SCHEMA.$defs.round;
const ACTIONS = new Set(['plan', 'record']);
const KINDS = new Set(['data', 'model', 'experience']);
const DECISIONS = new Set(['accepted', 'rejected']);
const ALLOWED_ARGS = new Set(['action', 'change', 'question', 'risk_tier', 'timebox_minutes', 'seats', 'synthesizer', 'round']);

/** Synthesis input/rule failure. */
export class SynthesisError extends Error {
  /**
   * @param {string} code - Stable machine-readable code.
   * @param {string} message - Human-readable message.
   */
  constructor(code, message) {
    super(message);
    this.name = 'SynthesisError';
    this.code = code;
  }
}

const SEATS = Object.freeze([
  { id: 'data-1', kind: 'data', requirement: 'Run a deterministic command and report a numeric value; no values means no data seat.' },
  { id: 'model-1', kind: 'model', requirement: 'Independent provider/model A; separate context; state claims, evidence, confidence, objections.' },
  { id: 'model-2', kind: 'model', requirement: 'Independent provider/model B, different from model-1; separate context; same output contract.' },
  { id: 'experience-1', kind: 'experience', requirement: 'Domain judgment with cited evidence; no unsupported assertion.' },
]);

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'schema', 'action', 'change', 'record', 'artifact'],
  properties: {
    ok: { type: 'boolean', const: true },
    schema: { type: 'string', const: 'firetree.synthesize/v1' },
    action: { type: 'string', enum: [...ACTIONS] },
    change: { type: 'string' },
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
    question: { type: 'string' },
    risk_tier: { type: 'string', enum: ['L2'] },
    timebox_minutes: { type: 'integer' },
    round: { type: 'integer' },
    seats: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: [...KINDS] },
          provider: { type: 'string' },
          model: { type: 'string' },
          claim: { type: 'string' },
          evidence: { type: 'string' },
          confidence: { type: 'number' },
          objections: { type: 'array', items: { type: 'string' } },
          data: {
            type: 'object',
            additionalProperties: false,
            properties: {
              command: { type: 'string' },
              value: { type: 'number' },
            },
          },
        },
      },
    },
    synthesizer: {
      type: 'object',
      additionalProperties: false,
      properties: {
        responded_to: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              objection: { type: 'string' },
              decision: { type: 'string', enum: [...DECISIONS] },
              evidence: { type: 'string' },
            },
          },
        },
        converged: { type: 'boolean' },
        next_question: { type: 'string' },
        elapsed_minutes: { type: 'number' },
      },
    },
  },
};

function text(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new SynthesisError('INVALID_ARGS', `${label} must be a non-empty string`);
  return value;
}

function validateArgs(args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new SynthesisError('INVALID_ARGS', 'arguments must be an object');
  for (const key of Object.keys(args)) {
    if (!ALLOWED_ARGS.has(key)) throw new SynthesisError('INVALID_ARGS', `unknown argument ${key}`);
  }
  if (!ACTIONS.has(args.action)) throw new SynthesisError('INVALID_ARGS', 'action must be plan or record');
  const change = assertSafeId(args.change, 'change');
  if (args.action === 'plan') {
    if (args.risk_tier !== undefined && args.risk_tier !== 'L2') throw new SynthesisError('L2_ONLY', 'synthesis is only for L2');
    const timebox = args.timebox_minutes ?? 20;
    if (!Number.isInteger(timebox) || timebox < 1 || timebox > 60) throw new SynthesisError('INVALID_ARGS', 'timebox_minutes must be 1..60');
    return { action: 'plan', change, question: text(args.question, 'question'), timebox_minutes: timebox };
  }
  if (!Array.isArray(args.seats)) throw new SynthesisError('INVALID_ARGS', 'seats must be an array');
  if (typeof args.synthesizer !== 'object' || args.synthesizer === null) throw new SynthesisError('INVALID_ARGS', 'synthesizer must be an object');
  if (args.round !== undefined && (!Number.isInteger(args.round) || args.round < 1 || args.round > 3)) {
    throw new SynthesisError('INVALID_ARGS', 'round must be 1..3');
  }
  return { action: 'record', change, seats: args.seats, synthesizer: args.synthesizer, round: args.round };
}

async function rootFor(ctx, exec) {
  if (!exec.agent) throw new SynthesisError('AGENT_REQUIRED', 'firetree_synthesize requires an owning agent session');
  return ctx.workingDirectory.ensure(exec.agent, exec.signal);
}

const planPath = (change) => `.firetree/changes/${change}/synthesis/plan.json`;
const roundPath = (change, round) => `.firetree/changes/${change}/synthesis/round-${round}.json`;

async function readAssessment(root, change) {
  const record = await readFiretreeJson(root, `.firetree/changes/${change}/assessment.json`, { verifyHash: true, missing: 'null' });
  if (record === null) throw new SynthesisError('ASSESSMENT_REQUIRED', 'run firetree_assess before synthesis');
  if (record.value.tier !== 'L2') throw new SynthesisError('L2_ONLY', 'synthesis is only for L2 changes');
  return record.value;
}

async function readPlan(root, change) {
  const record = await readFiretreeJson(root, planPath(change), { verifyHash: true, missing: 'null' });
  if (record === null) throw new SynthesisError('PLAN_REQUIRED', 'synthesis plan is missing; call plan first');
  assertJsonSchemaValue(record.value, PLAN_SCHEMA, { rootSchema: SYNTHESIS_SCHEMA });
  return record.value;
}

async function readRounds(root, change) {
  const files = await listJsonFiles(firetreePath(root, 'changes', change, 'synthesis'));
  const rounds = [];
  for (const file of files) {
    const match = /\/round-(\d+)\.json$/.exec(file.replaceAll('\\', '/'));
    if (!match) continue;
    const record = await readFiretreeJson(root, roundPath(change, match[1]), { verifyHash: true, missing: 'null' });
    if (record === null) continue;
    assertJsonSchemaValue(record.value, ROUND_SCHEMA, { rootSchema: SYNTHESIS_SCHEMA });
    rounds.push(record.value);
  }
  return rounds.sort((left, right) => left.round - right.round);
}

function validateSeats(value) {
  if (!Array.isArray(value) || value.length < 2) throw new SynthesisError('INVALID_ARGS', 'at least two seats are required');
  const ids = new Set();
  const seats = [];
  for (const seat of value) {
    if (typeof seat !== 'object' || seat === null) throw new SynthesisError('INVALID_ARGS', 'seat must be an object');
    const id = text(seat.id, 'seat.id');
    if (ids.has(id)) throw new SynthesisError('INVALID_ARGS', `duplicate seat id ${id}`);
    ids.add(id);
    if (!KINDS.has(seat.kind)) throw new SynthesisError('INVALID_ARGS', `seat ${id} kind is invalid`);
    const result = {
      id,
      kind: seat.kind,
      provider: text(seat.provider, `seat ${id} provider`),
      model: text(seat.model, `seat ${id} model`),
      claim: text(seat.claim, `seat ${id} claim`),
      evidence: text(seat.evidence, `seat ${id} evidence`),
      confidence: seat.confidence,
      objections: Array.isArray(seat.objections)
        ? seat.objections.map((objection, index) => text(objection, `seat ${id} objections[${index}]`))
        : (() => { throw new SynthesisError('INVALID_ARGS', `seat ${id} objections must be an array`); })(),
    };
    if (typeof result.confidence !== 'number' || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) {
      throw new SynthesisError('INVALID_ARGS', `seat ${id} confidence must be 0..1`);
    }
    if (seat.kind === 'data') {
      if (typeof seat.data !== 'object' || seat.data === null
        || typeof seat.data.command !== 'string' || seat.data.command.trim().length === 0
        || typeof seat.data.value !== 'number' || !Number.isFinite(seat.data.value)) {
        throw new SynthesisError('DATA_SEAT_INVALID', `data seat ${id} needs command and numeric value`);
      }
      result.data = { command: seat.data.command, value: seat.data.value };
    }
    seats.push(result);
  }
  const modelSeats = seats.filter((seat) => seat.kind === 'model');
  if (modelSeats.length < 2) throw new SynthesisError('INDEPENDENT_SEATS_REQUIRED', 'at least two model seats are required');
  const pairs = new Set(modelSeats.map((seat) => `${seat.provider}::${seat.model}`));
  if (pairs.size < 2) throw new SynthesisError('INDEPENDENT_SEATS_REQUIRED', 'model seats need at least two distinct provider/model pairs');
  if (!seats.some((seat) => seat.kind === 'data')) throw new SynthesisError('DATA_SEAT_REQUIRED', 'at least one data seat is required');
  return seats;
}

function validateSynthesizer(value) {
  if (!Array.isArray(value.responded_to)) throw new SynthesisError('INVALID_ARGS', 'synthesizer.responded_to must be an array');
  const responses = value.responded_to.map((response, index) => {
    if (typeof response !== 'object' || response === null) throw new SynthesisError('INVALID_ARGS', `responded_to[${index}] must be an object`);
    if (!DECISIONS.has(response.decision)) throw new SynthesisError('INVALID_ARGS', `responded_to[${index}].decision is invalid`);
    return {
      objection: text(response.objection, `responded_to[${index}].objection`),
      decision: response.decision,
      evidence: text(response.evidence, `responded_to[${index}].evidence`),
    };
  });
  if (typeof value.converged !== 'boolean') throw new SynthesisError('INVALID_ARGS', 'synthesizer.converged must be boolean');
  if (typeof value.elapsed_minutes !== 'number' || !Number.isFinite(value.elapsed_minutes) || value.elapsed_minutes < 0) {
    throw new SynthesisError('INVALID_ARGS', 'synthesizer.elapsed_minutes must be a non-negative number');
  }
  const result = { responded_to: responses, converged: value.converged, elapsed_minutes: value.elapsed_minutes };
  if (value.next_question !== undefined) result.next_question = text(value.next_question, 'synthesizer.next_question');
  return result;
}

function tokens(textValue) {
  const lower = textValue.toLowerCase();
  const latin = lower.match(/[a-z0-9]+/g) ?? [];
  const han = lower.match(/[\p{Script=Han}]/gu) ?? [];
  return new Set([...latin, ...han]);
}

function overlap(seats) {
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < seats.length; i += 1) {
    for (let j = i + 1; j < seats.length; j += 1) {
      const left = tokens(seats[i].claim);
      const right = tokens(seats[j].claim);
      const intersection = [...left].filter((token) => right.has(token)).length;
      const union = new Set([...left, ...right]).size;
      total += union === 0 ? 1 : intersection / union;
      pairs += 1;
    }
  }
  return pairs === 0 ? 0 : total / pairs;
}

/**
 * @param {object} ctx - Cordis context carrying workingDirectory.
 * @returns {object} DSH tool definition.
 */
export function createSynthesizeTool(ctx) {
  return {
    name: 'firetree_synthesize',
    description: 'Plan or record an L2 independent-seat synthesis round. Rejects one-model claims, data seats without command/value, unanswered objections, timeout convergence, and more than three rounds.',
    parameters: PARAMETERS,
    output: {
      schema: toToolSchema(OUTPUT_SCHEMA),
      render: (_args, value) => [{
        type: 'text',
        text: `firetree_synthesize ${value.action}: ${value.change}; ${value.artifact.path}`,
      }],
    },
    async execute(args, exec) {
      const parsed = validateArgs(args);
      const root = await rootFor(ctx, exec);
      const run = async () => {
      await readAssessment(root, parsed.change);

      if (parsed.action === 'plan') {
        const existing = await readFiretreeJson(root, planPath(parsed.change), { verifyHash: true, missing: 'null' });
        if (existing !== null) throw new SynthesisError('PLAN_EXISTS', 'synthesis plan already exists');
        const plan = {
          schema: 'firetree.synthesis-plan/v1',
          change: parsed.change,
          tier: 'L2',
          question: parsed.question,
          timebox_minutes: parsed.timebox_minutes,
          max_rounds: 3,
          seats: SEATS,
          output_schema: {
            type: 'object',
            required: ['seats', 'synthesizer'],
            properties: {
              seats: { type: 'array' },
              synthesizer: { type: 'object' },
            },
          },
          created_at: new Date().toISOString(),
        };
        assertJsonSchemaValue(plan, PLAN_SCHEMA, { rootSchema: SYNTHESIS_SCHEMA });
        const artifact = await writeFiretreeJson(root, planPath(parsed.change), plan);
        await appendEvent(root, {
          change: parsed.change, actor: 'agent', tool: 'firetree_synthesize', action: 'plan', tier: 'L2', result: 'ok',
          detail: { seats: plan.seats.length },
        });
        return {
          ok: true,
          schema: 'firetree.synthesize/v1',
          action: 'plan',
          change: parsed.change,
          record: plan,
          artifact: { path: artifact.path, sha256: artifact.sha256 },
        };
      }

      const plan = await readPlan(root, parsed.change);
      const rounds = await readRounds(root, parsed.change);
      const next = (rounds.at(-1)?.round ?? 0) + 1;
      if (parsed.round !== undefined && parsed.round !== next) throw new SynthesisError('ROUND_SEQUENCE', `expected round ${next}`);
      if (next > plan.max_rounds) throw new SynthesisError('ROUND_LIMIT', `synthesis allows at most ${plan.max_rounds} rounds`);

      const seats = validateSeats(parsed.seats);
      const synthesizer = validateSynthesizer(parsed.synthesizer);
      const objections = seats.flatMap((seat) => seat.objections);
      const answered = new Set(synthesizer.responded_to.map((response) => response.objection));
      const unresolved = objections.filter((objection) => !answered.has(objection));
      const previousObjections = new Set(rounds.flatMap((round) => round.seats.flatMap((seat) => seat.objections)));
      const newObjections = objections.filter((objection) => !previousObjections.has(objection));
      const timedOut = synthesizer.elapsed_minutes > plan.timebox_minutes;
      if (synthesizer.converged && (unresolved.length > 0 || newObjections.length > 0 || timedOut)) {
        throw new SynthesisError('FALSE_CONVERGENCE', 'cannot claim convergence with unresolved/new objections or after the timebox');
      }
      const measuredOverlap = overlap(seats);
      const metrics = {
        overlap: Number(measuredOverlap.toFixed(4)),
        diversity: Number((1 - measuredOverlap).toFixed(4)),
        new_objections: newObjections.length,
        unresolved_objections: unresolved.length,
        converged: synthesizer.converged && unresolved.length === 0 && newObjections.length === 0 && !timedOut,
        timed_out: timedOut,
      };
      const round = {
        schema: 'firetree.synthesis-round/v1',
        change: parsed.change,
        round: next,
        seats,
        synthesizer,
        metrics,
        created_at: new Date().toISOString(),
      };
      assertJsonSchemaValue(round, ROUND_SCHEMA, { rootSchema: SYNTHESIS_SCHEMA });
      const artifact = await writeFiretreeJson(root, roundPath(parsed.change, next), round);
      await appendEvent(root, {
        change: parsed.change, actor: 'agent', tool: 'firetree_synthesize', action: 'record', tier: 'L2', result: 'ok',
        detail: { round: next, converged: metrics.converged },
      });
      return {
        ok: true,
        schema: 'firetree.synthesize/v1',
        action: 'record',
        change: parsed.change,
        record: round,
        artifact: { path: artifact.path, sha256: artifact.sha256 },
      };
      };
      return withChangeLock(root, parsed.change, run);
    },
  };
}
