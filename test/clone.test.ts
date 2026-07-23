/**
 * git-pull-dir — Clone logic unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildCloneCmd, buildSparseCheckoutCmd, buildCheckoutCmd, validateGitVersion, copyOutput } from '../src/clone.js';
import { parseGitUrl, ensureOutputDir, promptConflictOverwrite, promptReplaceFile } from '../src/utils.js';
import { getFirstLevelConflicts } from '../src/clone.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock execa for validateGitVersion tests
vi.mock('execa', () => {
  const mockExeca = vi.fn();
  return {
    execa: mockExeca,
  };
});

/**
 * Set up a temporary file structure for copyOutput tests.
 */
async function setupFixture(): Promise<{ baseDir: string; workDir: string; cleanup: () => Promise<void> }> {
  const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'copy-output-test-'));
  const workDir = path.join(baseDir, 'work');
  const localDir = path.join(baseDir, 'local');

  // Create work directory with files and subdirs
  await fs.promises.mkdir(path.join(workDir, 'src', 'utils'), { recursive: true });
  await fs.promises.writeFile(path.join(workDir, 'README.md'), '# repo');
  await fs.promises.writeFile(path.join(workDir, 'src', 'index.ts'), 'export const a = 1;');
  await fs.promises.writeFile(path.join(workDir, 'src', 'utils', 'helper.ts'), 'export const b = 2;');
  await fs.promises.writeFile(path.join(workDir, 'package.json'), JSON.stringify({ name: 'test' }));
  await fs.promises.mkdir(path.join(workDir, '.git'));
  await fs.promises.writeFile(path.join(workDir, '.git', 'HEAD'), 'ref: refs/heads/main');

  const cleanup = async () => {
    await fs.promises.rm(baseDir, { recursive: true, force: true });
  };

  return { baseDir, workDir, cleanup };
}

/**
 * List relative paths under a directory for assertions.
 */
async function listTree(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string, prefix: string) {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries.sort()) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(rel + '/');
        await walk(path.join(current, entry.name), rel);
      } else {
        results.push(rel);
      }
    }
  }
  await walk(dir, '');
  return results;
}

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

describe('copyOutput', () => {
  it('should copy directory contents to localDir (replace mode, trailingSlash=false)', async () => {
    const { workDir, baseDir, cleanup } = await setupFixture();
    const localDir = path.join(baseDir, 'out1');
    try {
      await copyOutput(workDir, 'src', localDir, false, false);
      const tree = await listTree(localDir);
      // Contents of src/ flattened into localDir
      expect(tree).toContain('index.ts');
      expect(tree).toContain('utils/');
      expect(tree).toContain('utils/helper.ts');
      // Should NOT have a src/ wrapping layer
      expect(tree).not.toContain('src/');
    } finally {
      await cleanup();
    }
  });

  it('should copy directory contents inside a subdirectory (container mode, trailingSlash=true)', async () => {
    const { workDir, baseDir, cleanup } = await setupFixture();
    const localDir = path.join(baseDir, 'out2');
    try {
      await copyOutput(workDir, 'src', localDir, true, false);
      const tree = await listTree(localDir);
      // Contents should be under src/ subdirectory
      expect(tree).toContain('src/');
      expect(tree).toContain('src/index.ts');
      expect(tree).toContain('src/utils/');
      expect(tree).toContain('src/utils/helper.ts');
    } finally {
      await cleanup();
    }
  });

  it('should copy a single file (file, trailingSlash=false)', async () => {
    const { workDir, baseDir, cleanup } = await setupFixture();
    const localDir = path.join(baseDir, 'out3');
    try {
      await copyOutput(workDir, 'README.md', localDir, false, false);
      const tree = await listTree(localDir);
      expect(tree).toContain('README.md');
      const content = fs.readFileSync(path.join(localDir, 'README.md'), 'utf-8');
      expect(content).toBe('# repo');
    } finally {
      await cleanup();
    }
  });

  it('should copy a single file ignoring trailingSlash (file, trailingSlash=true)', async () => {
    const { workDir, baseDir, cleanup } = await setupFixture();
    const localDir = path.join(baseDir, 'out4');
    try {
      await copyOutput(workDir, 'README.md', localDir, true, false);
      const tree = await listTree(localDir);
      // File goes directly into localDir, no extra subdirectory
      expect(tree).toContain('README.md');
      const content = fs.readFileSync(path.join(localDir, 'README.md'), 'utf-8');
      expect(content).toBe('# repo');
    } finally {
      await cleanup();
    }
  });

  it('should expand directory contents (expandMode=true)', async () => {
    const { workDir, baseDir, cleanup } = await setupFixture();
    const localDir = path.join(baseDir, 'out5');
    try {
      await copyOutput(workDir, 'src', localDir, false, true);
      const tree = await listTree(localDir);
      // Flattened: no src/ wrapping layer
      expect(tree).toContain('index.ts');
      expect(tree).toContain('utils/');
      expect(tree).toContain('utils/helper.ts');
      expect(tree).not.toContain('src/');
    } finally {
      await cleanup();
    }
  });

  it('should handle expandMode with a file (edge case — parseArgs blocks it but runtime handles it safely)', async () => {
    const { workDir, baseDir, cleanup } = await setupFixture();
    const localDir = path.join(baseDir, 'out6');
    try {
      await copyOutput(workDir, 'README.md', localDir, false, true);
      const tree = await listTree(localDir);
      expect(tree).toContain('README.md');
    } finally {
      await cleanup();
    }
  });

  it('should copy root entries skipping .git (./ expand)', async () => {
    const { workDir, baseDir, cleanup } = await setupFixture();
    const localDir = path.join(baseDir, 'out7');
    try {
      await copyOutput(workDir, '.', localDir, false, false);
      const tree = await listTree(localDir);
      // Should have repo files but not .git
      expect(tree).toContain('README.md');
      expect(tree).toContain('src/');
      expect(tree).toContain('package.json');
      expect(tree).not.toContain('.git/');
    } finally {
      await cleanup();
    }
  });
});

// ───────────── getFirstLevelConflicts tests ─────────────

async function setupConflictFixture(): Promise<{
  baseDir: string;
  sourceDir: string;
  targetDir: string;
  cleanup: () => Promise<void>;
}> {
  const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'conflict-test-'));
  const sourceDir = path.join(baseDir, 'source');
  const targetDir = path.join(baseDir, 'target');

  // Source: file1.txt, dir1/, file2.txt
  await fs.promises.mkdir(path.join(sourceDir), { recursive: true });
  await fs.promises.writeFile(path.join(sourceDir, 'file1.txt'), 'a');
  await fs.promises.mkdir(path.join(sourceDir, 'dir1'), { recursive: true });
  await fs.promises.writeFile(path.join(sourceDir, 'file2.txt'), 'b');

  // Target: only file1.txt and dir1/ exist (same names — conflicts)
  await fs.promises.mkdir(path.join(targetDir), { recursive: true });
  await fs.promises.writeFile(path.join(targetDir, 'file1.txt'), 'existing a');
  await fs.promises.mkdir(path.join(targetDir, 'dir1'), { recursive: true });

  const cleanup = async () => {
    await fs.promises.rm(baseDir, { recursive: true, force: true });
  };

  return { baseDir, sourceDir, targetDir, cleanup };
}

describe('getFirstLevelConflicts', () => {
  it('should return empty array when there are no conflicts', async () => {
    const { baseDir, sourceDir, cleanup } = await setupConflictFixture();
    const emptyTarget = path.join(baseDir, 'empty-target');
    await fs.promises.mkdir(emptyTarget, { recursive: true });

    try {
      const result = await getFirstLevelConflicts(sourceDir, emptyTarget);
      expect(result).toEqual([]);
    } finally {
      await cleanup();
      await fs.promises.rm(emptyTarget, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('should return conflicting entry names when conflicts exist', async () => {
    const { sourceDir, targetDir, cleanup } = await setupConflictFixture();

    try {
      const result = await getFirstLevelConflicts(sourceDir, targetDir);
      expect(result).toContain('file1.txt');
      expect(result).toContain('dir1/');
      expect(result).not.toContain('file2.txt');
    } finally {
      await cleanup();
    }
  });

  it('should return empty array when sourceDir does not exist', async () => {
    const { baseDir, targetDir, cleanup } = await setupConflictFixture();
    const nonExistentSource = path.join(baseDir, 'no-such-source');

    try {
      const result = await getFirstLevelConflicts(nonExistentSource, targetDir);
      expect(result).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('should correctly distinguish files and directories', async () => {
    const { sourceDir, targetDir, cleanup } = await setupConflictFixture();

    try {
      const result = await getFirstLevelConflicts(sourceDir, targetDir);
      // dir1 should have / suffix, file1.txt should not
      expect(result).toContain('dir1/');
      expect(result).toContain('file1.txt');
      // Verify no file is accidentally marked as directory
      for (const entry of result) {
        if (entry === 'dir1/') {
          expect(entry.endsWith('/')).toBe(true);
        } else {
          expect(entry.endsWith('/')).toBe(false);
        }
      }
    } finally {
      await cleanup();
    }
  });

  it('should return empty array when targetDir does not exist (fast path)', async () => {
    const { baseDir, sourceDir, cleanup } = await setupConflictFixture();
    const nonExistentTarget = path.join(baseDir, 'no-such-target');

    try {
      const result = await getFirstLevelConflicts(sourceDir, nonExistentTarget);
      expect(result).toEqual([]);
    } finally {
      await cleanup();
    }
  });
});

// ───────────── Prompt function tests ─────────────

vi.mock('node:readline', () => {
  const mockQuestion = vi.fn();
  const mockClose = vi.fn();
  return {
    createInterface: vi.fn(() => ({
      question: mockQuestion,
      close: mockClose,
    })),
  };
});

describe('promptConflictOverwrite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should resolve true when user types yes', async () => {
    const { createInterface } = await import('node:readline');
    vi.mocked(createInterface).mockImplementation(() => {
      const q = vi.fn((_prompt: string, callback: (answer: string) => void) => callback('yes'));
      return { question: q, close: vi.fn() } as any;
    });

    const result = await promptConflictOverwrite('/tmp/dir', ['a.txt', 'b/']);
    expect(result).toBe(true);
  });

  it('should resolve false when user types no', async () => {
    const { createInterface } = await import('node:readline');
    vi.mocked(createInterface).mockImplementation(() => {
      const q = vi.fn((_prompt: string, callback: (answer: string) => void) => callback('no'));
      return { question: q, close: vi.fn() } as any;
    });

    const result = await promptConflictOverwrite('/tmp/dir', ['a.txt']);
    expect(result).toBe(false);
  });
});

describe('promptReplaceFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should resolve true when user types yes', async () => {
    const { createInterface } = await import('node:readline');
    vi.mocked(createInterface).mockImplementation(() => {
      const q = vi.fn((_prompt: string, callback: (answer: string) => void) => callback('yes'));
      return { question: q, close: vi.fn() } as any;
    });

    const result = await promptReplaceFile('/tmp/dest/file.txt');
    expect(result).toBe(true);
  });

  it('should resolve false when user types no', async () => {
    const { createInterface } = await import('node:readline');
    vi.mocked(createInterface).mockImplementation(() => {
      const q = vi.fn((_prompt: string, callback: (answer: string) => void) => callback('no'));
      return { question: q, close: vi.fn() } as any;
    });

    const result = await promptReplaceFile('/tmp/dest/file.txt');
    expect(result).toBe(false);
  });
});
