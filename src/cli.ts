/**
 * git-pull-dir — CLI argument parsing
 */

import { Command } from 'commander';
import { validateUrl } from './utils.js';
import { InvalidArgumentError } from './errors.js';

/**
 * Parsed CLI options.
 */
export interface CliOptions {
  gitUrl: string;
  gitDir: string;
  resolvedGitDir: string;
  localDir?: string;
  resolvedLocalDir?: string;
  trailingSlash: boolean;
  expandMode: boolean;
  branch: string;
  quiet: boolean;
}

/**
 * Heuristic check: does the last path segment look like a file (has extension)?
 * e.g. "package.json" → true, "packages/core" → false, "src/index.ts" → true.
 * Known limitation: dot-directories like ".config", ".vscode" are misidentified as files.
 */
function isFilePath(pathStr: string): boolean {
  const lastSegment = pathStr.split('/').filter(Boolean).pop() || '';
  return /\.\w+$/.test(lastSegment);
}

/**
 * Parse command-line arguments and return structured options.
 * Exits with code 1 on validation failure.
 */
export function parseArgs(argv: string[]): CliOptions {
  const program = new Command();

  program
    .name('git-pull-dir')
    .description('Clone only a specific directory from a git repository using sparse-checkout')
    .version('0.1.0')
    .argument('<git-url>', 'Remote Git repository URL (HTTPS or SSH)')
    .argument('<git-dir>', 'Directory path within the repository to clone')
    .argument('[local-dir]', 'Local output directory (defaults to last segment of git-dir)')
    .option('--branch <name>', 'Branch to checkout', 'main')
    .option('--quiet', 'Quiet mode — hide step details')
    .exitOverride();

  try {
    program.parse(argv, { from: 'user' });
  } catch {
    // Commander already printed the error/help
    process.exit(1);
  }

  const args = program.args;
  const options = program.opts();

  if (args.length < 1) {
    throw new InvalidArgumentError('Missing required argument: <git-url>');
  }
  if (args.length < 2) {
    throw new InvalidArgumentError('Missing required argument: <git-dir>');
  }

  const gitUrl = args[0];
  const gitDir = args[1];
  const localDir = args[2];

  // Validate git-url format
  if (!validateUrl(gitUrl)) {
    throw new InvalidArgumentError(
      `Invalid Git URL format: "${gitUrl}". Expected HTTPS (https://...) or SSH (git@...) URL.`,
    );
  }

  // Validate git-dir is non-empty
  if (!gitDir || gitDir.trim() === '') {
    throw new InvalidArgumentError('<git-dir> cannot be empty');
  }

  // --- Detect /* expand mode ---
  let expandMode = false;
  let resolvedGitDir = gitDir;

  if (gitDir.endsWith('/*')) {
    const pathPart = gitDir.slice(0, -2);
    if (isFilePath(pathPart)) {
      throw new InvalidArgumentError(
        `"${gitDir}" 格式错误 —— "${pathPart}" 是一个文件，不能使用 /* 进行展开。\n` +
        `请使用目录路径，例如：\n` +
        `  npx . <url> src/*\n` +
        `  npx . <url> packages/core/*`,
      );
    }
    resolvedGitDir = pathPart;
    expandMode = true;
  }

  // --- Detect trailing / on local-dir ---
  let trailingSlash = false;
  let resolvedLocalDir: string | undefined;

  if (localDir) {
    trailingSlash = localDir.endsWith('/');
    resolvedLocalDir = localDir.replace(/\/+$/, '');

    // Root dir does not support container mode (no meaningful basename)
    if (trailingSlash && !expandMode && (gitDir === './' || gitDir === '.')) {
      throw new InvalidArgumentError(
        '根目录 (./ 或 .) 不支持容器模式（尾部 /），因为无法确定子目录名称。\n' +
        '请去掉 local-dir 尾部 / 或指定明确的 git-dir。',
      );
    }
  }

  return {
    gitUrl,
    gitDir,
    resolvedGitDir,
    localDir,
    resolvedLocalDir,
    trailingSlash,
    expandMode,
    branch: options.branch || 'main',
    quiet: !!options.quiet,
  };
}
