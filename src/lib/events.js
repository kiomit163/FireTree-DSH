/** Append-only, hash-chained event log used for state projections and metrics. */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import { firetreePath, sha256Text } from './artifacts.js';
import { canonicalJson } from './json.js';

/**
 * Append one event to `.firetree/events.jsonl`.
 *
 * @param {string} root - Repository root.
 * @param {object} event - Event fields (change, tool, action, tier, result, ...).
 * @returns {Promise<object>} Written event including seq/prev/hash.
 */
export async function appendEvent(root, event) {
  const file = firetreePath(root, 'events.jsonl');
  let previous = null;
  try {
    const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line.trim().length > 0);
    if (lines.length > 0) previous = JSON.parse(lines.at(-1));
  } catch (error) {
    if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error;
  }
  const base = {
    seq: previous === null ? 1 : Number(previous.seq) + 1,
    prev: previous === null ? null : previous.hash,
    event_id: randomUUID(),
    ts: new Date().toISOString(),
    ...event,
  };
  const hash = sha256Text(canonicalJson(base));
  const written = { ...base, hash };
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(written)}\n`, 'utf8');
  return written;
}

/**
 * Read and verify the event chain.
 *
 * @param {string} root - Repository root.
 * @returns {Promise<{events: object[], valid: boolean, gaps: string[]}>} Events and chain result.
 */
export async function readEvents(root) {
  const file = firetreePath(root, 'events.jsonl');
  let lines;
  try {
    lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line.trim().length > 0);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return { events: [], valid: true, gaps: [] };
    throw error;
  }
  const events = [];
  const gaps = [];
  let previousHash = null;
  for (let index = 0; index < lines.length; index += 1) {
    let event;
    try {
      event = JSON.parse(lines[index]);
    } catch {
      gaps.push(`event line ${index + 1} is not JSON`);
      continue;
    }
    if (event.prev !== previousHash) gaps.push(`event ${event.seq} prev does not match previous hash`);
    const { hash, ...base } = event;
    if (sha256Text(canonicalJson(base)) !== hash) gaps.push(`event ${event.seq} hash does not match content`);
    previousHash = typeof hash === 'string' ? hash : null;
    events.push(event);
  }
  return { events, valid: gaps.length === 0, gaps };
}
