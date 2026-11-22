/** Per-change transaction lock for read-modify-write artifact operations. */\n// Exported for assess, review, hypothesis, and synthesize.

import { firetreePath } from './artifacts.js';
import { withFileLock } from './lock.js';

/**
 * Serialize mutations for one change across tools.
 *
 * @param {string} root - Repository root.
 * @param {string} change - Safe change id.
 * @param {() => Promise<T>} fn - Critical section.
 * @returns {Promise<T>} Function result.
 * @template T
 */
export async function withChangeLock(root, change, fn) {
  return withFileLock(firetreePath(root, 'locks', `${change}.lock`), fn, { timeoutMs: 60_000 });
}
