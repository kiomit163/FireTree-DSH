#!/usr/bin/env node
/** Call one OpenCode Go review seat and emit a seat record. */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

const PROVIDER = 'opencode-go';
const BASE_URL = 'https://opencode.ai/inference/v1';
const API_KEY_ENV = 'OPENCODE_GO_API_KEY';
const MAX_PROMPT_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ALLOWED_MODELS = new Set([
  'qwen3.8-flash',
  'glm-5.3-flash',
  'longcat-2.5-preview-free',
  'mimo-v2.6-flash',
  'step-5-preview-free',
]);

function usage() {
  return [
    'Usage: opencode-review --prompt <file> --out <seat.json> --model <model> --diff-sha256 <sha256> [options]',
    '',
    'Fixed endpoint: https://opencode.ai/inference/v1',
    'Fixed provider: opencode-go',
    'Fixed credential: OPENCODE_GO_API_KEY',
    '',
    'Options:',
    '  --root <dir>       Output containment root (default: cwd)',
    '  --timeout-ms <n>   Request timeout (default: 120000)',
    '',
    'The prompt must ask the model for JSON with verdict and findings.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { timeoutMs: '120000' };
  const values = new Set(['--prompt', '--out', '--model', '--diff-sha256', '--root', '--timeout-ms']);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help' || key === '-h') return { help: true };
    if (!values.has(key)) throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
    args[key.slice(2)] = value;
    index += 1;
  }
  for (const required of ['prompt', 'out', 'model', 'diff-sha256']) {
    if (typeof args[required] !== 'string' || args[required].length === 0) throw new Error(`--${required} is required`);
  }
  if (!ALLOWED_MODELS.has(args.model)) throw new Error(`--model must be one of: ${[...ALLOWED_MODELS].join(', ')}`);
  if (!/^[a-f0-9]{64}$/.test(args['diff-sha256'])) throw new Error('--diff-sha256 must be a SHA-256 hex digest');
  const timeout = Number(args.timeoutMs);
  if (!Number.isInteger(timeout) || timeout <= 0) throw new Error('--timeout-ms must be a positive integer');
  args.timeoutMs = timeout;
  return args;
}

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function validateFinding(finding) {
  if (typeof finding !== 'object' || finding === null) throw new Error('finding must be an object');
  for (const field of ['id', 'claim', 'evidence']) {
    if (typeof finding[field] !== 'string' || finding[field].length === 0) throw new Error(`finding.${field} is required`);
  }
  if (!['blocker', 'non-blocker', 'question'].includes(finding.severity)) throw new Error('finding.severity is invalid');
  if (!['open', 'resolved', 'accepted'].includes(finding.status)) throw new Error('finding.status is invalid');
  if (finding.severity === 'blocker' && finding.status === 'accepted') throw new Error('blocker finding cannot be accepted by the seat');
  return {
    id: finding.id,
    severity: finding.severity,
    claim: finding.claim,
    evidence: finding.evidence,
    status: finding.status,
  };
}

function parseModelJson(content) {
  let trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('model response has no JSON object');
  trimmed = trimmed.slice(start, end + 1);
  const parsed = JSON.parse(trimmed);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('model response is not an object');
  const verdict = typeof parsed.verdict === 'string' ? parsed.verdict.trim() : '';
  if (!['ready', 'not-ready'].includes(verdict)) throw new Error('model response verdict must be ready or not-ready');
  if (!Array.isArray(parsed.findings)) throw new Error('model response findings must be an array');
  return { verdict, findings: parsed.findings.map(validateFinding) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const key = process.env[API_KEY_ENV];
  if (typeof key !== 'string' || key.length === 0) throw new Error(`${API_KEY_ENV} is not set`);
  const root = resolve(args.root ?? process.cwd());
  const output = resolve(root, args.out);
  const outputRelative = relative(root, output);
  if (outputRelative.startsWith('..') || isAbsolute(outputRelative)) throw new Error('--out must stay inside --root');
  const prompt = await readFile(resolve(args.prompt), 'utf8');
  if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) throw new Error('prompt exceeds the 1 MiB limit');
  const system = 'You are an adversarial code reviewer. Return only JSON. Never praise. Every finding must cite evidence.';
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: args.model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(args.timeoutMs),
  });
  if (!response.ok) throw new Error(`OpenCode review failed with HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('OpenCode response exceeds the 2 MiB limit');
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('OpenCode response is not JSON');
  }
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('OpenCode response has no assistant content');
  const parsed = parseModelJson(content);
  const seat = {
    id: args.model,
    provider: PROVIDER,
    model: args.model,
    diff_sha256: args['diff-sha256'],
    context_sha256: hash(`${system}\n${prompt}`),
    prompt_sha256: hash(prompt),
    transcript_sha256: hash(content),
    verdict: parsed.verdict,
    findings: parsed.findings,
  };
  await writeFile(output, `${JSON.stringify(seat, null, 2)}\n`, 'utf8');
  console.log(`seat written: ${args.out} verdict=${seat.verdict} findings=${seat.findings.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
