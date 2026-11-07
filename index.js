/** FireTree-DSH bundle entry: tools, short prompt section, and six skills. */

import { SKILLS } from './src/skills.js';
import { createAssessTool } from './src/tools/assess.js';
import { createClassifyTool } from './src/tools/classify.js';
import { createHypothesisTool } from './src/tools/hypothesis.js';
import { createReceiptTool } from './src/tools/receipt.js';
import { createReviewTool } from './src/tools/review.js';
import { createStateTool } from './src/tools/state.js';
import { createSynthesizeTool } from './src/tools/synthesize.js';

/** Cordis plugin name. */
export const name = 'firetree-dsh';

/** Host services required by this bundle. */
export const inject = ['tools', 'systemPrompt', 'skills', 'workingDirectory'];

/** Short routing section; full rules stay in the on-demand skills. */
export const PROMPT_SECTION = {
  name: 'firetree:delivery-protocol',
  order: 700,
  text: [
    '<firetree_protocol>',
    'FireTree-DSH is an auditable delivery protocol; a receipt is required before claiming completion.',
    '- Change entry is firetree_assess; the exit is firetree_receipt. No receipt means no completion claim.',
    '- Tiers are L0/L1/L2; unknown impact is always L2.',
    '- Evidence must come from CI or deterministic tools; never self-generate evidence.',
    '- Only humans sign; agent self-sign count is always zero.',
    '- L2 claims each need an invariant and evidence; an unaccepted residual blocks.',
    '- Use firetree_state for current state; load the FireTree skills for full rules.',
    '- M2: all seven FireTree tools are live; use review/synthesize for L2 and receipt before claiming completion.',
    '</firetree_protocol>',
  ].join('\n'),
};

/**
 * Register the FireTree bundle resources.
 *
 * @param {object} ctx - Cordis context carrying tools, systemPrompt, and skills.
 * @returns {void}
 */
export function apply(ctx) {
  for (const tool of [createStateTool(ctx), createClassifyTool(ctx), createAssessTool(ctx), createHypothesisTool(ctx), createReceiptTool(ctx), createReviewTool(ctx), createSynthesizeTool(ctx)]) {
    ctx.tools.register(tool);
  }

  ctx.systemPrompt.section(PROMPT_SECTION);

  for (const skill of SKILLS) {
    ctx.skills.register(skill);
  }
}
