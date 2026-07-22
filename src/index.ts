#!/usr/bin/env node

/**
 * git-pull-dir — Entry point
 *
 * Orchestrates the full workflow:
 *   parse args → validate → sparse clone → cleanup → output
 */

import { parseArgs, type CliOptions } from './cli.js';
import { sparseClone } from './clone.js';
import {
  createTempDir,
  cleanupTempDir,
  getLocalDirName,
  ensureOutputDir,
  promptOverwrite,
  setupAbortController,
  handleInterrupt,
} from './utils.js';
import {
  GitPullDirError,
  DirExistsError,
  CancelError,
  DiskSpaceError,
  TimeoutError,
} from './errors.js';
import { execa } from 'execa';

/**
 * Main entry function.
 */
async function main(): Promise<void> {
  let tempDir = '';
  let removeInterrupt: (() => void) | null = null;

  try {
    // 1. Parse CLI arguments
    const options: CliOptions = parseArgs(process.argv.slice(2));
    const localDir = getLocalDirName(options.gitDir, options.localDir);

    // 2. Validate Git availability (basic check)
    try {
      await execa('git', ['--version'], { timeout: 5000 });
    } catch {
      throw new GitPullDirError(
        'Git 未安装或无法执行。请安装 Git >= 2.25.0。',
      );
    }

    // 3. Check if output directory already exists
    try {
      await ensureOutputDir(localDir);
    } catch (err) {
      if (err instanceof DirExistsError) {
        const shouldOverwrite = await promptOverwrite(localDir);
        if (!shouldOverwrite) {
          console.log('cancelled');
          process.exit(0);
        }
        // Remove the existing directory before proceeding
        await cleanupTempDir(localDir);
      } else {
        throw err;
      }
    }

    // 4. Create temporary working directory
    tempDir = await createTempDir();

    // 5. Register SIGINT handler
    removeInterrupt = handleInterrupt(tempDir);

    // 6. Create global AbortController (3-minute timeout)
    const controller = setupAbortController();

    // 7. Execute the timeout — auto-abort after 3 minutes
    const timeoutId = setTimeout(() => controller.abort(), 180_000);

    try {
      // 8. Perform sparse clone into tempDir, then copy to localDir
      await sparseClone({
        gitUrl: options.gitUrl,
        gitDir: options.gitDir,
        localDir,
        branch: options.branch,
        quiet: options.quiet,
        signal: controller.signal,
        workDir: tempDir,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // 9. Clean up temp directory
    await cleanupTempDir(tempDir);
    tempDir = '';

    // 10. Remove SIGINT handler
    if (removeInterrupt) {
      removeInterrupt();
      removeInterrupt = null;
    }

    // 11. Output success
    console.log(`save at ${localDir}`);
    process.exit(0);
  } catch (err) {
    // Clean up temp directory on error
    if (tempDir) {
      await cleanupTempDir(tempDir).catch(() => {});
    }

    if (removeInterrupt) {
      removeInterrupt();
    }

    if (err instanceof GitPullDirError) {
      if (err instanceof CancelError) {
        console.error(err.message);
        process.exit(130);
      } else if (err instanceof DirExistsError) {
        console.error(err.message);
        process.exit(0);
      } else {
        console.error(err.message);
        process.exit(err.exitCode);
      }
    } else if (err instanceof Error) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOSPC') {
        console.error('磁盘空间不足，无法完成操作。');
        process.exit(1);
      }
      console.error(`意外错误：${err.message}`);
      process.exit(1);
    } else {
      console.error('发生未知错误');
      process.exit(1);
    }
  }
}

main();
