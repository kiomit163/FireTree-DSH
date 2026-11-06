import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateJsonSchema } from '../src/lib/schema.js';

test('reports paths for type, required, and nested properties', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'count'],
    properties: {
      name: { type: 'string' },
      count: { type: 'integer', minimum: 1 },
      nested: {
        type: 'object',
        additionalProperties: false,
        properties: { flag: { type: 'boolean' } },
      },
    },
  };

  const errors = validateJsonSchema({ name: 3, count: 0, nested: { flag: 'yes' } }, schema);
  assert.ok(errors.some((error) => error.path === '$.name' && error.keyword === 'type'));
  assert.ok(errors.some((error) => error.path === '$.count' && error.keyword === 'minimum'));
  assert.ok(errors.some((error) => error.path === '$.nested.flag' && error.keyword === 'type'));
});

test('resolves local refs and applies oneOf exactly once', () => {
  const schema = {
    $defs: {
      text: { type: 'string', minLength: 1 },
    },
    oneOf: [
      { $ref: '#/$defs/text' },
      { type: 'integer' },
    ],
  };

  assert.deepEqual(validateJsonSchema('hello', schema), []);
  assert.deepEqual(validateJsonSchema(3, schema), []);
  assert.ok(validateJsonSchema('', schema).length > 0);
  assert.ok(validateJsonSchema(3.5, schema).length > 0);
});

test('applies if/then and additionalProperties', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      tier: { type: 'string' },
      evidence: { type: 'array', minItems: 1 },
    },
    if: {
      properties: { tier: { const: 'L2' } },
      required: ['tier'],
    },
    then: {
      required: ['evidence'],
      properties: { evidence: { minItems: 2 } },
    },
  };

  assert.deepEqual(validateJsonSchema({ tier: 'L1' }, schema), []);
  assert.ok(validateJsonSchema({ tier: 'L2' }, schema).some((error) => error.keyword === 'required'));
  assert.ok(validateJsonSchema({ tier: 'L2', evidence: ['a'] }, schema).some((error) => error.keyword === 'minItems'));
  assert.ok(validateJsonSchema({ tier: 'L1', extra: true }, schema).some((error) => error.keyword === 'additionalProperties'));
});

test('checks date-time format and patterns', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      at: { type: 'string', format: 'date-time' },
      sha: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    },
  };

  assert.deepEqual(validateJsonSchema({ at: '2026-11-06T00:00:00Z', sha: 'a'.repeat(64) }, schema), []);
  assert.ok(validateJsonSchema({ at: 'not-a-date' }, schema).some((error) => error.keyword === 'format'));
  assert.ok(validateJsonSchema({ sha: 'short' }, schema).some((error) => error.keyword === 'pattern'));
});
