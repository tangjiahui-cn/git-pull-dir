/**
 * git-pull-dir — Integration tests (requires network)
 *
 * These tests clone from a real remote repository to verify the full flow.
 * They are skipped if network is unavailable.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTempDir, cleanupTempDir } from './helpers.js';

const TEST_REPO = 'https://github.com/tangjiahui-cn/handwrite-js.git';

// Capture the project root before any CWD changes
const PROJECT_ROOT = process.cwd();

/**
 * Run the git-pull-dir CLI and return the exit code.
 */
async function runCli(args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const { execa } = await import('execa');

  try {
    const result = await execa('node', [
      path.resolve(PROJECT_ROOT, 'dist/index.cjs'),
      ...args,
    ], {
      timeout: 180_000,
      reject: false,
      input,
    });
    return { code: result.exitCode ?? 0, stdout: result.stdout, stderr: result.stderr };
  } catch (err) {
    const execaErr = err as { exitCode?: number; stdout?: string; stderr?: string };
    return {
      code: execaErr.exitCode ?? 1,
      stdout: execaErr.stdout ?? '',
      stderr: execaErr.stderr ?? '',
    };
  }
}

describe('integration: full clone flow', () => {
  it('should clone entire repository root (./)', async () => {
    const tmpDir = await createTempDir();
    const localDir = path.join(tmpDir, 'full-project');

    const { code } = await runCli([
      TEST_REPO,
      './',
      localDir,
      '--quiet',
    ]);

    try {
      expect(code).toBe(0);
      expect(fs.existsSync(localDir)).toBe(true);

      // Should have package.json
      const pkgPath = path.join(localDir, 'package.json');
      expect(fs.existsSync(pkgPath)).toBe(true);
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkg.name).toBe('handwrite-js');

      // Should have src/ and dist/ directories
      expect(fs.existsSync(path.join(localDir, 'src'))).toBe(true);
      expect(fs.existsSync(path.join(localDir, 'dist'))).toBe(true);

      // Should NOT have .git directory
      expect(fs.existsSync(path.join(localDir, '.git'))).toBe(false);
    } finally {
      await cleanupTempDir(tmpDir);
    }
  }, 300_000);

  it('should clone a subdirectory (src)', async () => {
    const tmpDir = await createTempDir();
    const localDir = path.join(tmpDir, 'src-only');

    const { code } = await runCli([
      TEST_REPO,
      'src',
      localDir,
      '--quiet',
    ]);

    try {
      expect(code).toBe(0);
      expect(fs.existsSync(localDir)).toBe(true);

      // Should have src/index.ts
      expect(fs.existsSync(path.join(localDir, 'index.ts'))).toBe(true);

      // Should have src/utils/ directory
      expect(fs.existsSync(path.join(localDir, 'utils'))).toBe(true);

      // Should NOT have root-level package.json
      expect(fs.existsSync(path.join(localDir, 'package.json'))).toBe(false);

      // Should NOT have .git directory
      expect(fs.existsSync(path.join(localDir, '.git'))).toBe(false);
    } finally {
      await cleanupTempDir(tmpDir);
    }
  }, 300_000);

  it('should clone a single file (package.json)', async () => {
    const tmpDir = await createTempDir();
    const localDir = path.join(tmpDir, 'single-file');

    const { code } = await runCli([
      TEST_REPO,
      'package.json',
      localDir,
      '--quiet',
    ]);

    try {
      expect(code).toBe(0);
      expect(fs.existsSync(localDir)).toBe(true);

      // Should have package.json
      const pkgPath = path.join(localDir, 'package.json');
      expect(fs.existsSync(pkgPath)).toBe(true);
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkg.name).toBe('handwrite-js');
    } finally {
      await cleanupTempDir(tmpDir);
    }
  }, 300_000);

  // --- New v2 integration tests ---

  it('v2: should put directory contents inside a subdirectory when local-dir ends with / (container mode)', async () => {
    const tmpDir = await createTempDir();
    const localDir = path.join(tmpDir, 'a') + '/';  // trailing / (use string concat, not path.join which strips it)

    const { code } = await runCli([
      TEST_REPO,
      'src',
      localDir,
      '--quiet',
    ]);

    try {
      expect(code).toBe(0);
      // Container mode: files are under <localDir>/src/
      const containerDir = path.join(tmpDir, 'a', 'src');
      expect(fs.existsSync(containerDir)).toBe(true);
      expect(fs.existsSync(path.join(containerDir, 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(containerDir, 'utils'))).toBe(true);
      expect(fs.existsSync(path.join(containerDir, 'utils', 'drawBezierLine.ts'))).toBe(true);
    } finally {
      await cleanupTempDir(tmpDir);
    }
  }, 300_000);

  it('v2: should expand src/* contents directly into target (no src/ wrapping)', async () => {
    const tmpDir = await createTempDir();
    const localDir = path.join(tmpDir, 'b');

    const { code } = await runCli([
      TEST_REPO,
      'src/*',
      localDir,
      '--quiet',
    ]);

    try {
      expect(code).toBe(0);
      // Expand mode: src/ contents directly in localDir
      expect(fs.existsSync(path.join(localDir, 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(localDir, 'utils'))).toBe(true);
      expect(fs.existsSync(path.join(localDir, 'utils', 'drawBezierLine.ts'))).toBe(true);
      // No src/ wrapping layer
      expect(fs.existsSync(path.join(localDir, 'src'))).toBe(false);
    } finally {
      await cleanupTempDir(tmpDir);
    }
  }, 300_000);

  it('v2: should ignore trailingSlash when expandMode is set (expand wins over container)', async () => {
    const tmpDir = await createTempDir();
    const localDir = path.join(tmpDir, 'c') + '/';  // trailing /

    const { code } = await runCli([
      TEST_REPO,
      'src/*',
      localDir,
      '--quiet',
    ]);

    try {
      expect(code).toBe(0);
      // Expand mode wins: no src/ subdirectory created despite trailing /
      expect(fs.existsSync(path.join(tmpDir, 'c', 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'c', 'utils'))).toBe(true);
      // No src/ wrapping layer
      expect(fs.existsSync(path.join(tmpDir, 'c', 'src'))).toBe(false);
    } finally {
      await cleanupTempDir(tmpDir);
    }
  }, 300_000);

  it('v2: should use default dir name from gitDir when local-dir omitted (src/* → src/)', async () => {
    const tmpDir = await createTempDir();
    const cwd = process.cwd();
    // We need to change cwd to the temp dir so the CLI writes there
    process.chdir(tmpDir);

    const { code } = await runCli([
      TEST_REPO,
      'src/*',
      // local-dir omitted
      '--quiet',
    ]);

    try {
      expect(code).toBe(0);
      // Default dir name should be 'src' (basename of git-dir without /*)
      const outputDir = path.join(tmpDir, 'src');
      expect(fs.existsSync(outputDir)).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'utils'))).toBe(true);
    } finally {
      process.chdir(cwd);
      await cleanupTempDir(tmpDir);
    }
  }, 300_000);

  it('v2: should copy single file into localDir even with trailing / (no extra wrapping)', async () => {
    const tmpDir = await createTempDir();
    const localDir = path.join(tmpDir, 'e') + '/';  // trailing /

    const { code } = await runCli([
      TEST_REPO,
      'package.json',
      localDir,
      '--quiet',
    ]);

    try {
      expect(code).toBe(0);
      // File directly in localDir, no extra subdirectory
      const pkgPath = path.join(tmpDir, 'e', 'package.json');
      expect(fs.existsSync(pkgPath)).toBe(true);
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkg.name).toBe('handwrite-js');
    } finally {
      await cleanupTempDir(tmpDir);
    }
  }, 300_000);

  it('v2: should copy single file (no trailing /) — same behaviour as trailing /', async () => {
    const tmpDir = await createTempDir();
    const localDir = path.join(tmpDir, 'f');

    const { code } = await runCli([
      TEST_REPO,
      'package.json',
      localDir,
      '--quiet',
    ]);

    try {
      expect(code).toBe(0);
      // Same result as with trailing /
      const pkgPath = path.join(localDir, 'package.json');
      expect(fs.existsSync(pkgPath)).toBe(true);
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkg.name).toBe('handwrite-js');
    } finally {
      await cleanupTempDir(tmpDir);
    }
  }, 300_000);

  // --- v3 --force / conflict tests ---

  it('v3: expand mode + conflict + user types yes', async () => {
    const tmpDir = await createTempDir();
    const localDir = path.join(tmpDir, 'expand-yes');

    // Pre-populate target dir with a file that will conflict
    await fs.promises.mkdir(localDir, { recursive: true });
    await fs.promises.writeFile(path.join(localDir, 'index.ts'), '// old content');
    await fs.promises.writeFile(path.join(localDir, 'keep.txt'), '// should be retained');

    const { code, stdout, stderr } = await runCli([
      TEST_REPO,
      'src/*',
      localDir,
      '--quiet',
    ], 'yes\n');

    try {
      expect(code).toBe(0);
      // Conflict file should be overwritten with new content
      expect(fs.existsSync(path.join(localDir, 'index.ts'))).toBe(true);
      // File not in source should be retained
      expect(fs.existsSync(path.join(localDir, 'keep.txt'))).toBe(true);
      // Files from source should exist
      expect(fs.existsSync(path.join(localDir, 'utils'))).toBe(true);
    } finally {
      await cleanupTempDir(tmpDir);
    }
  }, 300_000);

  it('v3: expand mode + conflict + --force', async () => {
    const tmpDir = await createTempDir();
    const localDir = path.join(tmpDir, 'expand-force');

    // Pre-populate target dir with a file that will conflict
    await fs.promises.mkdir(localDir, { recursive: true });
    await fs.promises.writeFile(path.join(localDir, 'index.ts'), '// old content');
    await fs.promises.writeFile(path.join(localDir, 'keep.txt'), '// should be retained');

    const { code, stdout, stderr } = await runCli([
      TEST_REPO,
      'src/*',
      localDir,
      '--quiet',
      '--force',
    ]);

    try {
      expect(code).toBe(0);
      // Conflict file overwritten
      expect(fs.existsSync(path.join(localDir, 'index.ts'))).toBe(true);
      // Unrelated file retained
      expect(fs.existsSync(path.join(localDir, 'keep.txt'))).toBe(true);
      // Source files present
      expect(fs.existsSync(path.join(localDir, 'utils'))).toBe(true);
      // No "是否覆盖" prompt in output
      expect(stdout).not.toContain('是否覆盖');
    } finally {
      await cleanupTempDir(tmpDir);
    }
  }, 300_000);

  it('v3: file mode + file exists + user types no', async () => {
    const tmpDir = await createTempDir();
    const localDir = path.join(tmpDir, 'file-no');

    // Pre-populate target dir with a file that will conflict
    await fs.promises.mkdir(localDir, { recursive: true });
    const existingContent = '// original content';
    await fs.promises.writeFile(path.join(localDir, 'package.json'), existingContent);

    const { code, stdout, stderr } = await runCli([
      TEST_REPO,
      'package.json',
      localDir,
      '--quiet',
    ], 'no\n');

    try {
      expect(code).toBe(0);
      // File should NOT have changed
      const content = fs.readFileSync(path.join(localDir, 'package.json'), 'utf-8');
      expect(content).toBe(existingContent);
      // Should output "cancelled"
      expect(stdout).toContain('cancelled');
    } finally {
      await cleanupTempDir(tmpDir);
    }
  }, 300_000);

  it('v3: file mode + --force + file exists', async () => {
    const tmpDir = await createTempDir();
    const localDir = path.join(tmpDir, 'file-force');

    // Pre-populate target dir with a file that will conflict
    await fs.promises.mkdir(localDir, { recursive: true });
    await fs.promises.writeFile(path.join(localDir, 'package.json'), '{"name":"old"}');

    const { code, stdout, stderr } = await runCli([
      TEST_REPO,
      'package.json',
      localDir,
      '--quiet',
      '--force',
    ]);

    try {
      expect(code).toBe(0);
      // File should be overwritten
      const pkg = JSON.parse(fs.readFileSync(path.join(localDir, 'package.json'), 'utf-8'));
      expect(pkg.name).toBe('handwrite-js');
      // No "是否替换" prompt in output
      expect(stdout).not.toContain('是否替换');
    } finally {
      await cleanupTempDir(tmpDir);
    }
  }, 300_000);

  it('v3: directory mode + --force', async () => {
    const tmpDir = await createTempDir();
    const localDir = path.join(tmpDir, 'dir-force');

    // Create a non-empty target dir that would normally trigger promptOverwrite
    await fs.promises.mkdir(localDir, { recursive: true });
    await fs.promises.writeFile(path.join(localDir, 'stale.txt'), 'old');

    const { code, stdout, stderr } = await runCli([
      TEST_REPO,
      'src',
      localDir,
      '--quiet',
      '--force',
    ]);

    try {
      expect(code).toBe(0);
      // Dir should have been deleted and rebuilt with source content
      expect(fs.existsSync(path.join(localDir, 'index.ts'))).toBe(true);
      // Old file should be gone (directory mode deletes entire dir)
      expect(fs.existsSync(path.join(localDir, 'stale.txt'))).toBe(false);
      // No "是否覆盖" prompt
      expect(stdout).not.toContain('是否覆盖');
    } finally {
      await cleanupTempDir(tmpDir);
    }
  }, 300_000);

  it('v3: expand mode + no conflicts (target empty)', async () => {
    const tmpDir = await createTempDir();
    const localDir = path.join(tmpDir, 'expand-noconflict');

    // Create empty target dir
    await fs.promises.mkdir(localDir, { recursive: true });

    const { code, stdout, stderr } = await runCli([
      TEST_REPO,
      'src/*',
      localDir,
      '--quiet',
    ]);

    try {
      expect(code).toBe(0);
      // Files should be copied normally
      expect(fs.existsSync(path.join(localDir, 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(localDir, 'utils'))).toBe(true);
      // No "是否覆盖" prompt
      expect(stdout).not.toContain('是否覆盖');
    } finally {
      await cleanupTempDir(tmpDir);
    }
  }, 300_000);
});
