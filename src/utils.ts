/**
 * git-pull-dir — Utility functions
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline';
import { DirExistsError } from './errors.js';

/**
 * Create a temporary working directory and return its path.
 */
export async function createTempDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'git-pull-dir-'));
}

/**
 * Delete a temporary directory recursively.
 */
export async function cleanupTempDir(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true });
}

/**
 * When local-dir is omitted, derive it from the last segment of git-dir.
 */
export function getLocalDirName(gitDir: string, localDir?: string): string {
  if (localDir) return localDir;
  // Normalize path separators and get the last segment
  const normalized = gitDir.replace(/\\/g, '/').replace(/\/$/, '');
  const segments = normalized.split('/');
  const last = segments[segments.length - 1];
  return last || 'output';
}

/**
 * Parse a Git URL (HTTPS or SSH) into owner and repo.
 */
export function parseGitUrl(url: string): { owner: string; repo: string } {
  let owner = '';
  let repo = '';

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/https:\/\/[^/]+\/([^/]+)\/([^/.]+)(?:\.git)?\/?$/);
  if (httpsMatch) {
    owner = httpsMatch[1];
    repo = httpsMatch[2];
    return { owner, repo };
  }

  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@[^:]+:([^/]+)\/([^/.]+)(?:\.git)?\/?$/);
  if (sshMatch) {
    owner = sshMatch[1];
    repo = sshMatch[2];
    return { owner, repo };
  }

  return { owner, repo };
}

/**
 * Validate a Git URL format (HTTPS or SSH).
 */
export function validateUrl(url: string): boolean {
  const httpsPattern = /^https:\/\/.+\/.+\/.+/;
  const sshPattern = /^git@.+:.+\/.+/;
  return httpsPattern.test(url) || sshPattern.test(url);
}

/**
 * Prompt the user whether to overwrite an existing directory.
 * Keeps asking until the user types "yes" or "no" (case-insensitive).
 */
export async function promptOverwrite(dir: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<boolean>((resolve) => {
    const ask = () => {
      rl.question(`目录 ${dir} 已存在，是否覆盖？(yes/no)\n`, (answer) => {
        const trimmed = answer.trim().toLowerCase();
        if (trimmed === 'yes') {
          rl.close();
          resolve(true);
        } else if (trimmed === 'no') {
          rl.close();
          resolve(false);
        } else {
          ask();
        }
      });
    };
    ask();
  });
}

/**
 * Check if the target output directory exists and is non-empty.
 * If it exists and is non-empty, throw DirExistsError.
 */
export async function ensureOutputDir(dir: string): Promise<void> {
  try {
    const stat = await fs.promises.stat(dir);
    if (stat.isDirectory()) {
      const entries = await fs.promises.readdir(dir);
      if (entries.length > 0) {
        throw new DirExistsError(`目录 ${dir} 已存在且非空`);
      }
    } else if (stat.isFile()) {
      throw new DirExistsError(`文件 ${dir} 已存在`);
    }
  } catch (err) {
    if (err instanceof DirExistsError) throw err;
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Directory does not exist — fine
      return;
    }
    throw err;
  }
}

/**
 * Create an AbortController for timeout management.
 * The actual timeout is set by the caller via setTimeout.
 */
export function setupAbortController(): AbortController {
  return new AbortController();
}

/**
 * Register a SIGINT handler that cleans up the temp directory and exits.
 * Returns a function to unregister the handler.
 */
export function handleInterrupt(tempDir: string): () => void {
  const handler = () => {
    console.error('\nreceived SIGINT, cleaning up...');
    cleanupTempDir(tempDir).catch(() => {
      // Silently ignore cleanup errors during interrupt
    });
    process.exit(130);
  };

  process.on('SIGINT', handler);
  return () => {
    process.off('SIGINT', handler);
  };
}
