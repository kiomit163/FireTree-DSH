/** firetree_assess: the change entry point. */

import { readFileSync } from 'node:fs';

import { ArtifactError, assertSafeId, sha256Text, writeFiretreeJson } from '../lib/artifacts.js';
import { loadCodeowners } from '../lib/codeowners.js';
import { normalizeRepoPath } from '../lib/glob.js';
import { analyzeImpact, ImpactError } from '../lib/impact.js';
import { loadRegistry } from '../lib/registry.js';
import { assertJsonSchemaValue } from '../lib/schema.js';
import { toToolSchema } from '../lib/tool-schema.js';

const ASSESSMENT_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/assessment.schema.json', import.meta.url), 'utf8'));
const TIER_ORDER = { L0: 0, L1: 1, L2: 2 };
const REQUIRED_ARTIFACTS = Object.freeze({
  L0: ['test_evidence', 'receipt', 'light_review'],
  L1: ['test_evidence', 'hypotheses', 'three_step_review', 'impact_traversal', 'receipt'],
  L2: ['test_evidence', 'hypotheses', 'synthesis', 'seven_step_review', 'correctness_case', 'human_signoff', 'impact_traversal', 'receipt'],
});
const ALLOWED_ARGS = new Set(['base', 'head', 'files', 'declared_tier', 'policy_path', 'change']);

/** Assessment input/rule failure. */
export class AssessError extends Error {
  /**
   * @param {string} code - Stable machine-readable code.
   * @param {string} message - Human-readable message.
   */
  constructor(code, message) {
    super(message);
    this.name = 'AssessError';
    this.code = code;
  }
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', ...ASSESSMENT_SCHEMA.required, 'artifact'],
  properties: {
    ok: { type: 'boolean', const: true },
    ...ASSESSMENT_SCHEMA.properties,
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
  required: ['base', 'head', 'files'],
  properties: {
    base: { type: 'string', description: 'Base commit or ref.' },
    head: { type: 'string', description: 'Head commit or ref.' },
    files: {
      type: 'array',
      items: { type: 'string' },
      description: 'Changed repo-relative paths from the change set.',
    },
    declared_tier: { type: 'string', enum: ['L0', 'L1', 'L2'] },
    policy_path: { type: 'string', description: 'Optional repo-relative policy path.' },
    change: { type: 'string', description: 'Optional safe change id.' },
  },
};

function isSafeRepoPath(path) {
  const normalized = normalizeRepoPath(path);
  return normalized.length > 0
    && !normalized.startsWith('/')
    && !/^[A-Za-z]:/.test(normalized)
    && !normalized.split('/').includes('..');
}

function validateArgs(args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new AssessError('INVALID_ARGS', 'arguments must be an object');
  for (const key of Object.keys(args)) {
    if (!ALLOWED_ARGS.has(key)) throw new AssessError('INVALID_ARGS', `unknown argument ${key}`);
  }
  for (const key of ['base', 'head']) {
    const value = args[key];
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200) {
      throw new AssessError('INVALID_ARGS', `${key} must be a non-empty string of at most 200 characters`);
    }
  }
  if (!Array.isArray(args.files) || args.files.length === 0) throw new AssessError('INVALID_ARGS', 'files must be a non-empty array');
  const paths = args.files.map((file) => {
    if (typeof file !== 'string' || !isSafeRepoPath(file)) throw new AssessError('INVALID_ARGS', 'files must be safe repo-relative paths');
    return normalizeRepoPath(file);
  });
  const uniquePaths = [...new Set(paths)].sort();
  if (args.declared_tier !== undefined && !Object.hasOwn(TIER_ORDER, args.declared_tier)) {
    throw new AssessError('INVALID_ARGS', 'declared_tier must be L0, L1, or L2');
  }
  if (args.policy_path !== undefined && (typeof args.policy_path !== 'string' || !isSafeRepoPath(args.policy_path))) {
    throw new AssessError('INVALID_ARGS', 'policy_path must be a safe repo-relative path');
  }
  const change = args.change === undefined
    ? `chg-${sha256Text(`${args.base}..${args.head}`).slice(0, 12)}`
    : assertSafeId(args.change, 'change');
  return {
    base: args.base,
    head: args.head,
    files: uniquePaths,
    declared_tier: args.declared_tier,
    policy_path: args.policy_path,
    change,
  };
}

function sampling(policy, tier, change, files) {
  const rate = policy.tiers[tier].sample_rate;
  const hash = sha256Text(`${change}\n${files.join('\n')}`);
  const fraction = Number.parseInt(hash.slice(0, 8), 16) / 0x100000000;
  return {
    tier,
    rate,
    selected: rate >= 1 || (rate > 0 && fraction < rate),
    method: 'sha256(change.id + files) / 2^32',
  };
}

async function rootFor(ctx, exec) {
  if (!exec.agent) throw new AssessError('AGENT_REQUIRED', 'firetree_assess requires an owning agent session');
  return ctx.workingDirectory.ensure(exec.agent, exec.signal);
}

/**
 * @param {object} ctx - Cordis context carrying workingDirectory.
 * @returns {object} DSH tool definition.
 */
export function createAssessTool(ctx) {
  return {
    name: 'firetree_assess',
    description: 'Assess a change: automatic risk tier, deterministic impact set, required artifacts, sampling decision, and sign-off. Unknown paths force L2 and low confidence.',
    parameters: PARAMETERS,
    output: {
      schema: toToolSchema(OUTPUT_SCHEMA),
      render: (_args, value) => [{
        type: 'text',
        text: `firetree_assess: ${value.tier} (auto ${value.auto_tier}); subsystems=${value.impact.subsystems.length}; interfaces=${value.impact.interfaces.length}; unknown=${value.impact.unknown.length}; signoff=${value.signoff_required}`,
      }],
    },
    async execute(args, exec) {
      const parsed = validateArgs(args);
      const root = await rootFor(ctx, exec);
      const policyPath = parsed.policy_path ?? '.firetree/policy.json';

      let registry;
      try {
        registry = await loadRegistry(root, { policyPath });
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'POLICY_MISSING') {
          throw new AssessError('POLICY_MISSING', `policy not found at ${policyPath}`);
        }
        throw error;
      }
      const codeowners = await loadCodeowners(root);

      let analysis;
      try {
        analysis = analyzeImpact({
          files: parsed.files,
          subsystems: registry.subsystems,
          interfaces: registry.interfaces,
          codeowners,
        });
      } catch (error) {
        if (error instanceof ImpactError) throw new AssessError(error.code, error.message);
        throw error;
      }

      const autoTier = analysis.auto_tier;
      if (parsed.declared_tier !== undefined && TIER_ORDER[parsed.declared_tier] < TIER_ORDER[autoTier]) {
        throw new AssessError('TIER_DOWNGRADE_REJECTED', `declared tier ${parsed.declared_tier} is lower than automatic tier ${autoTier}`);
      }
      const tier = parsed.declared_tier !== undefined && TIER_ORDER[parsed.declared_tier] > TIER_ORDER[autoTier]
        ? parsed.declared_tier
        : autoTier;
      const reasons = [...analysis.reasons];
      if (tier !== autoTier) reasons.push(`declared tier raised to ${tier}`);

      const created = new Date().toISOString();
      const assessment = {
        schema: 'firetree.assessment/v0',
        change: {
          id: parsed.change,
          base: parsed.base,
          head: parsed.head,
          files: parsed.files,
        },
        tier,
        auto_tier: autoTier,
        ...(parsed.declared_tier === undefined ? {} : { declared_tier: parsed.declared_tier }),
        reasons,
        impact: analysis.impact,
        confidence: analysis.confidence,
        required_artifacts: [...REQUIRED_ARTIFACTS[tier]],
        sampling: sampling(registry.policy, tier, parsed.change, parsed.files),
        signoff_required: registry.policy.tiers[tier].signoff,
        policy: {
          path: policyPath,
          version: registry.policy.version,
        },
        created_at: created,
      };
      assertJsonSchemaValue(assessment, ASSESSMENT_SCHEMA);

      const artifact = await writeFiretreeJson(root, `.firetree/changes/${parsed.change}/assessment.json`, assessment);
      const output = {
        ok: true,
        ...assessment,
        artifact: { path: artifact.path, sha256: artifact.sha256 },
      };
      assertJsonSchemaValue(output, OUTPUT_SCHEMA);
      return output;
    },
  };
}
