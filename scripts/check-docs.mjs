#!/usr/bin/env node
/** Markdown link and UTF-8 checks with no external dependencies. */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.firetree', '.tmp']);
const REMOTE_PREFIXES = ['http://', 'https://', 'mailto:', 'tel:', 'data:'];

function walk(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const path = resolve(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

function stripCode(text) {
  const output = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      output.push('');
      continue;
    }
    output.push(fenced ? '' : line);
  }
  return output.join('\n').replace(/`[^`\n]*`/g, '');
}

function normalizeTarget(raw) {
  let target = raw.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
  else target = target.split(/\s+/)[0];
  return target;
}

/**
 * Check every Markdown file for UTF-8 validity and resolvable relative links.
 *
 * @param {string} root - Repository root.
 * @returns {{files: number, links: number, errors: string[]}} Check result.
 */
export function checkDocs(root) {
  const markdown = walk(root).filter((file) => extname(file).toLowerCase() === '.md');
  const errors = [];
  let links = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });

  for (const file of markdown) {
    const relativeFile = relative(root, file).replaceAll('\\', '/');
    let text;
    try {
      text = decoder.decode(readFileSync(file));
    } catch (error) {
      errors.push(`${relativeFile}: invalid UTF-8 (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    if (text.includes('\uFFFD')) errors.push(`${relativeFile}: contains U+FFFD replacement character`);

    const clean = stripCode(text);
    for (const match of clean.matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/g)) {
      const raw = normalizeTarget(match[1]);
      if (raw.length === 0 || raw.startsWith('#')) continue;
      if (REMOTE_PREFIXES.some((prefix) => raw.startsWith(prefix))) continue;

      const withoutAnchor = raw.split('#')[0];
      if (withoutAnchor.length === 0) continue;
      if (isAbsolute(withoutAnchor) || withoutAnchor.startsWith('/')) continue;

      let decoded;
      try {
        decoded = decodeURIComponent(withoutAnchor);
      } catch {
        errors.push(`${relativeFile}: malformed URL escape in link ${JSON.stringify(raw)}`);
        continue;
      }

      links += 1;
      const target = resolve(dirname(file), decoded);
      if (!existsSync(target)) {
        const line = text.slice(0, match.index).split('\n').length;
        errors.push(`${relativeFile}:${line}: missing link target ${JSON.stringify(raw)}`);
      }
    }
  }

  return { files: markdown.length, links, errors };
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = checkDocs(root);
  console.log(`docs=${result.files} links=${result.links} errors=${result.errors.length}`);
  for (const error of result.errors) console.error(error);
  if (result.errors.length > 0) process.exitCode = 1;
}
