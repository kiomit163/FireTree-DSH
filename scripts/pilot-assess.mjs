/** Deterministic pilot harness: run impact/tier over a manifest of real PR file sets. */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { normalizeRepoPath } from '../src/lib/glob.js';
import { analyzeImpact } from '../src/lib/impact.js';
import { loadCodeowners } from '../src/lib/codeowners.js';
import { loadOwners } from '../src/lib/owners.js';
import { loadRegistry } from '../src/lib/registry.js';

function usage() {
  return 'Usage: node scripts/pilot-assess.mjs --root <repo> --manifest <manifest.json> [--out <report.json>]';
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root' || arg === '--manifest' || arg === '--out') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      values[arg.slice(2)] = value;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      values.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return values;
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.root || !args.manifest) throw new Error(usage());

  const root = resolve(args.root);
  const manifest = JSON.parse(await readFile(resolve(args.manifest), 'utf8'));
  if (!Array.isArray(manifest.prs) || manifest.prs.length === 0) throw new Error('manifest.prs must be a non-empty array');

  const registry = await loadRegistry(root);
  const codeowners = await loadCodeowners(root);
  const owners = codeowners ?? await loadOwners(root);
  const prs = [];
  const failures = [];

  for (const pr of manifest.prs) {
    const files = [...new Set((pr.files ?? []).map((file) => normalizeRepoPath(file.filename ?? file)))].sort();
    if (files.length === 0) {
      failures.push({ number: pr.number, error: 'PR has no files' });
      continue;
    }
    try {
      const analysis = analyzeImpact({
        files,
        subsystems: registry.subsystems,
        interfaces: registry.interfaces,
        codeowners: owners,
      });
      prs.push({
        number: pr.number,
        title: pr.title,
        merged_at: pr.merged_at,
        url: pr.url,
        base_sha: pr.base_sha,
        head_sha: pr.head_sha,
        files_count: files.length,
        tier: analysis.auto_tier,
        reasons: analysis.reasons,
        confidence: analysis.confidence,
        impact: analysis.impact,
      });
    } catch (error) {
      failures.push({ number: pr.number, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const report = {
    schema: 'firetree.pilot-report/v0',
    generated_at: new Date().toISOString(),
    repo: manifest.repo,
    source_list: manifest.source_list,
    root,
    registry: {
      policy_version: registry.policy.version,
      subsystems: registry.subsystems.length,
      interfaces: registry.interfaces.length,
    },
    totals: {
      prs: manifest.prs.length,
      assessed: prs.length,
      failed: failures.length,
    },
    tiers: countBy(prs.map((pr) => pr.tier)),
    reason_counts: countBy(prs.flatMap((pr) => pr.reasons.map((reason) => reason.split(':')[0]))),
    confidence: countBy(prs.map((pr) => pr.confidence)),
    owner_resolution: {
      source: owners?.source ?? 'none',
      files: owners?.files ?? 0,
      ownerless_prs: prs.filter((pr) => pr.impact.owners.length === 0).map((pr) => pr.number),
    },
    unknown_prs: prs.filter((pr) => pr.impact.unknown.length > 0).map((pr) => pr.number),
    interface_prs: prs.filter((pr) => pr.impact.interfaces.length > 0).map((pr) => pr.number),
    cross_subsystem_prs: prs.filter((pr) => pr.reasons.some((reason) => reason.startsWith('cross-subsystem:'))).map((pr) => pr.number),
    failed_prs: failures,
    prs,
  };
  const out = resolve(args.out ?? 'pilot-report.json');
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`assessed=${report.totals.assessed} failed=${report.totals.failed} tiers=${JSON.stringify(report.tiers)} unknown_prs=${report.unknown_prs.length} interfaces=${report.interface_prs.length} cross=${report.cross_subsystem_prs.length}`);
  console.log(`report=${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
