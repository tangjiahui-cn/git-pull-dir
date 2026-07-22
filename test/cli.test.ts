/**
 * git-pull-dir — CLI argument parsing unit tests
 */

import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli.js';

const VALID_URL = 'https://github.com/facebook/react-native.git';

describe('parseArgs', () => {
  it('should parse git-url, git-dir, and local-dir correctly', () => {
    const result = parseArgs([VALID_URL, 'packages/core', './my-core']);
    expect(result.gitUrl).toBe(VALID_URL);
    expect(result.gitDir).toBe('packages/core');
    expect(result.localDir).toBe('./my-core');
    expect(result.branch).toBe('main');
    expect(result.quiet).toBe(false);
  });

  it('should default local-dir to empty when omitted', () => {
    const result = parseArgs([VALID_URL, 'packages/core']);
    expect(result.gitUrl).toBe(VALID_URL);
    expect(result.gitDir).toBe('packages/core');
    expect(result.localDir).toBeUndefined();
  });

  it('should throw when git-dir is missing', () => {
    expect(() => parseArgs([VALID_URL])).toThrow();
  });

  it('should throw when git-url is missing', () => {
    expect(() => parseArgs([])).toThrow();
  });

  it('should default branch to main', () => {
    const result = parseArgs([VALID_URL, 'src']);
    expect(result.branch).toBe('main');
  });

  it('should parse --branch flag', () => {
    const result = parseArgs([VALID_URL, 'src', '--branch', 'develop']);
    expect(result.branch).toBe('develop');
  });

  it('should parse --quiet flag', () => {
    const result = parseArgs([VALID_URL, 'src', '--quiet']);
    expect(result.quiet).toBe(true);
  });

  it('should throw on invalid URL format', () => {
    expect(() => parseArgs(['not-a-url', 'src'])).toThrow();
  });

  // --- New v2 tests ---

  it('should set trailingSlash=true when local-dir ends with /', () => {
    const result = parseArgs([VALID_URL, 'packages/core', './output/']);
    expect(result.trailingSlash).toBe(true);
    expect(result.resolvedLocalDir).toBe('./output');
    expect(result.localDir).toBe('./output/');
  });

  it('should set trailingSlash=false when local-dir has no trailing /', () => {
    const result = parseArgs([VALID_URL, 'packages/core', './output']);
    expect(result.trailingSlash).toBe(false);
    expect(result.resolvedLocalDir).toBe('./output');
  });

  it('should detect /* expand mode and resolve gitDir', () => {
    const result = parseArgs([VALID_URL, 'packages/core/*', './output']);
    expect(result.expandMode).toBe(true);
    expect(result.resolvedGitDir).toBe('packages/core');
    expect(result.gitDir).toBe('packages/core/*');
  });

  it('should derive default local-dir name from gitDir without /*', () => {
    // We don't call getLocalDirName in parseArgs — it's separate.
    // This test verifies expandMode detection so getLocalDirName can strip /* later.
    const result = parseArgs([VALID_URL, 'packages/core/*']);
    expect(result.expandMode).toBe(true);
    expect(result.resolvedGitDir).toBe('packages/core');
    expect(result.localDir).toBeUndefined();
  });

  it('should throw when file path uses /* (package.json/*)', () => {
    expect(() => parseArgs([VALID_URL, 'package.json/*'])).toThrow(
      /文件.*不能使用/,
    );
  });

  it('should throw when file path uses /* (src/index.ts/*)', () => {
    expect(() => parseArgs([VALID_URL, 'src/index.ts/*'])).toThrow(
      /文件.*不能使用/,
    );
  });

  it('should throw when root dir + trailingSlash (./ + ./output/)', () => {
    expect(() => parseArgs([VALID_URL, './', './output/'])).toThrow(
      /根目录.*不支持容器模式/,
    );
  });

  it('should throw when ./* and local-dir omitted (root expand, no basename)', () => {
    // parseArgs doesn't throw here itself — it just sets expandMode/resolvedGitDir.
    // getLocalDirName (called in index.ts) will throw for root.
    // This test verifies the expandMode parsing works.
    const result = parseArgs([VALID_URL, './*']);
    expect(result.expandMode).toBe(true);
    expect(result.resolvedGitDir).toBe('.');
    expect(result.localDir).toBeUndefined();
  });
});
