/** firetree_classify: subsystem/program object identification and OID dossier. */

import { readFileSync } from 'node:fs';

import { ArtifactError, assertSafeId, readFiretreeJson, writeFiretreeJson } from '../lib/artifacts.js';
import { assertJsonSchemaValue } from '../lib/schema.js';
import { toToolSchema } from '../lib/tool-schema.js';

const DOSSIER_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/dossier.schema.json', import.meta.url), 'utf8'));
const ALLOWED_ARGS = new Set([
  'action',
  'subsystem',
  'kind',
  'layers_known',
  'layers_unknown',
  'coupling_evidence',
  'reducibility_test',
  'method',
  'owner_of_unknowns',
  'learning_plan',
]);
const KINDS = new Set(['simple', 'large', 'simple-giant', 'open-complex-giant', 'unknown']);
const METHODS = new Set(['decompose', 'metasynthesis']);
const RESULTS = new Set(['reducible', 'not-reducible', 'unknown']);

/** Classification input/rule failure. */
export class ClassifyError extends Error {
  /**
   * @param {string} code - Stable machine-readable code.
   * @param {string} message - Human-readable message.
   */
  constructor(code, message) {
    super(message);
    this.name = 'ClassifyError';
    this.code = code;
  }
}

const DOSSIER_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'subsystem', 'kind', 'layers_known', 'layers_unknown', 'coupling_evidence', 'reducibility_test', 'method', 'owner_of_unknowns', 'learning_plan', 'allowed', 'updated_at'],
  properties: {
    schema: { type: 'string', const: 'firetree.oid/v0' },
    subsystem: { type: 'string' },
    kind: { type: 'string', enum: [...KINDS] },
    layers_known: { type: 'array', items: { type: 'string' } },
    layers_unknown: { type: 'array', items: { type: 'string' } },
    coupling_evidence: { type: 'array', items: { type: 'string' } },
    reducibility_test: {
      type: 'object',
      additionalProperties: false,
      required: ['command', 'result'],
      properties: {
        command: { type: 'string' },
        result: { type: 'string', enum: [...RESULTS] },
      },
    },
    method: { type: 'string', enum: [...METHODS] },
    owner_of_unknowns: { type: 'array', items: { type: 'string' } },
    learning_plan: { type: 'array', items: { type: 'string' } },
    allowed: {
      type: 'object',
      additionalProperties: false,
      required: ['decomposition_autonomy', 'requires_human_signoff', 'constraints'],
      properties: {
        decomposition_autonomy: { type: 'boolean' },
        requires_human_signoff: { type: 'boolean' },
        constraints: { type: 'array', items: { type: 'string' } },
      },
    },
    updated_at: { type: 'string' },
  },
};

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'schema', 'action', 'subsystem', 'dossier', 'allowed', 'artifact'],
  properties: {
    ok: { type: 'boolean', const: true },
    schema: { type: 'string', const: 'firetree.classify/v0' },
    action: { type: 'string', enum: ['set', 'show'] },
    subsystem: { type: 'string' },
    dossier: DOSSIER_OUTPUT,
    allowed: DOSSIER_OUTPUT.properties.allowed,
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
  required: ['action', 'subsystem'],
  properties: {
    action: { type: 'string', enum: ['set', 'show'] },
    subsystem: { type: 'string', description: 'Subsystem or program id.' },
    kind: { type: 'string', enum: [...KINDS] },
    layers_known: { type: 'array', items: { type: 'string' } },
    layers_unknown: { type: 'array', items: { type: 'string' } },
    coupling_evidence: { type: 'array', items: { type: 'string' } },
    reducibility_test: {
      type: 'object',
      additionalProperties: false,
      required: ['command', 'result'],
      properties: {
        command: { type: 'string' },
        result: { type: 'string', enum: [...RESULTS] },
      },
    },
    method: { type: 'string', enum: [...METHODS] },
    owner_of_unknowns: { type: 'array', items: { type: 'string' } },
    learning_plan: { type: 'array', items: { type: 'string' } },
  },
};

function assertObject(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ClassifyError('INVALID_ARGS', `${label} must be an object`);
}

function assertStringArray(value, label, { required = true } = {}) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new ClassifyError('INVALID_ARGS', `${label} must be an array of non-empty strings`);
  }
  return [...value];
}

function normalizeSetArgs(args) {
  const subsystem = assertSafeId(args.subsystem, 'subsystem');
  const kind = args.kind;
  if (!KINDS.has(kind)) throw new ClassifyError('INVALID_ARGS', `kind must be one of ${[...KINDS].join('|')}`);
  const method = args.method;
  if (!METHODS.has(method)) throw new ClassifyError('INVALID_ARGS', `method must be one of ${[...METHODS].join('|')}`);

  const test = args.reducibility_test;
  if (typeof test !== 'object' || test === null || Array.isArray(test)) {
    throw new ClassifyError('INVALID_ARGS', 'reducibility_test must be an object');
  }
  if (typeof test.command !== 'string' || test.command.trim().length === 0) {
    throw new ClassifyError('INVALID_ARGS', 'reducibility_test.command must be a non-empty string');
  }
  if (!RESULTS.has(test.result)) {
    throw new ClassifyError('INVALID_ARGS', `reducibility_test.result must be one of ${[...RESULTS].join('|')}`);
  }

  const layersKnown = assertStringArray(args.layers_known, 'layers_known');
  const layersUnknown = assertStringArray(args.layers_unknown, 'layers_unknown');
  const coupling = assertStringArray(args.coupling_evidence, 'coupling_evidence');
  const owners = assertStringArray(args.owner_of_unknowns, 'owner_of_unknowns');
  const plan = assertStringArray(args.learning_plan, 'learning_plan');

  if (layersUnknown.length > 0 && test.result === 'reducible') {
    throw new ClassifyError('REDUCIBILITY_CLAIM_REJECTED', 'cannot declare reducible while layers_unknown is non-empty');
  }
  if (method === 'metasynthesis' && owners.length === 0) {
    throw new ClassifyError('OWNER_REQUIRED', 'metasynthesis requires at least one owner_of_unknowns');
  }
  if (kind === 'unknown' && plan.length === 0) {
    throw new ClassifyError('LEARNING_PLAN_REQUIRED', 'kind=unknown requires a learning_plan');
  }
  if ((kind === 'open-complex-giant' || kind === 'unknown') && method === 'decompose') {
    throw new ClassifyError('OCG_DECOMPOSITION_REJECTED', 'open-complex-giant/unknown cannot use decompose as the delivery method');
  }
  if ((layersUnknown.length > 0 || kind === 'open-complex-giant' || kind === 'unknown') && owners.length === 0) {
    throw new ClassifyError('OWNER_REQUIRED', 'unknown layers require at least one owner_of_unknowns');
  }

  const constraints = [];
  const decompositionAutonomy = method === 'decompose'
    && kind !== 'open-complex-giant'
    && kind !== 'unknown'
    && layersUnknown.length === 0;
  const requiresHumanSignoff = kind === 'open-complex-giant' || kind === 'unknown';
  if (!decompositionAutonomy) constraints.push('no decomposition autonomy');
  if (requiresHumanSignoff) constraints.push('human sign-off required');
  if (layersUnknown.length > 0) constraints.push('unknown layers must be owned before a reducibility claim');
  if (method === 'metasynthesis') constraints.push('metasynthesis path requires an owner for unknowns');
  if (test.result !== 'reducible') constraints.push('reducibility is not established');

  return {
    subsystem,
    kind,
    layers_known: layersKnown,
    layers_unknown: layersUnknown,
    coupling_evidence: coupling,
    reducibility_test: { command: test.command, result: test.result },
    method,
    owner_of_unknowns: owners,
    learning_plan: plan,
    allowed: {
      decomposition_autonomy: decompositionAutonomy,
      requires_human_signoff: requiresHumanSignoff,
      constraints,
    },
  };
}

function validateArgs(args) {
  assertObject(args, 'arguments');
  for (const key of Object.keys(args)) {
    if (!ALLOWED_ARGS.has(key)) throw new ClassifyError('INVALID_ARGS', `unknown argument ${key}`);
  }
  if (args.action !== 'set' && args.action !== 'show') throw new ClassifyError('INVALID_ARGS', 'action must be set or show');
  const subsystem = assertSafeId(args.subsystem, 'subsystem');
  if (args.action === 'show') {
    for (const key of Object.keys(args)) {
      if (key !== 'action' && key !== 'subsystem') throw new ClassifyError('INVALID_ARGS', `show does not accept ${key}`);
    }
    return { action: 'show', subsystem };
  }
  return { action: 'set', ...normalizeSetArgs(args) };
}

async function rootFor(ctx, exec) {
  if (!exec.agent) throw new ClassifyError('AGENT_REQUIRED', 'firetree_classify requires an owning agent session');
  return ctx.workingDirectory.ensure(exec.agent, exec.signal);
}

/**
 * @param {object} ctx - Cordis context carrying workingDirectory.
 * @returns {object} DSH tool definition.
 */
export function createClassifyTool(ctx) {
  return {
    name: 'firetree_classify',
    description: 'Object-identification dossier for a subsystem or program: set/show known and unknown layers, reducibility test, method, owners, and allowed delivery autonomy.',
    parameters: PARAMETERS,
    output: {
      schema: toToolSchema(OUTPUT_SCHEMA),
      render: (_args, value) => [{
        type: 'text',
        text: `firetree_classify ${value.action}: ${value.subsystem} (${value.dossier.kind}); decomposition_autonomy=${String(value.allowed.decomposition_autonomy)}; human_signoff=${String(value.allowed.requires_human_signoff)}`,
      }],
    },
    async execute(args, exec) {
      const parsed = validateArgs(args);
      const root = await rootFor(ctx, exec);
      const relativePath = `.firetree/oid/${parsed.subsystem}.json`;

      if (parsed.action === 'show') {
        let record;
        try {
          record = await readFiretreeJson(root, relativePath, { verifyHash: true });
        } catch (error) {
          if (error instanceof ArtifactError && error.code === 'READ_FAILED' && error.cause?.code === 'ENOENT') {
            throw new ClassifyError('DOSSIER_NOT_FOUND', `no dossier for ${parsed.subsystem}`);
          }
          throw error;
        }
        if (record === null) throw new ClassifyError('DOSSIER_NOT_FOUND', `no dossier for ${parsed.subsystem}`);
        const dossier = record.value;
        assertJsonSchemaValue(dossier, DOSSIER_SCHEMA);
        return {
          ok: true,
          schema: 'firetree.classify/v0',
          action: 'show',
          subsystem: parsed.subsystem,
          dossier,
          allowed: dossier.allowed,
          artifact: { path: relativePath, sha256: record.sha256 ?? '' },
        };
      }

      const dossier = {
        schema: 'firetree.oid/v0',
        subsystem: parsed.subsystem,
        kind: parsed.kind,
        layers_known: parsed.layers_known,
        layers_unknown: parsed.layers_unknown,
        coupling_evidence: parsed.coupling_evidence,
        reducibility_test: parsed.reducibility_test,
        method: parsed.method,
        owner_of_unknowns: parsed.owner_of_unknowns,
        learning_plan: parsed.learning_plan,
        allowed: parsed.allowed,
        updated_at: new Date().toISOString(),
      };
      assertJsonSchemaValue(dossier, DOSSIER_SCHEMA);
      const artifact = await writeFiretreeJson(root, relativePath, dossier);
      return {
        ok: true,
        schema: 'firetree.classify/v0',
        action: 'set',
        subsystem: parsed.subsystem,
        dossier,
        allowed: parsed.allowed,
        artifact: { path: artifact.path, sha256: artifact.sha256 },
      };
    },
  };
}
