#!/usr/bin/env node
/**
 * Trusted multi-provider AI review service.
 *
 * This script is intended to run in the trusted CI workflow, not in the PR
 * workspace. It reads a diff, calls two independent providers, and signs the
 * review artifact with an operator-held HMAC key.
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { evaluateAiReview } from '../src/lib/ai-review.js';

const MAX_DIFF_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const SEATS = [
  {
    id: 'opencode-go',
    provider: 'opencode-go',
    model: 'glm-5.3-flash',
    endpoint: 'https://opencode.ai/inference/v1/chat/completions',
    apiKeyEnv: 'OPENCODE_GO_API_KEY',
  },
  {
    id: 'pollinations',
    provider: 'pollinations',
    model: 'openai',
    endpoint: 'https://text.pollinations.ai/openai',
  },
];

function usage() {
  return [
    'Usage: trusted-ai-review --diff-file <file> [--context-file <file>] --change <id> --head <sha> --diff-sha256 <sha256> --out <artifact.json>',
    '',
    'Requires OPENCODE_GO_API_KEY and FIRE_TREE_REVIEW_SIGNING_KEY;',
    'the second seat uses the keyless Pollinations OpenAI-compatible endpoint.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  const values = new Set(['--diff-file', '--context-file', '--change', '--head', '--diff-sha256', '--out']);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help' || key === '-h') return { help: true };
    if (!values.has(key)) throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
    args[key.slice(2)] = value;
    index += 1;
  }
  for (const required of ['diff-file', 'change', 'head', 'diff-sha256', 'out']) {
    if (typeof args[required] !== 'string' || args[required].length === 0) throw new Error(`--${required} is required`);
  }
  if (!/^[a-f0-9]{64}$/.test(args['diff-sha256'])) throw new Error('--diff-sha256 must be a SHA-256 hex digest');
  return args;
}

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function parseJsonContent(content) {
  let trimmed = String(content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('model response has no JSON object');
  trimmed = trimmed.slice(start, end + 1);
  const parsed = JSON.parse(trimmed);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('model response is not an object');
  const verdict = typeof parsed.verdict === 'string' ? parsed.verdict.trim() : '';
  if (!['ready', 'not-ready'].includes(verdict)) throw new Error('model verdict must be ready or not-ready');
  if (!Array.isArray(parsed.findings)) throw new Error('model findings must be an array');
  const findings = parsed.findings.map((finding) => {
    if (typeof finding !== 'object' || finding === null) throw new Error('finding must be an object');
    for (const field of ['id', 'claim', 'evidence']) {
      if (typeof finding[field] !== 'string' || finding[field].length === 0) throw new Error(`finding.${field} is required`);
    }
    if (!['blocker', 'non-blocker', 'question'].includes(finding.severity)) throw new Error('finding severity is invalid');
    if (!['open', 'resolved'].includes(finding.status)) throw new Error('finding status is invalid');
    return {
      id: finding.id,
      severity: finding.severity,
      claim: finding.claim,
      evidence: finding.evidence,
      status: finding.status,
    };
  });
  const effectiveVerdict = verdict === 'ready' && findings.some((finding) => finding.status === 'open') ? 'not-ready' : verdict;
  return { verdict: effectiveVerdict, findings };
}

function promptFor(diff, context = '') {
  return [
    'Review this exact git diff as an adversarial code reviewer.',
    context.length === 0 ? '' : 'The changed files at the PR head are included after the diff so you have full context.',
    ...(context.length === 0 ? [] : [context]),
    'DIFF:',
    'Report only concrete blocker defects: security, data loss, auth bypass, incorrect behavior, or an unverifiable gate.',
    'Omit style, naming, documentation, and speculative non-blocker observations.',
    'If there is no concrete blocker, return ready with an empty findings array.',
    'Return only JSON with this shape:',
    '{"verdict":"ready|not-ready","findings":[{"id":"...","severity":"blocker","claim":"...","evidence":"file:line ...","status":"open|resolved"}]}',
    'Do not praise. Do not invent evidence. A blocker must be fixed in the diff, not accepted.',
    '',
    diff,
  ].join('\n');
}

async function callSeat(seat, prompt) {
  let apiKey;
  if (seat.apiKeyEnv !== undefined) {
    apiKey = process.env[seat.apiKeyEnv];
    if (typeof apiKey !== 'string' || apiKey.length === 0) throw new Error(`${seat.apiKeyEnv} is not configured`);
  }
  const request = {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey === undefined ? {} : { Authorization: `Bearer ${apiKey}` }),
    },
    body: JSON.stringify({
      model: seat.model,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are an adversarial code reviewer. Return only JSON. Never praise. Every finding must cite evidence.' },
        { role: 'user', content: prompt },
      ],
    }),
  };
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(seat.endpoint, { ...request, signal: AbortSignal.timeout(120000) });
    } catch (error) {
      if (attempt === 1) {
        throw new Error(`${seat.id} network failure after 2 attempts: ${error instanceof Error ? error.message : String(error)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
      continue;
    }
    if (response.ok) break;
    if (![402, 429, 500, 502, 503, 504].includes(response.status) || attempt === 1) {
      throw new Error(`${seat.id} failed with HTTP ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (!response?.ok) throw new Error(`${seat.id} failed after retries`);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error(`${seat.id} response is too large`);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${seat.id} response is not JSON`);
  }
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error(`${seat.id} response has no assistant content`);
  const parsed = parseJsonContent(content);
  return {
    id: seat.id,
    provider: seat.provider,
    model: seat.model,
    diff_sha256: undefined,
    context_sha256: hash(`${prompt}\n${seat.provider}:${seat.model}`),
    prompt_sha256: hash(prompt),
    transcript_sha256: hash(`${seat.provider}\n${seat.model}\n${content}`),
    verdict: parsed.verdict,
    findings: parsed.findings,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const root = process.cwd();
  const output = resolve(root, args.out);
  const relativeOutput = relative(root, output);
  if (relativeOutput.length === 0 || relativeOutput === '..' || relativeOutput.startsWith(`..${sep}`) || isAbsolute(relativeOutput)) {
    throw new Error('--out must stay inside the workspace');
  }
  const diff = await readFile(resolve(args['diff-file']), 'utf8');
  if (Buffer.byteLength(diff, 'utf8') > MAX_DIFF_BYTES) throw new Error('diff exceeds the 1 MiB review limit');
  const context = args['context-file'] === undefined ? '' : await readFile(resolve(args['context-file']), 'utf8');
  if (Buffer.byteLength(context, 'utf8') > MAX_DIFF_BYTES) throw new Error('review context exceeds the 1 MiB limit');
  if (process.env.FIRE_TREE_ALLOW_PUBLIC_REVIEW_PROVIDER !== 'true') {
    throw new Error('public review provider is disabled; enable it only for public repositories');
  }
  const signingKey = process.env.FIRE_TREE_REVIEW_SIGNING_KEY;
  if (typeof signingKey !== 'string' || signingKey.length === 0) throw new Error('FIRE_TREE_REVIEW_SIGNING_KEY is not configured');
  const prompt = promptFor(diff, context);
  const seats = await Promise.race([
    Promise.all(SEATS.map((seat) => callSeat(seat, prompt))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('trusted review exceeded the 5 minute budget')), 300000)),
  ]);
  for (const seat of seats) seat.diff_sha256 = args['diff-sha256'];
  console.log(JSON.stringify(seats.map((seat) => ({
    provider: seat.provider,
    model: seat.model,
    verdict: seat.verdict,
    findings: seat.findings.length,
    open: seat.findings.filter((finding) => finding.status === 'open').length,
    claims: seat.findings.map((finding) => `${finding.severity}: ${finding.claim}`),
  }))));
  const openFindings = seats.flatMap((seat) => seat.findings).filter((finding) => finding.status === 'open').length;
  const artifact = {
    schema: 'firetree.ai-review/v1',
    change: { id: args.change, head: args.head.toLowerCase(), diff_sha256: args['diff-sha256'] },
    mode: 'multi-provider',
    author: { provider: 'trusted-review-service', model: 'c3-hmac-v1' },
    seats,
    unresolved: openFindings,
    converged: seats.every((seat) => seat.verdict === 'ready') && openFindings === 0,
    created_at: new Date().toISOString(),
  };
  const unsignedPayload = JSON.stringify(artifact);
  artifact.signature = createHmac('sha256', signingKey).update(unsignedPayload).digest('hex');
  const check = evaluateAiReview(artifact, { diffSha256: args['diff-sha256'] }, { requireSignature: true, signingKey });
  if (!check.valid) throw new Error(`trusted review is invalid: ${check.gaps.join('; ')}`);
  const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  console.log(`trusted review written: ${args.out} mode=multi-provider seats=${seats.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});


