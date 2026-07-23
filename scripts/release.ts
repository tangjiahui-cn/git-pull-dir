#!/usr/bin/env node

/**
 * release.ts — git-pull-dir 发布前置检查脚本
 *
 * 在 pnpm publish 前执行发布验证与准备工作：
 *   1. Git 工作区检查
 *   2. Node.js 版本检查
 *   3. 运行测试
 *   4. 运行构建
 *   5. 选择版本号更新类型
 *   6. 执行 npm version（触发 Changelog 生成 + Git tag）
 *   7. 推送 Git 提交和 Tags 到远程
 *
 * 用法:
 *   pnpm release                 # 交互模式
 *   tsx scripts/release.ts       # 同上
 *   tsx scripts/release.ts --yes --type=patch   # CI 模式
 *   tsx scripts/release.ts --dry-run            # 模拟运行
 *
 * 注意：本脚本不执行 pnpm publish，完成后需手动执行。
 */
// ============================================================
// Imports
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import { execSync, type ExecSyncOptions } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

// ============================================================
// Constants
// ============================================================
const PACKAGE_NAME = 'git-pull-dir';
const VALID_VERSION_TYPES = ['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease'] as const;
const STEP_IDS = ['check-git', 'check-node', 'test', 'build', 'version', 'push'] as const;
const STEP_LABELS: Record<string, string> = {
  'check-git':  '检查 Git 工作区',
  'check-node': '检查 Node.js 版本',
  test:         '运行测试',
  build:        '运行构建',
  version:      '执行版本更新',
  push:         '推送 Git 提交和 Tags',
};
const EXIT = { SUCCESS: 0, USER_ABORT: 0, CHECK_FAILED: 1, VERSION_FAILED: 2, PUSH_FAILED: 3 } as const;
const DEFAULT_CONFIG = {
  nodeVersion:   '>=20',
  buildScript:   'build',
  testScript:    'test',
  remoteName:    'origin',
  pushBranch:    'master',
  commitMessage: 'chore(release): v%s',
} satisfies Record<string, string>;

// ANSI colors
const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
} as const;

// ============================================================
// Types
// ============================================================
type VersionType = typeof VALID_VERSION_TYPES[number];
type StepId = typeof STEP_IDS[number];

interface CliArgs {
  type: VersionType | null;
  dryRun: boolean;
  skip: string[];
  yes: boolean;
  remote: string | null;
  help: boolean;
}

interface ReleaseConfig {
  nodeVersion: string;
  buildScript: string;
  testScript: string;
  remoteName: string;
  pushBranch: string;
  commitMessage: string;
}

interface RunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  message?: string;
  code?: number | null;
}

interface ReleaseContext {
  stepNum: number;
  total: number;
  versionType: VersionType | null;
  _stashed: boolean;
}

// ============================================================
// Help text
// ============================================================
function printHelp(): void {
  console.log(`
${C.bold}用法:${C.reset} tsx scripts/release.ts [options]

${C.bold}选项:${C.reset}
  ${C.cyan}-h, --help${C.reset}               显示此帮助信息并退出
  ${C.cyan}-t, --type <type>${C.reset}        版本更新类型: ${VALID_VERSION_TYPES.join(' / ')}
  ${C.cyan}-d, --dry-run${C.reset}            模拟运行，不实际更改任何文件
  ${C.cyan}-s, --skip <steps>${C.reset}       跳过指定步骤，逗号分隔
                     可用值: ${STEP_IDS.join(', ')}
  ${C.cyan}-y, --yes${C.reset}                跳过所有交互确认（CI 模式）
  ${C.cyan}-r, --remote <name>${C.reset}      推送目标 remote 名称

${C.bold}示例:${C.reset}
  tsx scripts/release.ts                                 ${C.gray}# 交互模式${C.reset}
  tsx scripts/release.ts --yes --type=patch              ${C.gray}# CI 模式${C.reset}
  tsx scripts/release.ts --dry-run --type=patch          ${C.gray}# 模拟运行${C.reset}
  tsx scripts/release.ts --skip=test,build               ${C.gray}# 跳过测试和构建${C.reset}

${C.dim}本脚本执行发布前的验证和准备工作，不执行 pnpm publish。${C.reset}
`);
}

// ============================================================
// CLI argument parsing
// ============================================================
function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { type: null, dryRun: false, skip: [], yes: false, remote: null, help: false };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h')          { args.help = true; continue; }
    if (a === '--dry-run' || a === '-d')       { args.dryRun = true; continue; }
    if (a === '--yes' || a === '-y')           { args.yes = true; continue; }
    if (a.startsWith('--type='))               { args.type = a.slice(7) as VersionType; continue; }
    if (a === '--type' || a === '-t')          { args.type = argv[++i] as VersionType; continue; }
    if (a.startsWith('--remote='))             { args.remote = a.slice(9); continue; }
    if (a === '--remote' || a === '-r')        { args.remote = argv[++i]; continue; }
    if (a.startsWith('--skip='))               { args.skip = a.slice(7).split(',').filter(Boolean); continue; }
    if (a === '-s')                            { args.skip = argv[++i].split(',').filter(Boolean); continue; }
    console.error(`${C.red}未知参数:${C.reset} ${a}\n使用 ${C.cyan}--help${C.reset} 查看帮助`);
    process.exit(EXIT.CHECK_FAILED);
  }

  if (args.type && !(VALID_VERSION_TYPES as readonly string[]).includes(args.type)) {
    console.error(`${C.red}无效的版本类型:${C.reset} ${args.type}\n支持的: ${VALID_VERSION_TYPES.join(', ')}`);
    process.exit(EXIT.CHECK_FAILED);
  }
  const invalid = args.skip.filter(s => !(STEP_IDS as readonly string[]).includes(s));
  if (invalid.length) {
    console.error(`${C.red}无效的步骤标识:${C.reset} ${invalid.join(', ')}\n可用: ${STEP_IDS.join(', ')}`);
    process.exit(EXIT.CHECK_FAILED);
  }
  if (args.yes && args.dryRun && !args.type) {
    console.error(`${C.red}错误:${C.reset} --yes 与 --dry-run 组合使用时，必须同时提供 --type。`);
    process.exit(EXIT.CHECK_FAILED);
  }
  return args;
}

// ============================================================
// Config loading
// ============================================================
function loadConfig(cwd: string): ReleaseConfig {
  const configPath = path.join(cwd, 'release.config.json');
  const config: ReleaseConfig = { ...DEFAULT_CONFIG };
  if (!existsSync(configPath)) {
    debug('配置文件 release.config.json 不存在，使用默认配置');
    return config;
  }
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    for (const key of Object.keys(DEFAULT_CONFIG) as (keyof ReleaseConfig)[]) {
      if (parsed[key] !== undefined) config[key] = parsed[key];
    }
    debug('已加载配置:', configPath);
  } catch (err) {
    console.error(`\n${C.red}❌ 配置文件解析失败:${C.reset} ${configPath}`);
    console.error(`   ${(err as Error).message}`);
    process.exit(EXIT.CHECK_FAILED);
  }
  return config;
}

// ============================================================
// Utilities
// ============================================================
function isDebug(): boolean { return process.env.DEBUG === '1' || process.env.DEBUG === 'true'; }
function debug(...args: unknown[]): void { if (isDebug()) console.error(`${C.gray}[DEBUG]${C.reset}`, ...args); }

function getVersionFromPkg(cwd: string): string {
  try {
    return JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf-8')).version || '0.0.0';
  } catch { return '0.0.0'; }
}

function formatVersionPreview(ver: string, type: VersionType): string {
  const p = ver.split('.').map(Number);
  const next: Record<string, string | (() => string)> = {
    major:      `${p[0] + 1}.0.0`,
    minor:      `${p[0]}.${p[1] + 1}.0`,
    patch:      `${p[0]}.${p[1]}.${p[2] + 1}`,
    prepatch:   `${p[0]}.${p[1]}.${p[2] + 1}-0`,
    preminor:   `${p[0]}.${p[1] + 1}.0-0`,
    premajor:   `${p[0] + 1}.0.0-0`,
    prerelease: (() => {
      const m = ver.match(/^(\d+\.\d+\.\d+)-(\d+)$/);
      return m ? `${m[1]}-${Number(m[2]) + 1}` : `${p[0]}.${p[1]}.${p[2] + 1}-0`;
    })(),
  }[type] || ver;
  return `${C.bold}${ver}${C.reset} ${C.gray}→${C.reset} ${C.bold}${next}${C.reset}`;
}

function formatStep(step: number, total: number, label: string): string {
  return `${C.cyan}[${step}/${total}]${C.reset} ${label}`;
}

// ============================================================
// Command execution
// ============================================================
interface RunOptions {
  capture?: boolean;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
}

function run(cmd: string, opts: RunOptions = {}): RunResult {
  debug(`$ ${cmd}`);
  try {
    const execOpts: ExecSyncOptions = {
      stdio: opts.capture ? 'pipe' : 'inherit',
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env, ...opts.env } as Record<string, string>,
      encoding: 'utf-8' as BufferEncoding,
      timeout: opts.timeout || 0,
    };
    const stdout = execSync(cmd, execOpts);
    return { success: true, stdout: (stdout || '').toString().trimEnd(), stderr: '' };
  } catch (err) {
    const execErr = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string; status?: number | null };
    return {
      success: false,
      stdout: (execErr.stdout || '').toString().trimEnd(),
      stderr: (execErr.stderr || '').toString().trimEnd(),
      message: execErr.message,
      code: execErr.status,
    };
  }
}

// ============================================================
// Interactive prompts
// ============================================================
function question(query: string): Promise<string> {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, answer => { rl.close(); resolve(answer.trim()); });
  });
}

async function promptChoice(label: string, choices: string[], defaultIdx = 0): Promise<number> {
  console.log(`\n${label}`);
  for (let i = 0; i < choices.length; i++) {
    console.log(`  ${C.cyan}${i + 1})${C.reset} ${choices[i]}`);
  }
  const defaultLabel = `${C.dim}(默认 ${defaultIdx + 1})${C.reset}`;
  const raw = await question(`  请输入选项编号 ${defaultLabel}: `);
  const num = parseInt(raw, 10);
  if (raw === '') return defaultIdx;
  if (num >= 1 && num <= choices.length) return num - 1;
  console.log(`  ${C.yellow}无效输入，使用默认选项。${C.reset}`);
  return defaultIdx;
}

// ============================================================
// Step 1: Check Git workspace
// ============================================================
async function stepCheckGit(args: CliArgs, _config: ReleaseConfig, ctx: ReleaseContext): Promise<boolean> {
  const header = formatStep(ctx.stepNum, ctx.total, STEP_LABELS['check-git']);
  const r = run('git status --porcelain', { capture: true });

  if (r.stdout === '') {
    console.log(`${header} ${C.green}✅${C.reset} 工作区干净`);
    return true;
  }

  // Workspace is dirty
  console.log(`${header} ${C.red}❌${C.reset} 工作区有未提交的变更`);
  console.log(`  ${C.gray}变更文件:${C.reset}`);
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    console.log(`    ${C.gray}${line}${C.reset}`);
  }

  if (args.yes) {
    console.log(`  ${C.red}→ --yes 模式下工作区必须干净${C.reset}`);
    console.log(`  ${C.red}❌ 请手动处理未提交的变更后重试。${C.reset}`);
    process.exit(EXIT.CHECK_FAILED);
  }

  // Interactive mode: offer options
  console.log('');
  const choices = [
    `${C.green}提交变更并继续${C.reset} — ${C.dim}自动执行 git add -A${C.reset}`,
    `${C.yellow}暂存(stash)变更并继续${C.reset} — ${C.dim}自动执行 git stash${C.reset}`,
    `${C.red}中止流程${C.reset}`,
  ];
  const idx = await promptChoice(`  请选择处理方式:`, choices, 2);

  if (idx === 2) {
    console.log(`  ${C.yellow}⏹ 用户中止发布流程。${C.reset}`);
    process.exit(EXIT.USER_ABORT);
  }

  if (idx === 0) {
    // Commit
    run('git add -A');
    const msg = await question(`  请输入 commit message ${C.dim}(默认: chore: pre-release changes)${C.reset}: `);
    const commitMsg = msg || 'chore: pre-release changes';
    const cr = run(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
    if (!cr.success) {
      console.error(`  ${C.red}❌ git commit 失败:${C.reset} ${cr.stderr || cr.message}`);
      process.exit(EXIT.CHECK_FAILED);
    }
    console.log(`  ${C.green}✅ 已提交变更.${C.reset}`);
  } else {
    // Stash
    run('git stash');
    ctx._stashed = true;
    console.log(`  ${C.yellow}📦 已暂存变更. 完成后记得执行 git stash pop 恢复。${C.reset}`);
  }
  return true;
}

// ============================================================
// Step 2: Check Node.js version
// ============================================================
async function stepCheckNode(args: CliArgs, config: ReleaseConfig, ctx: ReleaseContext): Promise<boolean> {
  const header = formatStep(ctx.stepNum, ctx.total, STEP_LABELS['check-node']);
  const r = run('node -v', { capture: true });
  const ver = r.stdout.trim();
  const match = ver.match(/^v?(\d+)/);
  const major = match ? parseInt(match[1], 10) : 0;

  if (major >= 20) {
    console.log(`${header} ${C.green}✅${C.reset} ${ver}`);
    return true;
  }

  console.log(`${header} ${C.red}❌${C.reset} ${ver} (< 20)`);

  if (args.dryRun) {
    console.log(`  ${C.yellow}将执行:${C.reset} nvm use（读取 .nvmrc v20）`);
    console.log(`  ${C.yellow}(dry-run 模式下跳过实际执行)${C.reset}`);
    return true;
  }

  // Try nvm use
  console.log(`  尝试 ${C.cyan}nvm use${C.reset}...（读取 .nvmrc v20）`);
  const hasNvm = process.env.NVM_DIR || run('command -v nvm', { capture: true }).success;
  if (hasNvm) {
    const nvmDir = process.env.NVM_DIR || path.join(process.env.HOME || '', '.nvm');
    const nvmResult = run(`bash -c 'export NVM_DIR="${nvmDir}" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use'`, { capture: true });
    if (nvmResult.success) {
      const newVer = run('node -v', { capture: true }).stdout.trim();
      console.log(`  ${C.green}✅${C.reset} 已切换到 ${newVer}`);
      return true;
    }
    console.log(`  ${C.red}→ nvm use 失败:${C.reset} ${nvmResult.stderr || nvmResult.message}`);
  } else {
    console.log(`  → nvm 未安装`);
  }

  console.error(`  ${C.red}❌ 请安装 Node.js v20+ 后重试。${C.reset}`);
  process.exit(EXIT.CHECK_FAILED);
}

// ============================================================
// Step 3: Run tests
// ============================================================
async function stepTest(args: CliArgs, config: ReleaseConfig, _ctx: ReleaseContext): Promise<boolean> {
  const header = formatStep(_ctx.stepNum, _ctx.total, STEP_LABELS.test);
  if (args.dryRun) {
    console.log(`${header} ${C.yellow}将执行:${C.reset} pnpm ${config.testScript} ${C.dim}(dry-run)${C.reset}`);
    return true;
  }
  console.log(`${header}`);
  const r = run(`pnpm ${config.testScript}`);
  if (r.success) {
    console.log(`  ${C.green}✅ 测试全部通过${C.reset}`);
    return true;
  }
  console.error(`  ${C.red}❌ 测试失败${C.reset}`);
  if (r.stderr) console.error(r.stderr);
  process.exit(EXIT.CHECK_FAILED);
}

// ============================================================
// Step 4: Run build
// ============================================================
async function stepBuild(args: CliArgs, config: ReleaseConfig, _ctx: ReleaseContext): Promise<boolean> {
  const header = formatStep(_ctx.stepNum, _ctx.total, STEP_LABELS.build);
  if (args.dryRun) {
    console.log(`${header} ${C.yellow}将执行:${C.reset} pnpm ${config.buildScript} ${C.dim}(dry-run)${C.reset}`);
    return true;
  }
  console.log(`${header}`);
  const r = run(`pnpm ${config.buildScript}`);
  if (r.success) {
    console.log(`  ${C.green}✅ 构建成功${C.reset}`);
    return true;
  }
  console.error(`  ${C.red}❌ 构建失败${C.reset}`);
  if (r.stderr) console.error(r.stderr);
  process.exit(EXIT.CHECK_FAILED);
}

// ============================================================
// Step 5: Choose version type
// ============================================================
async function stepChooseVersion(args: CliArgs, _config: ReleaseConfig, ctx: ReleaseContext): Promise<boolean> {
  const curVer = getVersionFromPkg(process.cwd());
  const header = formatStep(ctx.stepNum, ctx.total, '选择版本更新类型');

  if (args.type) {
    console.log(`${header} ${C.cyan}${args.type}${C.reset} ${C.gray}(${formatVersionPreview(curVer, args.type)})${C.reset}`);
    ctx.versionType = args.type;
    return true;
  }

  if (args.yes) {
    // --yes without --type: default to patch
    ctx.versionType = 'patch';
    console.log(`${header} ${C.cyan}patch${C.reset} ${C.gray}(${formatVersionPreview(curVer, 'patch')})${C.reset} ${C.dim}(--yes 默认)${C.reset}`);
    return true;
  }

  const choices = VALID_VERSION_TYPES.map(t => `${t.padEnd(12)} ${C.gray}(${formatVersionPreview(curVer, t)})${C.reset}`);
  const idx = await promptChoice(`${header}`, choices, 0);
  ctx.versionType = VALID_VERSION_TYPES[idx];
  console.log(`  ${C.green}已选择:${C.reset} ${C.cyan}${ctx.versionType}${C.reset}`);
  return true;
}

// ============================================================
// Step 6: Run npm version
// ============================================================
async function stepVersion(args: CliArgs, config: ReleaseConfig, ctx: ReleaseContext): Promise<boolean> {
  const header = formatStep(ctx.stepNum, ctx.total, STEP_LABELS.version);

  // Pre-check: git workspace must be clean
  const gitCheck = run('git status --porcelain', { capture: true });
  if (gitCheck.stdout !== '') {
    console.error(`${header} ${C.red}❌ Git 工作区不干净，无法执行 npm version。${C.reset}`);
    console.error(`  ${C.gray}请先提交或暂存变更后重试。${C.reset}`);
    process.exit(EXIT.VERSION_FAILED);
  }

  const versionType = ctx.versionType;
  const oldVersion = getVersionFromPkg(process.cwd());
  const commitMsg = config.commitMessage; // %s is replaced by npm version with the new version

  if (args.dryRun) {
    console.log(`${header} ${C.yellow}将执行:${C.reset} npm version ${versionType} -m "${commitMsg}" ${C.dim}(dry-run)${C.reset}`);
    console.log(`  ${C.gray}本次操作将:${C.reset}`);
    console.log(`    • 更新 package.json 版本号`);
    console.log(`    • 生成/更新 CHANGELOG.md`);
    console.log(`    • 创建 Git commit`);
    console.log(`    • 创建 Git tag`);
    return true;
  }

  console.log(`${header}`);

  // execute npm version — the `version` hook in package.json runs automatically
  const r = run(`npm version ${versionType} -m "${commitMsg.replace(/"/g, '\\"')}"`);
  if (r.success) {
    const newVer = getVersionFromPkg(process.cwd());
    console.log(`  ${C.green}✅${C.reset} package.json: ${oldVersion} → ${newVer}`);
    console.log(`  ${C.green}✅${C.reset} CHANGELOG.md 已更新`);
    console.log(`  ${C.green}✅${C.reset} Git tag v${newVer} 已创建`);
    return true;
  }

  console.error(`  ${C.red}❌ npm version 失败:${C.reset} ${r.stderr || r.message}`);
  process.exit(EXIT.VERSION_FAILED);
}

// ============================================================
// Step 7: Push to remote
// ============================================================
async function stepPush(args: CliArgs, config: ReleaseConfig, _ctx: ReleaseContext): Promise<boolean> {
  const remote = args.remote || config.remoteName;
  const branch = config.pushBranch;
  const header = formatStep(_ctx.stepNum, _ctx.total, STEP_LABELS.push);

  if (args.dryRun) {
    console.log(`${header} ${C.yellow}将执行:${C.reset} git push ${remote} ${branch} ${C.dim}(dry-run)${C.reset}`);
    console.log(`  ${C.yellow}将执行:${C.reset} git push ${remote} --tags ${C.dim}(dry-run)${C.reset}`);
    return true;
  }

  // Push commits
  console.log(`${header}`);
  console.log(`  → ${remote} ${branch}...`);
  const pushR = run(`git push ${remote} ${branch}`);
  if (!pushR.success) {
    console.error(`  ${C.red}❌ git push ${remote} ${branch} 失败:${C.reset} ${pushR.stderr || pushR.message}`);
    process.exit(EXIT.PUSH_FAILED);
  }
  console.log(`    ${C.green}✓${C.reset}`);

  // Push tags
  console.log(`  → tags...`);
  const tagR = run(`git push ${remote} --tags`);
  if (!tagR.success) {
    console.error(`  ${C.red}❌ git push ${remote} --tags 失败:${C.reset} ${tagR.stderr || tagR.message}`);
    process.exit(EXIT.PUSH_FAILED);
  }
  console.log(`    ${C.green}✓${C.reset}`);

  return true;
}

// ============================================================
// Main
// ============================================================
async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return; }

  const config = loadConfig(process.cwd());
  const currentVersion = getVersionFromPkg(process.cwd());

  // Determine which steps to run
  const skipSet = new Set(args.skip);
  const activeSteps = STEP_IDS.filter(id => !skipSet.has(id));

  // Output header
  console.log(`\n${C.bold}🚀 ${PACKAGE_NAME} v${currentVersion} 发布前置检查${C.reset}`);
  console.log(`  ${C.gray}${'─'.repeat(40)}${C.reset}`);

  if (args.dryRun) {
    console.log(`  ${C.yellow}⚡ dry-run 模式: 不会实际更改任何文件或推送${C.reset}`);
  }
  if (skipSet.size > 0) {
    console.log(`  ${C.yellow}⏭ 跳过步骤:${C.reset} ${args.skip.join(', ')}`);
  }

  // Build step pipeline: expand 'version' into 'choose-version' + 'version-exec'
  const pipeline: string[] = [];
  for (const id of activeSteps) {
    if (id === 'version') {
      pipeline.push('choose-version');
      pipeline.push('version-exec');
    } else {
      pipeline.push(id);
    }
  }

  const ctx: ReleaseContext = {
    stepNum: 0,
    total: pipeline.length,
    versionType: null,
    _stashed: false,
  };

  for (const stepId of pipeline) {
    ctx.stepNum++;
    switch (stepId) {
      case 'check-git':        await stepCheckGit(args, config, ctx); break;
      case 'check-node':       await stepCheckNode(args, config, ctx); break;
      case 'test':             await stepTest(args, config, ctx); break;
      case 'build':            await stepBuild(args, config, ctx); break;
      case 'choose-version':   await stepChooseVersion(args, config, ctx); break;
      case 'version-exec':     await stepVersion(args, config, ctx); break;
      case 'push':             await stepPush(args, config, ctx); break;
    }
  }

  // After completion
  console.log(`\n  ${C.gray}${'─'.repeat(40)}${C.reset}`);

  if (ctx._stashed) {
    console.log(`  ${C.yellow}📦 提示: 执行 git stash pop 恢复暂存的变更。${C.reset}`);
  }

  console.log(`\n${C.green}${C.bold}✅ 前置准备完成！${C.reset}`);
  console.log(`  ${C.bold}请执行 \`pnpm publish\` 完成发布。${C.reset}\n`);
}

// ============================================================
// Execute
// ============================================================
main().catch(err => {
  console.error(`${C.red}❌ 未预期的错误:${C.reset}`, err);
  process.exit(1);
});
