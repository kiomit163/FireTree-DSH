import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { toToolSchema, unsupportedToolSchemaPaths } from '../src/lib/tool-schema.js';

const assessment = JSON.parse(readFileSync(new URL('../schemas/assessment.schema.json', import.meta.url), 'utf8'));

test('tool schema projection removes Host-unsupported keywords', () => {
  const projected = toToolSchema(assessment);
  assert.deepEqual(unsupportedToolSchemaPaths(projected), []);
  assert.equal(projected.properties.change.properties.id.pattern, undefined);
  assert.equal(projected.properties.change.properties.files.minItems, undefined);
  assert.equal(projected.properties.created_at.format, undefined);
  assert.equal(projected.properties.sampling.properties.rate.minimum, undefined);
});

test('tool schema projection gives const nodes a type', () => {
  const projected = toToolSchema(assessment);
  assert.equal(projected.properties.schema.type, 'string');
  assert.equal(projected.properties.schema.const, 'firetree.assessment/v0');
  assert.equal(projected.required.includes('tier'), true);
  assert.equal(projected.additionalProperties, false);
});

test('projection does not mutate the internal schema', () => {
  const original = JSON.stringify(assessment);
  toToolSchema(assessment);
  assert.equal(JSON.stringify(assessment), original);
});
