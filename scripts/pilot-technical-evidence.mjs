/** Build autonomous analysis-only technical evidence for every PR in a pilot report. */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { sha256Text } from '../src/lib/artifacts.js';
import { createAssessTool } from '../src/tools/assess.js';
import { createReceiptTool } from '../src/tools/receipt.js';

const EXEC = { agent: { id: 'pilot-agent' }, signal: new AbortController().signal };

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--root' || key === '--report' || key === '--repo' || key === '--out') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
      args[key.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${key}`);
    }
  }
  if (!args.root || !args.report || !args.repo) throw new Error('usage: --root <repo> --report <json> --repo <label> [--out <json>]');
  return args;
}

function contextFor(root) {
  return { workingDirectory: { async ensure() { return root; } } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root);
  const report = JSON.parse(await readFile(resolve(args.report), 'utf8'));
  const ctx = contextFor(root);
  const assess = createAssessTool(ctx);
  const receipt = createReceiptTool(ctx);
  const generatedAt = new Date().toISOString();
  const successes = [];
  const failures = [];

  for (const pr of report.prs) {
    const change = `pr-${pr.number}`;
    try {
      await assess.execute({
        base: pr.base_sha,
        head: pr.head_sha,
        files: pr.impact.files,
        change,
      }, EXEC);

      const analysisPath = `.firetree/pilot-analysis/${change}.json`;
      const analysisFile = join(root, analysisPath);
      await mkdir(dirname(analysisFile), { recursive: true });
      await writeFile(analysisFile, `${JSON.stringify({
        schema: 'firetree.pilot-analysis/v0',
        repo: args.repo,
        pr: pr.number,
        title: pr.title,
        url: pr.url,
        tier: pr.tier,
        reasons: pr.reasons,
        impact: pr.impact,
        files_count: pr.files_count,
        generated_at: generatedAt,
      }, null, 2)}\n`, 'utf8');

      const built = await receipt.execute({
        action: 'build',
        mode: 'autonomous',
        change,
        intent: { spec: `pilot:${args.repo}#${pr.number}`, sha256: sha256Text(`${args.repo}#${pr.number}`) },
        classification: { subsystem: 'pilot', kind: 'large', method: 'decompose', dossier_sha256: 'a'.repeat(64) },
        evidence: [{
          kind: 'analysis',
          producer: 'tool:firetree-pilot-assess',
          run_ref: analysisPath,
          produced_at: generatedAt,
        }],
        expires_at: '2027-01-01T00:00:00Z',
        assurance: 'A1',
      }, EXEC);
      if (!built.ok) throw new Error(built.gaps.join('; '));

      const checked = await receipt.execute({ action: 'check', mode: 'autonomous', change }, EXEC);
      if (!checked.ok) throw new Error(checked.gaps.join('; '));
      successes.push({ number: pr.number, tier: pr.tier, evidence: `.firetree/evidence/${change}.json` });
      process.stdout.write(`ok ${args.repo}#${pr.number} ${pr.tier}\n`);
    } catch (error) {
      failures.push({ number: pr.number, error: error instanceof Error ? error.message : String(error) });
      process.stdout.write(`FAIL ${args.repo}#${pr.number}: ${failures.at(-1).error}\n`);
    }
  }

  const summary = {
    schema: 'firetree.pilot-technical-evidence-summary/v0',
    repo: args.repo,
    generated_at: generatedAt,
    total: report.prs.length,
    built: successes.length,
    failed: failures.length,
    scope: 'analysis-only',
    assurance: 'A1',
    human_signoff: false,
    completion_claim: false,
    milestone_claim: false,
    successes,
    failures,
  };
  const out = resolve(args.out ?? `pilot-evidence-${args.repo.replaceAll('/', '-')}.json`);
  await writeFile(out, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`built=${summary.built} failed=${summary.failed} summary=${out}`);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
