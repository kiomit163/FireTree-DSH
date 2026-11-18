#!/usr/bin/env node
/** Weekly p-chart for the L2 ratio (statistical process control). */

import { resolve } from 'node:path';

import { readEvents } from '../src/lib/events.js';

function parseArgs(argv) {
  const args = { root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--root' || key === '--out') {
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
  if (Number.isNaN(date.getTime())) return null;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  return monday.toISOString().slice(0, 10);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/spc.mjs --root <repo> [--out <json>]');
    return;
  }
  const root = resolve(args.root);
  const { events, valid, gaps } = await readEvents(root);
  const weeks = new Map();
  for (const event of events) {
    if (event.tool !== 'firetree_assess' || event.result !== 'ok') continue;
    const week = weekOf(event.ts);
    if (week === null) continue;
    const row = weeks.get(week) ?? { week, assessed: 0, l2: 0 };
    row.assessed += 1;
    if (event.tier === 'L2') row.l2 += 1;
    weeks.set(week, row);
  }
  const series = [...weeks.values()].sort((left, right) => left.week.localeCompare(right.week));
  const totalAssessed = series.reduce((sum, row) => sum + row.assessed, 0);
  const totalL2 = series.reduce((sum, row) => sum + row.l2, 0);
  const center = totalAssessed === 0 ? 0 : totalL2 / totalAssessed;
  const chart = series.map((row) => {
    const p = row.assessed === 0 ? 0 : row.l2 / row.assessed;
    const sigma = row.assessed === 0 ? 0 : Math.sqrt((center * (1 - center)) / row.assessed);
    return {
      ...row,
      ratio: Number(p.toFixed(4)),
      ucl: Number(Math.min(1, center + 3 * sigma).toFixed(4)),
      lcl: Number(Math.max(0, center - 3 * sigma).toFixed(4)),
      out_of_control: row.assessed > 0 && (p > center + 3 * sigma || p < center - 3 * sigma),
    };
  });
  const summary = {
    schema: 'firetree.spc/v1',
    generated_at: new Date().toISOString(),
    chain: { valid, gaps },
    center: Number(center.toFixed(4)),
    weeks: chart,
    alerts: chart.filter((row) => row.out_of_control).map((row) => row.week),
  };
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (args.out === undefined) process.stdout.write(text);
  else {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(resolve(root, args.out), text, 'utf8');
    console.log(`weeks=${chart.length} alerts=${summary.alerts.length} out=${args.out}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
