/** Upgrade Kubernetes pilot evidence to real Prow JUnit artifacts (A2 / ci-evidence). */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { sha256Text } from '../src/lib/artifacts.js';
import { createAssessTool } from '../src/tools/assess.js';
import { createReceiptTool } from '../src/tools/receipt.js';

const EXEC = { agent: { id: 'pilot-agent' }, signal: new AbortController().signal };
const REPO = 'kubernetes/kubernetes';
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--root' || key === '--report' || key === '--out') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
      args[key.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${key}`);
    }
  }
  if (!args.root || !args.report) throw new Error('usage: --root <repo> --report <json> [--out <json>]');
  return args;
}

function contextFor(root) {
  return { workingDirectory: { async ensure() { return root; } } };
}

function curlText(url, { fail = true } = {}) {
  const args = ['-sS', '-L', '--max-time', '60', '-H', 'User-Agent: FireTree-DSH-pilot', '-H', 'Accept: application/json', url];
  if (fail) args.splice(2, 0, '--fail');
  return execFileSync(CURL, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

function curlFile(url, output) {
  execFileSync(CURL, ['-sS', '-L', '--fail', '--max-time', '60', '-o', output, url], { encoding: 'utf8' });
}

function statusFor(sha) {
  const statuses = JSON.parse(curlText(`https://api.github.com/repos/${REPO}/commits/${sha}/statuses?per_page=100`));
  const candidates = statuses.filter((status) => status.state === 'success'
    && typeof status.target_url === 'string'
    && status.target_url.includes('/view/gs/'));
  const preferred = candidates.find((status) => status.context === 'pull-kubernetes-unit')
    ?? candidates.find((status) => status.context.startsWith('pull-kubernetes-'));
  if (preferred === undefined) return null;
  const match = /\/view\/gs\/(.+)$/.exec(preferred.target_url);
  if (match === null) return null;
  return { context: preferred.context, gcsPath: match[1] };
}

function junitFromProw(gcsPath) {
  const html = curlText(`https://prow.k8s.io/view/gs/${gcsPath}`);
  const match = /var lensArtifacts = (\{.*?\});/s.exec(html);
  if (match === null) return null;
  const files = Object.values(JSON.parse(match[1])).flat();
  const junit = files.find((file) => /(^|\/)junit[^/]*\.xml$/i.test(file));
  if (junit === undefined) return null;
  return { name: junit, url: `https://storage.googleapis.com/${gcsPath}/${junit}` };
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
      let head = pr.head_sha;
      try {
        head = execFileSync('git', ['-C', root, 'rev-parse', `${pr.head_sha}^2`], { encoding: 'utf8' }).trim();
      } catch {
        // Fall back to the merge commit if the second parent is unavailable.
      }
      const status = statusFor(head);
      if (status === null) throw new Error('no successful Prow job with GCS target');
      const junit = junitFromProw(status.gcsPath);
      if (junit === null) throw new Error('Prow job has no JUnit XML');

      const evidencePath = `.firetree/pilot-ci/${change}-junit.xml`;
      const evidenceFile = join(root, evidencePath);
      await mkdir(dirname(evidenceFile), { recursive: true });
      curlFile(junit.url, evidenceFile);
      const xml = await readFile(evidenceFile, 'utf8');
      if (!xml.trimStart().startsWith('<?xml') && !xml.trimStart().startsWith('<testsuites') && !xml.trimStart().startsWith('<testsuite')) {
        throw new Error('downloaded artifact is not JUnit XML');
      }
      const timestamp = /timestamp="([^"]+)"/.exec(xml)?.[1];

      await assess.execute({
        base: pr.base_sha,
        head: pr.head_sha,
        files: pr.impact.files,
        change,
      }, EXEC);

      const producedAt = timestamp ?? new Date().toISOString();
      const built = await receipt.execute({
        action: 'build',
        mode: 'autonomous',
        change,
        intent: { spec: `pilot:${REPO}#${pr.number}`, sha256: sha256Text(`${REPO}#${pr.number}`) },
        classification: { subsystem: 'pilot', kind: 'large', method: 'decompose', dossier_sha256: 'a'.repeat(64) },
        evidence: [{
          kind: 'test',
          producer: 'ci:prow',
          run_ref: evidencePath,
          produced_at: producedAt,
        }],
        expires_at: '2027-01-01T00:00:00Z',
        assurance: 'A2',
      }, EXEC);
      if (!built.ok) throw new Error(built.gaps.join('; '));
      const checked = await receipt.execute({ action: 'check', mode: 'autonomous', change }, EXEC);
      if (!checked.ok) throw new Error(checked.gaps.join('; '));
      successes.push({ number: pr.number, job: status.context, junit: junit.name });
      process.stdout.write(`ok ${change} ${status.context} ${junit.name}\n`);
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
    evidence: 'junit',
    human_signoff: false,
    completion_claim: false,
    milestone_claim: false,
    successes,
    failures,
  };
  const out = resolve(args.out ?? 'pilot-prow-junit-summary.json');
  await writeFile(out, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`upgraded=${summary.upgraded} failed=${summary.failed} summary=${out}`);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
