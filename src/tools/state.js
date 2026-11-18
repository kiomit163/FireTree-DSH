/** Read-only FireTree state projection from .firetree artifacts. */

import { ArtifactError, assertSafeId, firetreePath, listJsonFiles, readFiretreeJson, readJsonFile, resolveWithin } from '../lib/artifacts.js';
import { toToolSchema } from '../lib/tool-schema.js';

const ALLOWED_ARGUMENTS = new Set(['change', 'subsystem']);
const KIND = ['dossier', 'subsystem', 'assessment', 'hypotheses', 'review', 'receipt', 'synthesis_plan', 'synthesis_round', 'technical_evidence'];

const OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'schema', 'generated_at', 'mode', 'counts', 'entries', 'next_actions'],
  properties: {
    ok: { type: 'boolean', const: true },
    schema: { type: 'string', const: 'firetree.state/v1' },
    generated_at: { type: 'string' },
    mode: { type: 'string', enum: ['empty', 'change', 'subsystem'] },
    counts: {
      type: 'object',
      additionalProperties: false,
      required: ['pending', 'expiring', 'blocked'],
      properties: {
        pending: { type: 'integer' },
        expiring: { type: 'integer' },
        blocked: { type: 'integer' },
      },
    },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'id', 'status', 'path'],
        properties: {
          kind: { type: 'string', enum: KIND },
          id: { type: 'string' },
          status: { type: 'string', enum: ['present', 'missing'] },
          path: { type: 'string' },
          updated_at: { type: 'string' },
          expires_at: { type: 'string' },
        },
      },
    },
    next_actions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
});

function validateArgs(args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new TypeError('firetree_state arguments must be an object');
  }
  for (const key of Object.keys(args)) {
    if (!ALLOWED_ARGUMENTS.has(key)) throw new TypeError(`firetree_state does not accept "${key}"`);
  }
  for (const key of ALLOWED_ARGUMENTS) {
    const value = args[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new TypeError(`firetree_state "${key}" must be a non-empty string`);
    }
    assertSafeId(value, key);
  }
  if (args.change !== undefined && args.subsystem !== undefined) {
    throw new TypeError('firetree_state accepts change or subsystem, not both');
  }
  return args;
}

function entry(kind, id, status, path, updatedAt, expiresAt) {
  return {
    kind,
    id,
    status,
    path,
    ...(updatedAt === undefined ? {} : { updated_at: updatedAt }),
    ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
  };
}

function expiryCounts(values) {
  const now = Date.now();
  const active = values.filter((value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)));
  return {
    expiring: active.some((value) => {
      const diff = Date.parse(value) - now;
      return diff > 0 && diff <= 7 * 24 * 60 * 60 * 1000;
    }) ? 1 : 0,
    blocked: active.some((value) => Date.parse(value) <= now) ? 1 : 0,
  };
}

async function optionalHashed(root, relativePath) {
  try {
    const record = await readFiretreeJson(root, relativePath, { verifyHash: true, missing: 'null' });
    return record === null ? null : record.value;
  } catch (error) {
    if (error instanceof ArtifactError && error.code === 'READ_FAILED' && error.cause?.code === 'ENOENT') return null;
    throw error;
  }
}

async function optionalJson(root, relativePath) {
  try {
    return await readJsonFile(resolveWithin(root, relativePath), 'null');
  } catch (error) {
    if (error instanceof ArtifactError && error.code === 'READ_FAILED' && error.cause?.code === 'ENOENT') return null;
    throw error;
  }
}

async function subsystemEntries(root, subsystem) {
  const id = assertSafeId(subsystem, 'subsystem');
  const dossierPath = `.firetree/oid/${id}.json`;
  const registryPath = `.firetree/subsystems/${id}.json`;
  const [dossier, registry] = await Promise.all([
    optionalHashed(root, dossierPath),
    optionalJson(root, registryPath),
  ]);
  const entries = [
    entry('dossier', id, dossier === null ? 'missing' : 'present', dossierPath, dossier?.updated_at),
    entry('subsystem', id, registry === null ? 'missing' : 'present', registryPath, registry?.dossier?.updated_at),
  ];
  const nextActions = [];
  if (dossier === null) nextActions.push(`Run firetree_classify set for ${id}.`);
  if (registry === null) nextActions.push(`Add .firetree/subsystems/${id}.json registry entry.`);
  return { entries, nextActions, expiring: 0, blocked: 0 };
}

async function changeEntries(root, change) {
  const id = assertSafeId(change, 'change');
  const base = `.firetree/changes/${id}`;
  const assessment = await optionalHashed(root, `${base}/assessment.json`);
  const hypotheses = await optionalJson(root, `${base}/hypotheses.json`);
  const review = await optionalJson(root, `${base}/verdict.json`);
  let receiptPath = `.firetree/receipts/${id}.json`;
  let receipt = await optionalJson(root, receiptPath);
  if (receipt === null) {
    receiptPath = `${base}/receipt.json`;
    receipt = await optionalJson(root, receiptPath);
  }
  const technicalEvidencePath = `.firetree/evidence/${id}.json`;
  const technicalEvidence = await optionalHashed(root, technicalEvidencePath);
  const autonomous = technicalEvidence !== null;

  const synthesisPlanPath = `${base}/synthesis/plan.json`;
  const synthesisPlan = await optionalHashed(root, synthesisPlanPath);
  const synthesisRounds = [];
  if (synthesisPlan !== null) {
    const files = await listJsonFiles(firetreePath(root, 'changes', id, 'synthesis'));
    for (const file of files) {
      const match = /\/round-(\d+)\.json$/.exec(file.replaceAll('\\', '/'));
      if (!match) continue;
      const path = `${base}/synthesis/round-${match[1]}.json`;
      const record = await readFiretreeJson(root, path, { verifyHash: true, missing: 'null' });
      if (record !== null) synthesisRounds.push({ round: Number(match[1]), path, createdAt: record.value.created_at });
    }
    synthesisRounds.sort((left, right) => left.round - right.round);
  }

  const tier = assessment?.tier;
  const sampledL0 = tier === 'L0' && assessment?.sampling?.selected === true;
  const needsHypotheses = tier !== 'L0';
  const needsReview = tier !== 'L0' || sampledL0;

  const entries = [
    entry('assessment', id, assessment === null ? 'missing' : 'present', `${base}/assessment.json`, assessment?.created_at),
  ];
  const nextActions = [];
  if (needsHypotheses && (hypotheses !== null || !autonomous)) {
    entries.push(entry('hypotheses', id, hypotheses === null ? 'missing' : 'present', `${base}/hypotheses.json`));
  }
  if (needsReview && (review !== null || !autonomous)) {
    entries.push(entry('review', id, review === null ? 'missing' : 'present', `${base}/verdict.json`));
  }
  if (receipt !== null || !autonomous) {
    entries.push(entry('receipt', id, receipt === null ? 'missing' : 'present', receiptPath, undefined, receipt?.expires_at));
  }
  if (assessment === null) nextActions.push(`Run firetree_assess for ${id}.`);
  if (needsHypotheses && !autonomous && hypotheses === null) nextActions.push(`Record hypotheses for ${id} before receipt.`);
  if (needsReview && !autonomous && review === null) nextActions.push(`Open a review for ${id}.`);
  if (!autonomous && receipt === null) nextActions.push(`Build the delivery receipt for ${id}.`);

  // Synthesis is advisory in v0.1: show it when it exists, never count it as pending.
  if (synthesisPlan !== null) {
    entries.push(entry('synthesis_plan', id, 'present', synthesisPlanPath, synthesisPlan.created_at));
    for (const round of synthesisRounds) {
      entries.push(entry('synthesis_round', `${id}:round-${round.round}`, 'present', round.path, round.createdAt));
    }
  }

  if (technicalEvidence !== null) {
    entries.push(entry('technical_evidence', id, 'present', technicalEvidencePath, technicalEvidence.created_at, technicalEvidence.expires_at));
  }

  return { entries, nextActions, ...expiryCounts([receipt?.expires_at, technicalEvidence?.expires_at]) };
}

async function rootFor(ctx, exec) {
  if (!exec.agent) throw new TypeError('firetree_state requires an owning agent session');
  return ctx.workingDirectory.ensure(exec.agent, exec.signal);
}

/**
 * @param {object} ctx - Cordis context carrying workingDirectory.
 * @returns {object} DSH tool definition.
 */
export function createStateTool(ctx) {
  return {
    name: 'firetree_state',
    description: 'Read the current FireTree subsystem or change state from .firetree artifacts, including missing next artifacts and expiry/blocked counts.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        change: { type: 'string', description: 'Optional change id to inspect.' },
        subsystem: { type: 'string', description: 'Optional subsystem id to inspect.' },
      },
    },
    output: {
      schema: toToolSchema(OUTPUT_SCHEMA),
      render: (_args, value) => [{
        type: 'text',
        text: `FireTree state (${value.mode}): ${value.counts.pending} pending, ${value.counts.expiring} expiring, ${value.counts.blocked} blocked.`,
      }],
    },
    async execute(args, exec) {
      const query = validateArgs(args);
      const root = await rootFor(ctx, exec);
      let entries = [];
      let nextActions = [];
      let expiring = 0;
      let blocked = 0;
      let mode = 'empty';

      if (query.change !== undefined) {
        mode = 'change';
        ({ entries, nextActions, expiring, blocked } = await changeEntries(root, query.change));
      } else if (query.subsystem !== undefined) {
        mode = 'subsystem';
        ({ entries, nextActions, expiring, blocked } = await subsystemEntries(root, query.subsystem));
      } else {
        nextActions = ['Run firetree_assess at the change entry point (M1).'];
      }

      const value = {
        ok: true,
        schema: 'firetree.state/v1',
        generated_at: new Date().toISOString(),
        mode,
        counts: {
          pending: entries.filter((item) => item.status === 'missing').length,
          expiring,
          blocked,
        },
        entries,
        next_actions: nextActions,
      };
      return value;
    },
  };
}
