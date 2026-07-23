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
  trailingSlash: boolean;
  expandMode: boolean;
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
 *
 * Behaviour is determined at runtime via fs.stat:
 * - File: always placed directly into localDir (trailingSlash has no effect).
 * - Directory:
 *   - expandMode=true → flatten contents into localDir
 *   - trailingSlash=true → wrap contents in localDir/<basename>
 *   - otherwise → replace mode: contents go directly into localDir
 * - Root (./ or .): copy all entries, skip .git.
 */
export async function copyOutput(
  workDir: string,
  gitDir: string,
  localDir: string,
  trailingSlash = false,
  expandMode = false,
): Promise<void> {
  // Create localDir as a directory
  await fs.promises.mkdir(localDir, { recursive: true });

  if (gitDir === './' || gitDir === '.') {
    // Root copy: copy each entry except .git
    const srcDir = workDir;
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const srcEntry = path.join(srcDir, entry.name);
      const destEntry = path.join(localDir, entry.name);
      await fs.promises.cp(srcEntry, destEntry, { recursive: true, force: true });
    }
    return;
  }

  const srcPath = path.join(workDir, gitDir);
  const srcStat = await fs.promises.stat(srcPath);

  if (srcStat.isFile()) {
    // File: always placed into localDir (no container semantics for files)
    const destFile = path.join(localDir, path.basename(srcPath));
    await fs.promises.cp(srcPath, destFile, { force: true });
    return;
  }

  // Directory:
  //   expandMode flattens contents; trailingSlash wraps in a subdirectory
  let destPath: string;
  if (expandMode) {
    destPath = localDir;
  } else if (trailingSlash) {
    destPath = path.join(localDir, path.basename(gitDir));
  } else {
    destPath = localDir;
  }

  await fs.promises.mkdir(destPath, { recursive: true });
  const entries = await fs.promises.readdir(srcPath);
  for (const entry of entries) {
    const srcEntry = path.join(srcPath, entry);
    const destEntry = path.join(destPath, entry);
    await fs.promises.cp(srcEntry, destEntry, { recursive: true, force: true });
  }
}

/**
 * Scan the first-level entries of sourceDir and return those that already exist
 * in targetDir. Returns an empty array when targetDir doesn't exist (fast path).
 * Directory names are suffixed with '/' to distinguish from files.
 */
export async function getFirstLevelConflicts(sourceDir: string, targetDir: string): Promise<string[]> {
  const conflicts: string[] = [];

  // Fast path: targetDir doesn't exist → no conflicts
  try {
    await fs.promises.stat(targetDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  try {
    const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      const targetPath = path.join(targetDir, entry.name);
      try {
        await fs.promises.stat(targetPath);
        conflicts.push(entry.name + (entry.isDirectory() ? '/' : ''));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        // Not found → no conflict
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // sourceDir doesn't exist yet — edge case, no conflicts
      return [];
    }
    throw err;
  }

  return conflicts;
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
  const { gitUrl, gitDir, localDir, branch, quiet, signal, workDir, trailingSlash, expandMode } = options;

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
        throw new Error(`目录 "${gitDir}" 在仓库中不存在`, { cause: err });
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

}
