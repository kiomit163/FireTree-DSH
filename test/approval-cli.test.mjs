import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { createAssessTool } from '../src/tools/assess.js';
import { createM1Workspace } from '../test-support/m1-workspace.mjs';

const run = promisify(execFile);
const EXEC = { agent: { id: 'agent-1' }, signal: new AbortController().signal };

test('firetree-approval binds the assessment digest and fails without it', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createAssessTool({ workingDirectory: { async ensure() { return workspace.root; } } });
    const assessment = await tool.execute({
      base: '1111111111111111111111111111111111111111',
      head: '2222222222222222222222222222222222222222',
      files: ['services/billing/charge.mjs'],
      change: 'chg-approval',
    }, EXEC);
    const reviewPath = join(workspace.root, 'review.json');
    await writeFile(reviewPath, `${JSON.stringify({
      id: 7,
      user: { login: 'alice' },
      state: 'APPROVED',
      commit_id: assessment.change.head,
      submitted_at: '2026-11-22T00:00:00Z',
      html_url: 'https://github.com/owner/repo/pull/1#pullrequestreview-7',
    }, null, 2)}\n`, 'utf8');
    const approvalPath = join(workspace.root, 'approval.json');
    await run(process.execPath, [
      'bin/firetree-approval.mjs',
      '--root', workspace.root,
      '--input', reviewPath,
      '--head', assessment.change.head,
      '--change', 'chg-approval',
      '--out', approvalPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    const approval = JSON.parse(await readFile(approvalPath, 'utf8'));
    assert.match(approval.change.assessment_sha256, /^[a-f0-9]{64}$/);
    assert.equal(approval.change.diff_sha256, undefined);
    assert.equal(approval.reviewer, 'github:alice');

    await assert.rejects(
      run(process.execPath, [
        'bin/firetree-approval.mjs',
        '--root', workspace.root,
        '--input', reviewPath,
        '--head', assessment.change.head,
        '--out', approvalPath,
      ], { cwd: process.cwd(), encoding: 'utf8' }),
      (error) => /--assessment or --change is required/.test(error.stderr),
    );
  } finally {
    await workspace.cleanup();
  }
});
