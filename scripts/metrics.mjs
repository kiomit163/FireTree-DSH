#!/usr/bin/env node
/** Aggregate the append-only events file into weekly metrics. */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { readEvents } from '../src/lib/events.js';

function parseArgs(argv) {
  const args = { root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--root' || key === '--out' || key === '--since') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
      args[key.slice(2)] = value;
      index += 1;
    } else if (key === '--help' || key === '-h') {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${key}`);
    }
  }
  return args;
}

function weekOf(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  return monday.toISOString().slice(0, 10);
}

function increment(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/metrics.mjs --root <repo> [--since <date>] [--out <json>]');
    return;
  }
  const root = resolve(args.root);
  const since = args.since === undefined ? null : Date.parse(args.since);
  const { events, valid, gaps } = await readEvents(root);
  const filtered = events.filter((event) => since === null || Number.isNaN(since) || Date.parse(event.ts) >= since);
  const byWeek = {};
  const byTier = {};
  const byTool = {};
  const byResult = {};
  const durations = [];
  for (const event of filtered) {
    const week = weekOf(event.ts);
    byWeek[week] ??= { events: 0, tiers: {}, tools: {}, results: {} };
    byWeek[week].events += 1;
    increment(byWeek[week].tiers, event.tier ?? 'unknown');
    increment(byWeek[week].tools, event.tool ?? 'unknown');
    increment(byWeek[week].results, event.result ?? 'unknown');
    increment(byTier, event.tier ?? 'unknown');
    increment(byTool, event.tool ?? 'unknown');
    increment(byResult, event.result ?? 'unknown');
    if (typeof event.duration_ms === 'number' && Number.isFinite(event.duration_ms)) durations.push(event.duration_ms);
  }
  durations.sort((left, right) => left - right);
  const summary = {
    schema: 'firetree.metrics/v1',
    generated_at: new Date().toISOString(),
    events: filtered.length,
    chain: { valid, gaps },
    by_week: byWeek,
    by_tier: byTier,
    by_tool: byTool,
    by_result: byResult,
    duration_ms: durations.length === 0
      ? null
      : {
          p50: durations[Math.floor((durations.length - 1) * 0.5)],
          p95: durations[Math.floor((durations.length - 1) * 0.95)],
        },
  };
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (args.out === undefined) process.stdout.write(text);
  else {
    await writeFile(resolve(root, args.out), text, 'utf8');
    console.log(`events=${summary.events} chain_valid=${summary.chain.valid} out=${args.out}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
