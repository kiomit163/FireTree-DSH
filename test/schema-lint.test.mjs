import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { lintSchemas } from '../scripts/lint-schemas.mjs';

async function withSchemaDir(callback) {
  const root = await mkdtemp(join(tmpdir(), 'firetree-schema-lint-'));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('schema lint accepts the current contract subset', async () => {
  await withSchemaDir(async (root) => {
    await writeFile(join(root, 'ok.schema.json'), JSON.stringify({
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: { name: { type: 'string', minLength: 1 } },
    }), 'utf8');
    const result = lintSchemas(root);
    assert.deepEqual(result.errors, []);
  });
});

test('schema lint rejects keywords the runtime validator would ignore', async () => {
  await withSchemaDir(async (root) => {
    await writeFile(join(root, 'bad.schema.json'), JSON.stringify({
      type: 'object',
      patternProperties: { '^x-': { type: 'string' } },
    }), 'utf8');
    const result = lintSchemas(root);
    assert.ok(result.errors.some((error) => /patternProperties/.test(error)));
  });
});

test('schema lint rejects unresolved refs, unsupported formats, and bad required keys', async () => {
  await withSchemaDir(async (root) => {
    await writeFile(join(root, 'bad.schema.json'), JSON.stringify({
      type: 'object',
      additionalProperties: false,
      required: ['missing'],
      properties: {
        at: { type: 'string', format: 'uri' },
        ref: { $ref: '#/$defs/nope' },
      },
    }), 'utf8');
    const result = lintSchemas(root);
    assert.ok(result.errors.some((error) => /required property "missing"/.test(error)));
    assert.ok(result.errors.some((error) => /unsupported format/.test(error)));
    assert.ok(result.errors.some((error) => /unresolved JSON pointer/.test(error)));
  });
});
