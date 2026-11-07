/** FireTree-DSH bundle entry: tools, short prompt section, and six skills. */

import { SKILLS } from './src/skills.js';
import { createAssessTool } from './src/tools/assess.js';
import { createClassifyTool } from './src/tools/classify.js';
import { createStubTools } from './src/tools/stub.js';
import { stateTool } from './src/tools/state.js';

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
    '- M1: firetree_state, firetree_classify, and firetree_assess are live; the other firetree tools return NOT_IMPLEMENTED.',
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
  for (const tool of [stateTool, createClassifyTool(ctx), createAssessTool(ctx), ...createStubTools()]) {
    ctx.tools.register(tool);
  }

  ctx.systemPrompt.section(PROMPT_SECTION);

  for (const skill of SKILLS) {
    ctx.skills.register(skill);
  }
}
