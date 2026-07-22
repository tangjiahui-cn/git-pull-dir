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
  localDir?: string;
  branch: string;
  quiet: boolean;
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
    program.parse(argv);
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

  return {
    gitUrl,
    gitDir,
    localDir,
    branch: options.branch || 'main',
    quiet: !!options.quiet,
  };
}
