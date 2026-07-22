/**
 * git-pull-dir — CLI argument parsing unit tests
 */

import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli.js';

const VALID_URL = 'https://github.com/facebook/react-native.git';

describe('parseArgs', () => {
  it('should parse git-url, git-dir, and local-dir correctly', () => {
    const result = parseArgs(['node', 'index.js', VALID_URL, 'packages/core', './my-core']);
    expect(result.gitUrl).toBe(VALID_URL);
    expect(result.gitDir).toBe('packages/core');
    expect(result.localDir).toBe('./my-core');
    expect(result.branch).toBe('main');
    expect(result.quiet).toBe(false);
  });

  it('should default local-dir to empty when omitted', () => {
    const result = parseArgs(['node', 'index.js', VALID_URL, 'packages/core']);
    expect(result.gitUrl).toBe(VALID_URL);
    expect(result.gitDir).toBe('packages/core');
    expect(result.localDir).toBeUndefined();
  });

  it('should throw when git-dir is missing', () => {
    expect(() => parseArgs(['node', 'index.js', VALID_URL])).toThrow();
  });

  it('should throw when git-url is missing', () => {
    expect(() => parseArgs(['node', 'index.js'])).toThrow();
  });

  it('should default branch to main', () => {
    const result = parseArgs(['node', 'index.js', VALID_URL, 'src']);
    expect(result.branch).toBe('main');
  });

  it('should parse --branch flag', () => {
    const result = parseArgs(['node', 'index.js', VALID_URL, 'src', '--branch', 'develop']);
    expect(result.branch).toBe('develop');
  });

  it('should parse --quiet flag', () => {
    const result = parseArgs(['node', 'index.js', VALID_URL, 'src', '--quiet']);
    expect(result.quiet).toBe(true);
  });

  it('should throw on invalid URL format', () => {
    expect(() => parseArgs(['node', 'index.js', 'not-a-url', 'src'])).toThrow();
  });
});
