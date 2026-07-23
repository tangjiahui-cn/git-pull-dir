#!/usr/bin/env node

/**
 * git-pull-dir — Entry point
 *
 * Orchestrates the full workflow:
 *   parse args → validate → sparse clone → cleanup → output
 */

import { parseArgs, isFilePath, type CliOptions } from './cli.js';
import { sparseClone, getFirstLevelConflicts, copyOutput } from './clone.js';
import {
  createTempDir,
  cleanupTempDir,
  getLocalDirName,
  ensureOutputDir,
  computeEffectiveDir,
  promptOverwrite,
  setupAbortController,
  handleInterrupt,
  promptConflictOverwrite,
  promptReplaceFile,
} from './utils.js';
import {
  GitPullDirError,
  DirExistsError,
  CancelError,
} from './errors.js';
import fs from 'node:fs';
import path from 'node:path';
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

    // 3. Compute effective output directory
    const resolvedLocalDir = options.resolvedLocalDir ?? localDir;
    const effectiveDir = computeEffectiveDir(
      resolvedLocalDir,
      options.resolvedGitDir,
      options.trailingSlash,
      options.expandMode,
    );

    // ───────────── 目录模式：clone 前检查（避免无效 clone） ─────────────
    if (!options.expandMode && !isFilePath(options.resolvedGitDir)) {
      try {
        await ensureOutputDir(effectiveDir);
      } catch (err) {
        if (err instanceof DirExistsError) {
          if (!options.force) {
            const shouldOverwrite = await promptOverwrite(effectiveDir);
            if (!shouldOverwrite) {
              console.log('cancelled');
              process.exit(0);
            }
          }
          // Remove the existing directory before proceeding
          await cleanupTempDir(effectiveDir);
        } else {
          throw err;
        }
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
      // 8. Perform sparse clone into tempDir (clone only, copy is handled below by mode)
      await sparseClone({
        gitUrl: options.gitUrl,
        gitDir: options.resolvedGitDir,
        localDir: resolvedLocalDir,
        branch: options.branch,
        quiet: options.quiet,
        signal: controller.signal,
        workDir: tempDir,
        trailingSlash: options.trailingSlash,
        expandMode: options.expandMode,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // ───────────── 展开模式：clone 后第一层冲突检测 ─────────────
    if (options.expandMode) {
      const sourceDir = path.join(tempDir, options.resolvedGitDir);
      const conflicts = await getFirstLevelConflicts(sourceDir, effectiveDir);

      if (conflicts.length > 0) {
        if (!options.force) {
          const shouldOverwrite = await promptConflictOverwrite(effectiveDir, conflicts);
          if (!shouldOverwrite) {
            console.log('cancelled');
            process.exit(0);
          }
        }
        // force or yes → copyOutput with force:true overwrites conflicts
      }

      await copyOutput(tempDir, options.resolvedGitDir, resolvedLocalDir, options.trailingSlash, options.expandMode);
    } else if (isFilePath(options.resolvedGitDir)) {
      // ───────────── 文件模式：clone 后目标文件存在性检查 ─────────────
      const destFile = path.join(resolvedLocalDir, path.basename(options.resolvedGitDir));
      try {
        await fs.promises.stat(destFile);
        // File or directory exists at target path
        if (!options.force) {
          const shouldReplace = await promptReplaceFile(destFile);
          if (!shouldReplace) {
            console.log('cancelled');
            process.exit(0);
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        // File doesn't exist → no conflict, proceed to copy
      }

      await copyOutput(tempDir, options.resolvedGitDir, resolvedLocalDir, options.trailingSlash, options.expandMode);
    } else {
      // ───────────── 目录模式：clone 前已检查，直接复制 ─────────────
      await copyOutput(tempDir, options.resolvedGitDir, resolvedLocalDir, options.trailingSlash, options.expandMode);
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
    console.log(`save at ${effectiveDir}`);
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
