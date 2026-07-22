/**
 * git-pull-dir — Git sparse-checkout core logic
 */

import { execa, type ExecaError } from 'execa';
import fs from 'node:fs';
import path from 'node:path';
import { GitNotInstalledError, RemoteUnreachableError, TimeoutError } from './errors.js';

/**
 * Options for the sparse clone operation.
 */
export interface CloneOptions {
  gitUrl: string;
  gitDir: string;
  localDir: string;
  branch: string;
  quiet: boolean;
  signal?: AbortSignal;
}

/**
 * Build the initial git clone command arguments.
 */
export function buildCloneCmd(workDir: string): string[] {
  return [
    'clone',
    '--filter=blob:none',
    '--no-checkout',
    '--',       // End of options — prevents URL starting with - from being parsed as a flag
    '{{URL}}',
    workDir,
  ];
}

/**
 * Build the sparse-checkout init and set command arguments.
 */
export function buildSparseCheckoutCmd(gitDir: string): string[][] {
  return [
    ['sparse-checkout', 'init', '--cone'],
    ['sparse-checkout', 'set', gitDir],
  ];
}

/**
 * Build the checkout command arguments.
 */
export function buildCheckoutCmd(branch: string): string[] {
  return ['checkout', branch];
}

/**
 * Copy files from the cloned sparse worktree to the final local directory.
 */
export async function copyOutput(
  workDir: string,
  gitDir: string,
  localDir: string,
): Promise<void> {
  const srcPath = gitDir === './' || gitDir === '.'
    ? workDir
    : path.join(workDir, gitDir);

  // Ensure parent directory of localDir exists
  await fs.promises.mkdir(path.dirname(localDir), { recursive: true });

  // Copy recursively
  await fs.promises.cp(srcPath, localDir, { recursive: true, force: true });
}

/**
 * Check that Git is installed and its version is >= 2.25.
 */
export async function validateGitVersion(): Promise<boolean> {
  try {
    const { stdout } = await execa('git', ['--version']);
    const match = stdout.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return false;

    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);

    // Git >= 2.25 required for sparse-checkout
    return major > 2 || (major === 2 && minor >= 25);
  } catch {
    return false;
  }
}

/**
 * Perform a sparse clone: clone without checkout, init sparse-checkout,
 * set the target directory, then checkout the branch.
 */
export async function sparseClone(options: CloneOptions): Promise<void> {
  const { gitUrl, gitDir, localDir, branch, quiet, signal } = options;

  // Step 1: Validate Git version
  const gitOk = await validateGitVersion();
  if (!gitOk) {
    throw new GitNotInstalledError(
      'Git >= 2.25 is required. Please install or upgrade Git.',
    );
  }

  // Step 2: Create temp working directory
  // (Temp dir is managed externally — we just need the path)
  const workDir = path.dirname(localDir);

  if (!quiet) {
    console.log('clone in...');
  }

  // Step 3: Clone with partial clone filter
  try {
    const cloneArgs = buildCloneCmd(workDir);
    // Replace placeholder with actual URL
    cloneArgs[cloneArgs.indexOf('{{URL}}')] = gitUrl;

    await execa('git', cloneArgs, {
      signal,
      timeout: 180_000,
    });
  } catch (err) {
    const execaErr = err as ExecaError;
    if (execaErr.timedOut || (signal && signal.aborted)) {
      throw new TimeoutError('拉取超时：操作超过3分钟限制');
    }
    if (execaErr.exitCode === 128 || execaErr.stderr?.includes('Could not read')) {
      throw new RemoteUnreachableError(
        `无法访问远程仓库：${gitUrl}\n${execaErr.stderr?.trim() || execaErr.message}`,
      );
    }
    throw err;
  }

  if (!quiet) {
    console.log('setting sparse-checkout...');
  }

  // Step 4: Init and set sparse-checkout
  const sparseSteps = buildSparseCheckoutCmd(gitDir);
  for (const args of sparseSteps) {
    try {
      await execa('git', ['-C', workDir, ...args], {
        signal,
        timeout: 60_000,
      });
    } catch (err) {
      const execaErr = err as ExecaError;
      if (execaErr.stderr?.includes('not a valid directory')) {
        throw new Error(`目录 "${gitDir}" 在仓库中不存在`);
      }
      throw err;
    }
  }

  if (!quiet) {
    console.log('checkout...');
  }

  // Step 5: Checkout the branch
  try {
    await execa('git', ['-C', workDir, ...buildCheckoutCmd(branch)], {
      signal,
      timeout: 180_000,
    });
  } catch (err) {
    const execaErr = err as ExecaError;
    if (execaErr.timedOut || (signal && signal.aborted)) {
      throw new TimeoutError('拉取超时：操作超过3分钟限制');
    }
    // If the branch doesn't exist, try 'master' as fallback
    if (execaErr.stderr?.includes('pathspec') || execaErr.exitCode === 1) {
      // Branch not found — try master
      try {
        await execa('git', ['-C', workDir, 'checkout', 'master'], {
          signal,
          timeout: 180_000,
        });
      } catch {
        throw new Error(`分支 "${branch}" 不存在，且 "master" 也不存在`);
      }
    } else {
      throw err;
    }
  }
}
