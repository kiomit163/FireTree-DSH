/** M1 stub tools: registered and callable, but deliberately without business logic. */

import { assertJsonValue } from '../lib/json.js';

/** Names of the four stubs that remain before their implementations exist in M1. */
export const STUB_TOOL_NAMES = Object.freeze([
  'firetree_hypothesis',
  'firetree_synthesize',
  'firetree_review',
  'firetree_receipt',
]);

const STUB_SPECS = Object.freeze([
  {
    name: 'firetree_hypothesis',
    description: 'Add, verify, and list design hypotheses with external detection evidence. M1 stub: not implemented.',
  },
  {
    name: 'firetree_synthesize',
    description: 'Plan and record an independent-seat synthesis round for an L2 decision. M1 stub: not implemented.',
  },
  {
    name: 'firetree_review',
    description: 'Open a review, record rounds, and issue a verdict for the change. M1 stub: not implemented.',
  },
  {
    name: 'firetree_receipt',
    description: 'Build or check the delivery receipt against external evidence and sign-off. M1 stub: not implemented.',
  },
]);

const OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'schema', 'code', 'tool', 'message'],
  properties: {
    ok: { type: 'boolean', const: false },
    schema: { type: 'string', const: 'firetree.not-implemented/v0' },
    code: { type: 'string', const: 'NOT_IMPLEMENTED' },
    tool: { type: 'string' },
    message: { type: 'string' },
  },
});

/**
 * Build one callable M0 stub definition.
 *
 * @param {{name: string, description: string}} spec - Stable tool metadata.
 * @returns {object} DSH tool definition.
 */
function createStubTool(spec) {
  const value = Object.freeze({
    ok: false,
    schema: 'firetree.not-implemented/v0',
    code: 'NOT_IMPLEMENTED',
    tool: spec.name,
    message: `${spec.name} is registered for M1 but has no business logic yet.`,
  });

  return {
    name: spec.name,
    description: spec.description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: () => [{ type: 'text', text: `${spec.name}: NOT_IMPLEMENTED (M0 skeleton)` }],
    },
    execute() {
      assertJsonValue(value);
      return value;
    },
  };
}

/**
 * @returns {object[]} The six M0 stub definitions in stable order.
 */
export function createStubTools() {
  return STUB_SPECS.map(createStubTool);
}
