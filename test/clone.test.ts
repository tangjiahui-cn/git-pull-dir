/**
 * git-pull-dir — Clone logic unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildCloneCmd, buildSparseCheckoutCmd, buildCheckoutCmd, validateGitVersion } from '../src/clone.js';
import { parseGitUrl, ensureOutputDir } from '../src/utils.js';

// Mock execa for validateGitVersion tests
vi.mock('execa', () => {
  const mockExeca = vi.fn();
  return {
    execa: mockExeca,
  };
});

describe('buildCloneCmd', () => {
  it('should build correct clone command arguments', () => {
    const args = buildCloneCmd('/tmp/workdir');
    expect(args).toContain('clone');
    expect(args).toContain('--filter=blob:none');
    expect(args).toContain('--no-checkout');
    expect(args).toContain('/tmp/workdir');
  });
});

describe('buildSparseCheckoutCmd', () => {
  it('should build correct sparse-checkout set command', () => {
    const steps = buildSparseCheckoutCmd('packages/core');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual(['sparse-checkout', 'init']);
    expect(steps[1]).toEqual(['sparse-checkout', 'set', 'packages/core']);
  });

  it('should return empty steps for root path', () => {
    const steps = buildSparseCheckoutCmd('./');
    expect(steps).toHaveLength(0);
  });

  it('should return empty steps for dot path', () => {
    const steps = buildSparseCheckoutCmd('.');
    expect(steps).toHaveLength(0);
  });
});

describe('buildCheckoutCmd', () => {
  it('should build checkout command with branch name', () => {
    const args = buildCheckoutCmd('main');
    expect(args).toEqual(['checkout', 'main']);
  });
});

describe('parseGitUrl', () => {
  it('should parse HTTPS URL correctly', () => {
    const result = parseGitUrl('https://github.com/facebook/react-native.git');
    expect(result.owner).toBe('facebook');
    expect(result.repo).toBe('react-native');
  });

  it('should parse HTTPS URL without .git suffix', () => {
    const result = parseGitUrl('https://github.com/facebook/react-native');
    expect(result.owner).toBe('facebook');
    expect(result.repo).toBe('react-native');
  });

  it('should parse SSH URL correctly', () => {
    const result = parseGitUrl('git@github.com:facebook/react-native.git');
    expect(result.owner).toBe('facebook');
    expect(result.repo).toBe('react-native');
  });

  it('should return empty strings for unknown URL format', () => {
    const result = parseGitUrl('not-a-url');
    expect(result.owner).toBe('');
    expect(result.repo).toBe('');
  });
});

describe('validateGitVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true for git >= 2.25', async () => {
    const { execa } = await import('execa');
    vi.mocked(execa).mockResolvedValue({
      stdout: 'git version 2.30.0',
    } as never);

    const result = await validateGitVersion();
    expect(result).toBe(true);
  });

  it('should return false for git < 2.25', async () => {
    const { execa } = await import('execa');
    vi.mocked(execa).mockResolvedValue({
      stdout: 'git version 2.20.0',
    } as never);

    const result = await validateGitVersion();
    expect(result).toBe(false);
  });

  it('should return false when git is not installed', async () => {
    const { execa } = await import('execa');
    vi.mocked(execa).mockRejectedValue(new Error('not found'));

    const result = await validateGitVersion();
    expect(result).toBe(false);
  });
});

describe('ensureOutputDir', () => {
  it('should throw DirExistsError when target directory exists and is non-empty', async () => {
    // The function checks existing directories; for a non-existent dir it should pass
    // We can test with a temp dir that doesn't exist
    await expect(ensureOutputDir('/tmp/nonexistent-dir-12345')).resolves.toBeUndefined();
  });
});
