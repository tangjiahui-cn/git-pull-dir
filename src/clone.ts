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
  workDir: string;
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
 * For root (./ or .), skip sparse-checkout entirely and do a full checkout.
 * For other paths, use non-cone mode to support both files and directories.
 */
export function buildSparseCheckoutCmd(gitDir: string): string[][] {
  if (gitDir === './' || gitDir === '.') {
    // Root: skip sparse-checkout, do full checkout
    return [];
  }
  return [
    ['sparse-checkout', 'init'],  // non-cone mode (supports files)
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

  // Create localDir as a directory
  await fs.promises.mkdir(localDir, { recursive: true });

  if (gitDir === './' || gitDir === '.') {
    // Root copy: copy each entry except .git
    const entries = await fs.promises.readdir(workDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const srcEntry = path.join(workDir, entry.name);
      const destEntry = path.join(localDir, entry.name);
      await fs.promises.cp(srcEntry, destEntry, { recursive: true, force: true });
    }
  } else {
    // Check if srcPath is a file or directory
    const srcStat = await fs.promises.stat(srcPath);
    if (srcStat.isFile()) {
      // Single file: copy into the localDir
      const destFile = path.join(localDir, path.basename(srcPath));
      await fs.promises.cp(srcPath, destFile, { force: true });
    } else {
      // Directory: copy contents into localDir
      const entries = await fs.promises.readdir(srcPath);
      for (const entry of entries) {
        const srcEntry = path.join(srcPath, entry);
        const destEntry = path.join(localDir, entry);
        await fs.promises.cp(srcEntry, destEntry, { recursive: true, force: true });
      }
    }
  }
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
  const { gitUrl, gitDir, localDir, branch, quiet, signal, workDir } = options;

  // Step 1: Validate Git version
  const gitOk = await validateGitVersion();
  if (!gitOk) {
    throw new GitNotInstalledError(
      'Git >= 2.25 is required. Please install or upgrade Git.',
    );
  }

  if (!quiet) {
    console.log('clone in...');
  }

  // Step 2: Clone with partial clone filter into workDir
  try {
    const cloneArgs = buildCloneCmd(workDir);
    // Replace placeholder with actual URL
    cloneArgs[cloneArgs.indexOf('{{URL}}')] = gitUrl;

    await execa('git', cloneArgs, {
      cancelSignal: signal,
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
        cancelSignal: signal,
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
      cancelSignal: signal,
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
          cancelSignal: signal,
          timeout: 180_000,
        });
      } catch {
        throw new Error(`分支 "${branch}" 不存在，且 "master" 也不存在`);
      }
    } else {
      throw err;
    }
  }

  // Step 6: Copy files from workDir/gitDir to localDir
  await copyOutput(workDir, gitDir, localDir);
}
