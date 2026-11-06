import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { checkDocs } from '../scripts/check-docs.mjs';

test('repository Markdown is UTF-8 and relative links resolve', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = checkDocs(root);
  assert.deepEqual(result.errors, []);
  assert.ok(result.files >= 15, `expected at least 15 Markdown files, got ${result.files}`);
  assert.ok(result.links >= 30, `expected at least 30 relative links, got ${result.links}`);
});
