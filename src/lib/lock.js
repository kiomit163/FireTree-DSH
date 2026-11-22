/** Small cross-process file lock used by append-only artifacts. */

import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const STALE_MS = 10 * 60_000;

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && typeof error === 'object' && error.code === 'EPERM';
  }
}

async function lockOwnerIsAlive(file) {
  try {
    const text = await readFile(file, 'utf8');
    const pid = Number.parseInt(text.split(/\r?\n/u)[0], 10);
    return processAlive(pid);
  } catch {
    return false;
  }
}

/**
 * Run a function while holding an exclusive advisory lock file.
 *
 * The lock is created with O_EXCL. A stale lock (for example after a killed
 * process) is removed only after STALE_MS so a crashed writer cannot block the
 * repository forever.
 *
 * @param {string} file - Lock file path.
 * @param {() => Promise<T>} fn - Critical section.
 * @param {{timeoutMs?: number, retryMs?: number}} [options] - Wait policy.
 * @returns {Promise<T>} Function result.
 * @template T
 */
export async function withFileLock(file, fn, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const retryMs = options.retryMs ?? 25;
  await mkdir(dirname(file), { recursive: true });
  const started = Date.now();
  let handle;
  while (handle === undefined) {
    try {
      handle = await open(file, 'wx');
      await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
    } catch (error) {
      if (!(error && typeof error === 'object' && (error.code === 'EEXIST' || error.code === 'EPERM'))) throw error;
      try {
        const info = await stat(file);
        const ownerAlive = await lockOwnerIsAlive(file);
        if (!ownerAlive && Date.now() - info.mtimeMs > STALE_MS) {
          await rm(file, { force: true });
          continue;
        }
      } catch {
        // The lock was released between open() and stat(); retry with a bound.
        if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for lock ${file}`);
        await delay(retryMs);
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`timed out waiting for lock ${file}`);
      }
      await delay(retryMs);
    }
  }
  try {
    return await fn();
  } finally {
    await handle.close().catch(() => {});
    await rm(file, { force: true }).catch(() => {});
  }
}
