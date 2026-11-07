/** M1 stub tools: registered and callable, but deliberately without business logic. */

import { assertJsonValue } from '../lib/json.js';

/** Names of the one stub that remains before its implementation exists. */
export const STUB_TOOL_NAMES = Object.freeze([
  'firetree_synthesize',
]);

const STUB_SPECS = Object.freeze([
  {
    name: 'firetree_synthesize',
    description: 'Plan and record an independent-seat synthesis round for an L2 decision. M2 stub: not implemented.',
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
 * Build one callable M2 stub definition.
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
    message: `${spec.name} is registered for M2 but has no business logic yet.`,
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
      render: () => [{ type: 'text', text: `${spec.name}: NOT_IMPLEMENTED (M2 skeleton)` }],
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
