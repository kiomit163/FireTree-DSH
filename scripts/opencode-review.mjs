#!/usr/bin/env node
/** Call one OpenAI-compatible review seat (OpenCode Go) and emit a seat record. */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function usage() {
  return [
    'Usage: opencode-review --prompt <file> --out <seat.json> --model <model> [options]',
    '',
    'Options:',
    '  --provider <id>           Provider id (default: opencode-go)',
    '  --base-url <url>          OpenAI-compatible base URL (default: https://opencode.ai/inference/v1)',
    '  --api-key-env <name>      Env var holding the key (default: OPENCODE_GO_API_KEY)',
    '  --timeout-ms <n>          Request timeout (default: 120000)',
    '',
    'The prompt must ask the model for JSON with verdict and findings.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    provider: 'opencode-go',
    baseUrl: 'https://opencode.ai/inference/v1',
    apiKeyEnv: 'OPENCODE_GO_API_KEY',
    timeoutMs: '120000',
  };
  const values = new Set(['--prompt', '--out', '--model', '--provider', '--base-url', '--api-key-env', '--timeout-ms']);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help' || key === '-h') return { help: true };
    if (!values.has(key)) throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
    args[key.slice(2)] = value;
    index += 1;
  }
  for (const required of ['prompt', 'out', 'model']) {
    if (typeof args[required] !== 'string' || args[required].length === 0) throw new Error(`--${required} is required`);
  }
  return args;
}

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function parseModelJson(content) {
  let trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) trimmed = trimmed.slice(start, end + 1);
  const parsed = JSON.parse(trimmed);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('model response is not an object');
  const verdict = typeof parsed.verdict === 'string' ? parsed.verdict.trim() : '';
  if (!['ready', 'not-ready'].includes(verdict)) throw new Error('model response verdict must be ready or not-ready');
  if (!Array.isArray(parsed.findings)) throw new Error('model response findings must be an array');
  return { verdict, findings: parsed.findings };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const key = process.env[args.apiKeyEnv];
  if (typeof key !== 'string' || key.length === 0) throw new Error(`${args.apiKeyEnv} is not set`);
  const prompt = await readFile(resolve(args.prompt), 'utf8');
  const response = await fetch(`${args.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: args.model,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are an adversarial code reviewer. Return only JSON. Never praise. Every finding must cite evidence.' },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(Number(args.timeoutMs)),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenCode review failed: HTTP ${response.status} ${body.slice(0, 300)}`);
  }
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('OpenCode response has no assistant content');
  const parsed = parseModelJson(content);
  const seat = {
    id: args.model,
    provider: args.provider,
    model: args.model,
    context_sha256: hash(prompt),
    prompt_sha256: hash(prompt),
    transcript_sha256: hash(content),
    verdict: parsed.verdict,
    findings: parsed.findings,
  };
  await writeFile(resolve(args.out), `${JSON.stringify(seat, null, 2)}\n`, 'utf8');
  console.log(`seat written: ${args.out} verdict=${seat.verdict} findings=${seat.findings.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
