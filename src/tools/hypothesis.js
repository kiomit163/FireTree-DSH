/** firetree_hypothesis: change-level hypothesis ledger with external verification. */

import { readFileSync } from 'node:fs';

import {
  ArtifactError,
  assertSafeId,
  readFiretreeJson,
  resolveWithin,
  sha256File,
  writeFiretreeJson,
} from '../lib/artifacts.js';
import { appendEvent } from '../lib/events.js';
import { assertJsonSchemaValue, SchemaValidationError } from '../lib/schema.js';
import { toToolSchema } from '../lib/tool-schema.js';

const HYPOTHESES_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/hypotheses.schema.json', import.meta.url), 'utf8'));
const METHODS = new Set(['test', 'metric', 'experiment', 'analysis']);
const KINDS = new Set(['assumption', 'risk', 'claim']);
const RESULTS = new Set(['verified', 'falsified']);
const ALLOWED_ARGS = new Set([
  'action', 'change', 'id', 'statement', 'kind', 'detection', 'result', 'evidence_ref',
  'reason', 'accepted_by', 'approval_ref', 'expires_at',
]);

/** Hypothesis input/rule failure. */
export class HypothesisError extends Error {
  /**
   * @param {string} code - Stable machine-readable code.
   * @param {string} message - Human-readable message.
   */
  constructor(code, message) {
    super(message);
    this.name = 'HypothesisError';
    this.code = code;
  }
}

const DETECTION_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['method', 'pass_criterion', 'evidence_kind'],
  properties: {
    method: { type: 'string', enum: [...METHODS] },
    command: { type: 'string' },
    pass_criterion: { type: 'string' },
    evidence_kind: { type: 'string' },
  },
};

const EVIDENCE_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['producer', 'run_ref', 'sha256', 'produced_at'],
  properties: {
    producer: { type: 'string' },
    run_ref: { type: 'string' },
    sha256: { type: 'string' },
    produced_at: { type: 'string' },
  },
};

const HYPOTHESIS_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'statement', 'kind', 'detection', 'status', 'created_at', 'updated_at'],
  properties: {
    id: { type: 'string' },
    statement: { type: 'string' },
    kind: { type: 'string', enum: [...KINDS] },
    detection: DETECTION_OUTPUT,
    status: { type: 'string', enum: ['untested', 'verified', 'falsified'] },
    evidence_ref: EVIDENCE_OUTPUT,
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
  },
};

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'schema', 'action', 'change', 'exists', 'total', 'verified', 'falsified', 'untested', 'coverage', 'hypotheses', 'next_actions', 'artifact'],
  properties: {
    ok: { type: 'boolean', const: true },
    schema: { type: 'string', const: 'firetree.hypothesis/v1' },
    action: { type: 'string', enum: ['add', 'verify', 'list'] },
    change: { type: 'string' },
    exists: { type: 'boolean' },
    total: { type: 'integer' },
    verified: { type: 'integer' },
    falsified: { type: 'integer' },
    untested: { type: 'integer' },
    coverage: { type: 'number' },
    hypotheses: { type: 'array', items: HYPOTHESIS_OUTPUT },
    next_actions: { type: 'array', items: { type: 'string' } },
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
    action: { type: 'string', enum: ['add', 'verify', 'accept', 'list'] },
    change: { type: 'string' },
    id: { type: 'string' },
    statement: { type: 'string' },
    kind: { type: 'string', enum: [...KINDS] },
    reason: { type: 'string', description: 'Reason for accepting residual risk (accept action).' },
    accepted_by: { type: 'string', description: 'Human identifier for risk acceptance (accept action).' },
    approval_ref: { type: 'string', description: 'Approval record reference (accept action).' },
    expires_at: { type: 'string', description: 'Risk acceptance expiry date-time (accept action).' },
    detection: {
      type: 'object',
      additionalProperties: false,
      properties: {
        method: { type: 'string', enum: [...METHODS] },
        command: { type: 'string' },
        pass_criterion: { type: 'string' },
        evidence_kind: { type: 'string' },
      },
    },
    result: { type: 'string', enum: [...RESULTS] },
    evidence_ref: {
      type: 'object',
      additionalProperties: false,
      properties: {
        producer: { type: 'string' },
        run_ref: { type: 'string' },
        sha256: { type: 'string' },
        produced_at: { type: 'string' },
      },
    },
  },
};

function text(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new HypothesisError('INVALID_ARGS', `${label} must be a non-empty string`);
  return value;
}

function validateDetection(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HypothesisError('DETECTION_REQUIRED', 'add requires a detection object');
  }
  if (!METHODS.has(value.method)) throw new HypothesisError('DETECTION_REQUIRED', `detection.method must be one of ${[...METHODS].join('|')}`);
  const detection = {
    method: value.method,
    pass_criterion: text(value.pass_criterion, 'detection.pass_criterion'),
    evidence_kind: text(value.evidence_kind, 'detection.evidence_kind'),
  };
  if (value.command !== undefined) detection.command = text(value.command, 'detection.command');
  return detection;
}

function validateEvidenceShape(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HypothesisError('EVIDENCE_REQUIRED', 'verify requires an evidence_ref object');
  }
  const producer = text(value.producer, 'evidence_ref.producer');
  if (/^agent(?:$|[:/])/i.test(producer)) throw new HypothesisError('AGENT_EVIDENCE_REJECTED', 'evidence producer cannot be an agent');
  const runRef = text(value.run_ref, 'evidence_ref.run_ref');
  const sha256 = text(value.sha256, 'evidence_ref.sha256');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HypothesisError('INVALID_ARGS', 'evidence_ref.sha256 must be a lowercase SHA-256');
  const producedAt = text(value.produced_at, 'evidence_ref.produced_at');
  if (Number.isNaN(Date.parse(producedAt))) throw new HypothesisError('INVALID_ARGS', 'evidence_ref.produced_at must be a date-time');
  return { producer, run_ref: runRef, sha256, produced_at: producedAt };
}

async function validateEvidence(root, evidence) {
  const shape = validateEvidenceShape(evidence);
  if (/^https?:\/\//i.test(shape.run_ref)) {
    throw new HypothesisError('EVIDENCE_REMOTE_REJECTED', 'remote evidence is not accepted; use a local artifact');
  }
  let file;
  try {
    file = resolveWithin(root, shape.run_ref);
  } catch (error) {
    throw new HypothesisError('INVALID_ARGS', `evidence_ref.run_ref must be a safe path or URL`);
  }
  let actual;
  try {
    actual = await sha256File(file);
  } catch {
    throw new HypothesisError('EVIDENCE_MISSING', `evidence file not found: ${shape.run_ref}`);
  }
  if (actual !== shape.sha256) throw new HypothesisError('EVIDENCE_HASH_MISMATCH', `evidence hash does not match ${shape.run_ref}`);
  return shape;
}

function validateArgs(args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new HypothesisError('INVALID_ARGS', 'arguments must be an object');
  for (const key of Object.keys(args)) {
    if (!ALLOWED_ARGS.has(key)) throw new HypothesisError('INVALID_ARGS', `unknown argument ${key}`);
  }
  const action = args.action;
  if (!['add', 'verify', 'accept', 'list'].includes(action)) throw new HypothesisError('INVALID_ARGS', 'action must be add, verify, accept, or list');
  const change = assertSafeId(args.change, 'change');
  if (action === 'add') {
    return {
      action,
      change,
      statement: text(args.statement, 'statement'),
      kind: KINDS.has(args.kind) ? args.kind : (() => { throw new HypothesisError('INVALID_ARGS', 'kind must be assumption, risk, or claim'); })(),
      detection: validateDetection(args.detection),
    };
  }
  if (action === 'verify') {
    if (typeof args.id !== 'string' || !/^h[0-9]+$/.test(args.id)) throw new HypothesisError('INVALID_ARGS', 'id must match h<number>');
    if (!RESULTS.has(args.result)) throw new HypothesisError('INVALID_ARGS', 'result must be verified or falsified');
    return { action, change, id: args.id, result: args.result, evidence_ref: args.evidence_ref };
  }
  if (action === 'accept') {
    if (typeof args.id !== 'string' || !/^h[0-9]+$/.test(args.id)) throw new HypothesisError('INVALID_ARGS', 'id must match h<number>');
    const acceptedBy = text(args.accepted_by, 'accepted_by');
    if (!acceptedBy.startsWith('human:')) throw new HypothesisError('INVALID_ARGS', 'accepted_by must start with human:');
    const expiresAt = text(args.expires_at, 'expires_at');
    if (Number.isNaN(Date.parse(expiresAt))) throw new HypothesisError('INVALID_ARGS', 'expires_at must be a date-time');
    if (Date.parse(expiresAt) <= Date.now()) throw new HypothesisError('INVALID_ARGS', 'expires_at must be in the future');
    return {
      action,
      change,
      id: args.id,
      reason: text(args.reason, 'reason'),
      accepted_by: acceptedBy,
      approval_ref: text(args.approval_ref, 'approval_ref'),
      expires_at: expiresAt,
    };
  }
  return { action, change };
}

function ledgerPath(change) {
  return `.firetree/changes/${change}/hypotheses.json`;
}

async function readLedger(root, change) {
  const path = ledgerPath(change);
  const record = await readFiretreeJson(root, path, { verifyHash: true, missing: 'null' });
  if (record === null) {
    return {
      exists: false,
      sha256: '',
      value: { schema: 'firetree.hypotheses/v1', change, hypotheses: [], accepted_risks: [], updated_at: null },
    };
  }
  try {
    assertJsonSchemaValue(record.value, HYPOTHESES_SCHEMA);
  } catch (error) {
    if (error instanceof SchemaValidationError) throw new HypothesisError('INVALID_LEDGER', `hypotheses ledger is invalid: ${error.message}`);
    throw error;
  }
  if (record.value.change !== change) throw new HypothesisError('INVALID_LEDGER', 'hypotheses ledger change id does not match');
  return { exists: true, sha256: record.sha256 ?? '', value: record.value };
}

function nextId(hypotheses) {
  let maximum = 0;
  for (const hypothesis of hypotheses) {
    const match = /^h([0-9]+)$/.exec(hypothesis.id);
    if (match) maximum = Math.max(maximum, Number.parseInt(match[1], 10));
  }
  return `h${maximum + 1}`;
}

function summarize(exists, ledger, change, artifact) {
  const total = ledger.hypotheses.length;
  const verified = ledger.hypotheses.filter((hypothesis) => hypothesis.status === 'verified').length;
  const falsified = ledger.hypotheses.filter((hypothesis) => hypothesis.status === 'falsified').length;
  const untested = ledger.hypotheses.filter((hypothesis) => hypothesis.status === 'untested').length;
  const nextActions = ledger.hypotheses
    .filter((hypothesis) => hypothesis.status === 'untested')
    .map((hypothesis) => `Verify or explicitly accept risk for ${hypothesis.id}.`);
  return {
    ok: true,
    schema: 'firetree.hypothesis/v1',
    action: 'list',
    change,
    exists,
    total,
    verified,
    falsified,
    untested,
    coverage: total === 0 ? 0 : verified / total,
    hypotheses: ledger.hypotheses,
    next_actions: nextActions,
    artifact: { path: ledgerPath(change), sha256: artifact },
  };
}

async function writeLedger(root, change, ledger) {
  ledger.updated_at = new Date().toISOString();
  assertJsonSchemaValue(ledger, HYPOTHESES_SCHEMA);
  return writeFiretreeJson(root, ledgerPath(change), ledger);
}

async function rootFor(ctx, exec) {
  if (!exec.agent) throw new HypothesisError('AGENT_REQUIRED', 'firetree_hypothesis requires an owning agent session');
  return ctx.workingDirectory.ensure(exec.agent, exec.signal);
}

/**
 * @param {object} ctx - Cordis context carrying workingDirectory.
 * @returns {object} DSH tool definition.
 */
export function createHypothesisTool(ctx) {
  return {
    name: 'firetree_hypothesis',
    description: 'Add, verify, and list change-level hypotheses. add requires a detection method and pass criterion; verify requires external evidence whose producer is not the agent.',
    parameters: PARAMETERS,
    output: {
      schema: toToolSchema(OUTPUT_SCHEMA),
      render: (_args, value) => [{
        type: 'text',
        text: `firetree_hypothesis ${value.action}: ${value.change}; coverage=${value.coverage.toFixed(2)} (${value.verified}/${value.total} verified, ${value.untested} untested)`,
      }],
    },
    async execute(args, exec) {
      const parsed = validateArgs(args);
      const root = await rootFor(ctx, exec);
      let record = await readLedger(root, parsed.change);

      if (parsed.action === 'add') {
        const now = new Date().toISOString();
        const hypothesis = {
          id: nextId(record.value.hypotheses),
          statement: parsed.statement,
          kind: parsed.kind,
          detection: parsed.detection,
          status: 'untested',
          created_at: now,
          updated_at: now,
        };
        record.value.hypotheses.push(hypothesis);
        const artifact = await writeLedger(root, parsed.change, record.value);
        await appendEvent(root, {
          change: parsed.change, actor: 'agent', tool: 'firetree_hypothesis', action: 'add', result: 'ok',
          detail: { hypothesis: hypothesis.id, kind: hypothesis.kind },
        });
        const summary = summarize(true, record.value, parsed.change, artifact.sha256);
        return { ...summary, action: 'add' };
      }

      if (parsed.action === 'verify') {
        if (!record.exists) throw new HypothesisError('HYPOTHESES_NOT_FOUND', `no hypotheses ledger for ${parsed.change}`);
        const hypothesis = record.value.hypotheses.find((candidate) => candidate.id === parsed.id);
        if (!hypothesis) throw new HypothesisError('HYPOTHESIS_NOT_FOUND', `no hypothesis ${parsed.id}`);
        const evidence = await validateEvidence(root, parsed.evidence_ref);
        hypothesis.status = parsed.result;
        hypothesis.evidence_ref = evidence;
        hypothesis.updated_at = new Date().toISOString();
        const artifact = await writeLedger(root, parsed.change, record.value);
        await appendEvent(root, {
          change: parsed.change, actor: 'agent', tool: 'firetree_hypothesis', action: 'verify', result: 'ok',
          detail: { hypothesis: hypothesis.id, status: hypothesis.status },
        });
        const summary = summarize(true, record.value, parsed.change, artifact.sha256);
        return { ...summary, action: 'verify' };
      }

      if (parsed.action === 'accept') {
        if (!record.exists) throw new HypothesisError('HYPOTHESES_NOT_FOUND', `no hypotheses ledger for ${parsed.change}`);
        const hypothesis = record.value.hypotheses.find((candidate) => candidate.id === parsed.id);
        if (!hypothesis) throw new HypothesisError('HYPOTHESIS_NOT_FOUND', `no hypothesis ${parsed.id}`);
        if (hypothesis.status === 'verified') throw new HypothesisError('ALREADY_VERIFIED', `${parsed.id} is already verified`);
        record.value.accepted_risks ??= [];
        const now = Date.now();
        const existing = record.value.accepted_risks.find(
          (risk) => risk.hypothesis_id === parsed.id && Date.parse(risk.expires_at) > now,
        );
        if (existing !== undefined) throw new HypothesisError('RISK_ALREADY_ACCEPTED', `${parsed.id} already has an active risk acceptance`);
        record.value.accepted_risks.push({
          hypothesis_id: parsed.id,
          reason: parsed.reason,
          accepted_by: parsed.accepted_by,
          approval_ref: parsed.approval_ref,
          expires_at: parsed.expires_at,
        });
        const artifact = await writeLedger(root, parsed.change, record.value);
        await appendEvent(root, {
          change: parsed.change, actor: 'agent', tool: 'firetree_hypothesis', action: 'accept', result: 'ok',
          detail: { hypothesis: parsed.id, expires_at: parsed.expires_at },
        });
        const summary = summarize(true, record.value, parsed.change, artifact.sha256);
        return { ...summary, action: 'accept' };
      }

      return summarize(record.exists, record.value, parsed.change, record.sha256);
    },
  };
}
