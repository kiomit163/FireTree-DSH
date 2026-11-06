/** Read-only FireTree state tool. M0 returns an explicit empty state. */

import { assertJsonValue } from '../lib/json.js';

const ALLOWED_ARGUMENTS = new Set(['change', 'subsystem']);

const OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'schema', 'generated_at', 'mode', 'counts', 'entries', 'next_actions'],
  properties: {
    ok: { type: 'boolean', const: true },
    schema: { type: 'string', const: 'firetree.state/v0' },
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
      items: { type: 'object', additionalProperties: false, properties: {} },
    },
    next_actions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
});

/**
 * Validate the optional selectors without accepting undeclared fields.
 *
 * @param {unknown} args - Raw tool arguments.
 * @returns {{change?: string, subsystem?: string}} Validated arguments.
 */
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
  }

  return args;
}

/** Registered read-only state definition. */
export const stateTool = {
  name: 'firetree_state',
  description: 'Read the current FireTree program, subsystem, change, receipt, and expiry state. M0 returns an explicit empty state.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      change: { type: 'string', description: 'Optional change id to inspect.' },
      subsystem: { type: 'string', description: 'Optional subsystem id to inspect.' },
    },
  },
  output: {
    schema: OUTPUT_SCHEMA,
    render: (_args, value) => [{
      type: 'text',
      text: `FireTree state (${value.mode}): ${value.counts.pending} pending, ${value.counts.expiring} expiring, ${value.counts.blocked} blocked.`,
    }],
  },
  execute(args) {
    const query = validateArgs(args);
    const value = {
      ok: true,
      schema: 'firetree.state/v0',
      generated_at: new Date().toISOString(),
      mode: query.change !== undefined ? 'change' : query.subsystem !== undefined ? 'subsystem' : 'empty',
      counts: { pending: 0, expiring: 0, blocked: 0 },
      entries: [],
      next_actions: [
        'Run firetree_assess at the change entry point (M1).',
        'No .firetree state exists yet; M0 exposes the empty projection only.',
      ],
    };
    assertJsonValue(value);
    return value;
  },
};
