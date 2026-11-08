/** Upgrade OTel pilot evidence to real Codecov coverage (A2 / ci-evidence). */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { sha256Text } from '../src/lib/artifacts.js';
import { createAssessTool } from '../src/tools/assess.js';
import { createReceiptTool } from '../src/tools/receipt.js';

const EXEC = { agent: { id: 'pilot-agent' }, signal: new AbortController().signal };
const REPO = 'open-telemetry/opentelemetry-collector';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--root' || key === '--report' || key === '--out' || key === '--cache') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
      args[key.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${key}`);
    }
  }
  if (!args.root || !args.report) throw new Error('usage: --root <repo> --report <json> [--out <json>] [--cache <dir>]');
  return args;
}

function contextFor(root) {
  return { workingDirectory: { async ensure() { return root; } } };
}

async function codecov(sha) {
  const url = `https://api.codecov.io/api/v2/github/${REPO}/commits/${sha}`;
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
  try {
    const body = execFileSync(curl, [
      '-sS', '-L', '--fail', '--max-time', '60',
      '-H', 'User-Agent: FireTree-DSH-pilot',
      '-H', 'Accept: application/json',
      url,
    ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    return JSON.parse(body);
  } catch (error) {
    if (error?.status === 22) return null;
    throw new Error(`Codecov fetch failed: ${error?.stderr ?? error?.message ?? String(error)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root);
  const report = JSON.parse(await readFile(resolve(args.report), 'utf8'));
  const ctx = contextFor(root);
  const assess = createAssessTool(ctx);
  const receipt = createReceiptTool(ctx);
  const successes = [];
  const failures = [];

  for (const pr of report.prs) {
    const change = `pr-${pr.number}`;
    try {
      const cached = args.cache ? join(resolve(args.cache), `${pr.number}.json`) : null;
      const data = cached === null ? await codecov(pr.head_sha) : JSON.parse(await readFile(cached, 'utf8'));
      if (data === null) throw new Error('Codecov report not found');
      if (data.commitid !== pr.head_sha) throw new Error(`Codecov commit mismatch: ${data.commitid}`);
      if (data.state !== 'complete') throw new Error(`Codecov state is ${data.state}`);
      if (data.ci_passed !== true) throw new Error('Codecov reports CI not passed');

      const evidencePath = `.firetree/pilot-ci/${change}-codecov.json`;
      const evidenceFile = join(root, evidencePath);
      await mkdir(dirname(evidenceFile), { recursive: true });
      await writeFile(evidenceFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

      await assess.execute({
        base: pr.base_sha,
        head: pr.head_sha,
        files: pr.impact.files,
        change,
      }, EXEC);

      const producedAt = typeof data.timestamp === 'string'
        ? new Date(data.timestamp).toISOString()
        : new Date((data.timestamp ?? Date.now()) * (data.timestamp > 1e12 ? 1 : 1000)).toISOString();
      const built = await receipt.execute({
        action: 'build',
        mode: 'autonomous',
        change,
        intent: { spec: `pilot:${REPO}#${pr.number}`, sha256: sha256Text(`${REPO}#${pr.number}`) },
        classification: { subsystem: 'pilot', kind: 'large', method: 'decompose', dossier_sha256: 'a'.repeat(64) },
        evidence: [{
          kind: 'coverage',
          producer: 'ci:codecov',
          run_ref: evidencePath,
          produced_at: producedAt,
        }],
        expires_at: '2027-01-01T00:00:00Z',
        assurance: 'A2',
      }, EXEC);
      if (!built.ok) throw new Error(built.gaps.join('; '));
      const checked = await receipt.execute({ action: 'check', mode: 'autonomous', change }, EXEC);
      if (!checked.ok) throw new Error(checked.gaps.join('; '));
      successes.push({ number: pr.number, coverage: data.totals?.coverage, evidence: `.firetree/evidence/${change}.json` });
      process.stdout.write(`ok ${change} coverage=${data.totals?.coverage}\n`);
    } catch (error) {
      failures.push({ number: pr.number, error: error instanceof Error ? error.message : String(error) });
      process.stdout.write(`FAIL ${change}: ${failures.at(-1).error}\n`);
    }
  }

  const summary = {
    schema: 'firetree.pilot-ci-evidence-summary/v0',
    repo: REPO,
    generated_at: new Date().toISOString(),
    total: report.prs.length,
    upgraded: successes.length,
    failed: failures.length,
    scope: 'ci-evidence',
    assurance: 'A2',
    human_signoff: false,
    completion_claim: false,
    milestone_claim: false,
    successes,
    failures,
  };
  const out = resolve(args.out ?? 'pilot-ci-evidence-summary.json');
  await writeFile(out, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`upgraded=${summary.upgraded} failed=${summary.failed} summary=${out}`);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
