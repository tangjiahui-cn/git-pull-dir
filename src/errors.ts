/**
 * git-pull-dir — Custom error types
 */

/**
 * Base error class for all git-pull-dir errors.
 */
export class GitPullDirError extends Error {
  public readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'GitPullDirError';
    this.exitCode = exitCode;
  }
}

/**
 * Git is not installed or version is too old (< 2.25).
 */
export class GitNotInstalledError extends GitPullDirError {
  constructor(message: string) {
    super(message, 1);
    this.name = 'GitNotInstalledError';
  }
}

/**
 * CLI arguments are missing or invalid.
 */
export class InvalidArgumentError extends GitPullDirError {
  constructor(message: string) {
    super(message, 1);
    this.name = 'InvalidArgumentError';
  }
}

/**
 * Remote repository is unreachable.
 */
export class RemoteUnreachableError extends GitPullDirError {
  constructor(message: string) {
    super(message, 1);
    this.name = 'RemoteUnreachableError';
  }
}

/**
 * Specified directory does not exist in the remote repository.
 */
export class DirNotFoundError extends GitPullDirError {
  constructor(message: string) {
    super(message, 1);
    this.name = 'DirNotFoundError';
  }
}

/**
 * Local directory already exists and is non-empty.
 * This is a non-fatal error — after interactive handling, exit code is 0.
 */
export class DirExistsError extends GitPullDirError {
  constructor(message: string) {
    super(message, 0);
    this.name = 'DirExistsError';
  }
}

/**
 * Operation timed out (3-minute global timeout).
 */
export class TimeoutError extends GitPullDirError {
  constructor(message: string) {
    super(message, 1);
    this.name = 'TimeoutError';
  }
}

/**
 * Not enough disk space.
 */
export class DiskSpaceError extends GitPullDirError {
  constructor(message: string) {
    super(message, 1);
    this.name = 'DiskSpaceError';
  }
}

/**
 * User cancelled the operation (Ctrl+C).
 */
export class CancelError extends GitPullDirError {
  constructor(message: string) {
    super(message, 130);
    this.name = 'CancelError';
  }
}
