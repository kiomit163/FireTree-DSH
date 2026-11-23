import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  changedFiles,
  findingsCiteChangedFile,
  parseJsonContent,
} from '../scripts/trusted-ai-review.mjs';

test('changedFiles extracts only b-side paths', () => {
  const files = changedFiles([
    'diff --git a/src/a.js b/src/a.js',
    '+++ b/src/a.js',
    '+++ /dev/null',
    '+++ b/test/a.test.mjs',
  ].join('\n'));
  assert.deepEqual([...files].sort(), ['src/a.js', 'test/a.test.mjs']);
});

test('findingsCiteChangedFile requires a changed file and line', () => {
  const findings = [
    { id: 'line', severity: 'blocker', claim: 'x', evidence: 'src/a.js:12 boom', status: 'open' },
    { id: 'file-only', severity: 'blocker', claim: 'x', evidence: 'src/a.js boom', status: 'open' },
    { id: 'other-file', severity: 'blocker', claim: 'x', evidence: 'src/b.js:12 boom', status: 'open' },
  ];
  const kept = findingsCiteChangedFile(findings, new Set(['src/a.js']));
  assert.deepEqual(kept.map((finding) => finding.id), ['line']);
});

test('parseJsonContent accepts fenced JSON and forces open findings to not-ready', () => {
  const parsed = parseJsonContent('```json\n{"verdict":"ready","findings":[{"id":"f1","severity":"blocker","claim":"x","evidence":"src/a.js:1 x","status":"open"}]}\n```');
  assert.equal(parsed.verdict, 'not-ready');
  assert.equal(parsed.findings.length, 1);
});

test('parseJsonContent rejects malformed JSON and invalid verdicts', () => {
  assert.throws(() => parseJsonContent('not json'), /no JSON object/u);
  assert.throws(() => parseJsonContent('{"verdict":"maybe","findings":[]}'), /verdict/u);
  assert.throws(() => parseJsonContent('{"verdict":"ready","findings":{}}'), /findings/u);
});
