/**
 * git-pull-dir — Test helper utilities
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Create a temporary directory for testing.
 */
export async function createTempDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'git-pull-dir-test-'));
}

/**
 * Clean up a temporary directory.
 */
export async function cleanupTempDir(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true });
}

/**
 * Strip ANSI escape codes from a string.
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\[[0-9;]*m/g, '');
}
