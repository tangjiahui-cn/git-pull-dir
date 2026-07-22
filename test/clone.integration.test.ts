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

/**
 * Run the git-pull-dir CLI and return the exit code.
 */
async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  // Use tsx to run the TypeScript entry directly, or node with built version
  const { execa } = await import('execa');

  try {
    const result = await execa('node', [
      path.resolve(process.cwd(), 'dist/index.cjs'),
      ...args,
    ], {
      timeout: 180_000,
      reject: false,
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

    const { code, stderr } = await runCli([
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
});
