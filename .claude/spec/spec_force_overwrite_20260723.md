# git-pull-dir — 功能规格说明书 v3：`--force` 与精细化覆盖冲突处理

## 1. 概述

本规格说明书在 v1（`spec_20260722.md`，核心流程）和 v2（`spec_20260722_2.md`，通配符/复制语义）基础上，优化覆盖冲突检测逻辑，增加 `--force` 选项。

### 1.1 动机

- 当前覆盖行为过于"粗暴"：无论何种模式，只要目标目录存在且非空，就**整个删除**再重新写入
- 对于 **展开模式**（`dir/*`），用户可能只想补充/覆盖部分文件，不应删除目标目录中已有的其他文件
- 对于 **文件模式**（`path/to/file`），应当检查具体的文件是否存在，而非检查整个目录
- 缺少 `--force` 选项，无法在自动化脚本中跳过交互提示

### 1.2 核心变更

| 变更 | 说明 |
|------|------|
| `--force` / `-F` 选项 | 跳过所有覆盖确认交互，直接覆盖 |
| **展开模式** 冲突检测 | 不再检查整个目标目录是否存在，而是逐个检查源目录下第一层条目是否在目标目录中冲突 |
| **文件模式** 冲突检测 | 不再检查目标目录是否存在，而是检查目标文件是否存在 |
| **目录模式** 行为不变 | 仍检查整个目标目录是否存在并提示，但增加 `--force` 支持 |

---

## 2. 命令用法变更

```bash
git-pull-dir <git-url> <git-dir> [local-dir] [--branch=<name>] [--quiet] [--force]
```

### 2.1 新增参数

| 参数 | 是否必填 | 描述 | 示例 |
|------|----------|------|------|
| `-F` / `--force` | 否 | 强制覆盖已存在的文件/目录，跳过所有交互确认 | `--force` |

### 2.2 使用示例

```bash
# 强制覆盖（跳过提示）
git-pull-dir --force https://github.com/facebook/react-native.git packages/core ./my-core

# 短选项
git-pull-dir -F https://github.com/facebook/react-native.git packages/core ./my-core

# 展开模式 + 强制覆盖
git-pull-dir -F https://github.com/facebook/react-native.git src/* ./output

# 文件模式 + 强制覆盖
git-pull-dir -F https://github.com/facebook/react-native.git package.json ./output
```

---

## 3. 三种模式的精细化覆盖行为

### 3.1 目录模式（默认，无 `/*`，非文件路径）

**行为不变**（仅增加 `--force` 支持）：

- 在 clone **之前**，检查 `effectiveDir` 是否存在且非空
- 若存在且非空，且 **没有** `--force`：交互提示"目录已存在，是否覆盖？(yes/no)"
  - `yes`：删除整个目录，继续拉取
  - `no`：取消操作，退出码 0
- 若存在且非空，且 **有** `--force`：**静默删除**整个目录，继续拉取，不提示
- 若不存在或为空：正常继续

**设计理由**：目录模式下，源目录的语义是"替换目标目录的全部内容"，因此整体删除再重建是合理的。`--force` 仅跳过交互步骤。

### 3.2 展开模式（`dir/*`）

**行为改变**：

- **不再**在 clone 前检查目标目录是否存在
- 先完成 clone 到临时目录
- 在 `copyOutput` **之前**，扫描源目录第一层条目（`ls <workDir>/<gitDir>/`），与目标目录中的同名条目做冲突检测
- 冲突检测规则：
  - 源目录中的每个条目（文件或目录），若同名条目已存在于目标目录中，视为冲突
  - 只检测第一层（不递归）
- 若有冲突且 **没有** `--force`：列出所有冲突条目，交互提示是否覆盖
  - `yes`：覆盖所有冲突条目（逐个复制，逐个覆盖）
  - `no`：取消整个操作，退出码 0
- 若有冲突且 **有** `--force`：**静默覆盖**冲突条目，不提示
- 若无冲突：正常复制（与当前行为相同，只是不删除已有文件）

**冲突提示输出格式**：

```
以下条目在 /Users/me/output 中已存在：
  - node_modules/
  - package.json
  - src/
是否覆盖所有冲突条目？(yes/no)
```

**设计理由**：展开模式下，用户意图是"把源目录的内容平铺到目标目录中"，可能是增量更新。这时不应粗暴删除整个目标目录，而应逐个检查条目冲突，让用户决定。

**关于 `copyOutput`**：展开模式确认覆盖后，直接调用现有的 `copyOutput(workDir, gitDir, localDir, false, true)` 即可。`copyOutput` 使用 `force: true` 复制，会覆盖冲突条目，同时保留目标目录中源目录不存在的条目。无需特殊处理。

### 3.3 文件模式（`path/to/file`，有文件扩展名）

**行为改变**：

- **不再**在 clone 前检查目标目录是否存在
- 先完成 clone 到临时目录
- 在 `copyOutput` **之前**，检查目标文件（`<localDir>/<basename>`）是否存在
- 若文件存在且 **没有** `--force`：交互提示"文件 XXX 已存在，是否替换？(yes/no)"
  - `yes`：覆盖文件（使用 `fs.cp` + `force: true`）
  - `no`：取消操作，退出码 0
- 若文件存在且 **有** `--force`：静默覆盖，不提示
- 若文件不存在：正常复制

**文件替换提示输出格式**：

```
文件 /Users/me/output/package.json 已存在，是否替换？(yes/no)
```

**设计理由**：文件模式下，用户只关心单个文件是否被覆盖，不应检查整个目录是否存在。

**可选优化**：文件模式的目标路径（`<localDir>/<basename>`）是确定的，与展开模式不同（需要先 clone 才知道源目录中的条目）。因此文件模式可**提前到 clone 前**检测目标文件是否存在，避免不必要的 clone 操作。但当前设计统一放在 clone 后，使三种模式的主流程更一致，且 clone 后还能验证源文件实际存在。建议实现时采用"clone 前检查目标文件 → 若存在且非 force 则询问 → 若用户取消则跳过 clone"的策略，若 clone 后发现源文件不存在则报错。

---

## 4. 交互提示汇总

| 模式 | 触发条件 | 提示文案 | `--force` 行为 |
|------|----------|----------|----------------|
| **目录模式** | `effectiveDir` 存在且非空 | `目录 XXX 已存在，是否覆盖？(yes/no)` | 静默删除整个目录 |
| **展开模式** | 源目录第一层条目与目标目录冲突 | `以下条目在 XXX 中已存在：\n  - a/\n  - b/\n是否覆盖所有冲突条目？(yes/no)` | 静默覆盖冲突条目 |
| **文件模式** | 目标文件已存在 | `文件 XXX 已存在，是否替换？(yes/no)` | 静默覆盖文件 |

---

## 5. CliOptions 接口变更

```typescript
interface CliOptions {
  gitUrl: string;
  gitDir: string;
  resolvedGitDir: string;
  localDir?: string;
  resolvedLocalDir?: string;
  trailingSlash: boolean;
  expandMode: boolean;
  branch: string;
  quiet: boolean;
  force: boolean;        // ← 新增
}
```

---

## 6. 内部实现变更

### 6.1 parseArgs 变更

- 增加 `-F, --force` 选项定义
- `force` 默认值 `false`

### 6.2 index.ts 主流程变更

**当前流程**（简化）：

```
parseArgs → validateGit → ensureOutputDir → createTempDir → clone → copyOutput → cleanup
                                ↑
                         如果 DirExistsError → promptOverwrite → 删除整个目录 or cancel
```

**新流程**（简化）：

```
parseArgs → validateGit
  │
  ├─ 目录模式 → ensureOutputDir(effectiveDir, force) → (删除或跳过) → createTempDir → clone → copyOutput → cleanup
  │                  ↑
  │          如果 DirExistsError → promptOverwrite / force 静默删除
  │
  └─ 展开/文件模式 → createTempDir → clone → checkConflicts → copyOutput → cleanup
                           ↑
                    展开模式 → getFirstLevelConflicts → promptConflictOverwrite / force 跳过
                    文件模式 → stat(destFile) → promptReplaceFile / force 跳过
```

具体伪代码：

```typescript
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const effectiveDir = computeEffectiveDir(
    options.resolvedLocalDir ?? /* ... */,
    options.resolvedGitDir,
    options.trailingSlash,
    options.expandMode,
  );

  // ───────────── 目录模式：clone 前检查（避免无效 clone） ─────────────
  if (!options.expandMode && !isFilePath(options.resolvedGitDir)) {
    try {
      await ensureOutputDir(effectiveDir);
    } catch (err) {
      if (err instanceof DirExistsError) {
        // --force 跳过交互，直接删除
        if (!options.force) {
          const shouldOverwrite = await promptOverwrite(effectiveDir);
          if (!shouldOverwrite) {
            console.log('cancelled');
            process.exit(0);
          }
        }
        await cleanupTempDir(effectiveDir);
      } else {
        throw err;
      }
    }
  }
  
  // ───────────── 展开模式 + 文件模式：先 clone，后冲突检测 ─────────────
  let tempDir = await createTempDir();
  
  try {
    await sparseClone({ ... });
    
    if (options.expandMode) {
      // 展开模式：扫描源目录第一层 vs 目标目录
      const sourceDir = path.join(tempDir, options.resolvedGitDir);
      const conflicts = await getFirstLevelConflicts(sourceDir, effectiveDir);
      
      if (conflicts.length > 0 && !options.force) {
        const shouldOverwrite = await promptConflictOverwrite(effectiveDir, conflicts);
        if (!shouldOverwrite) {
          console.log('cancelled');
          process.exit(0);
        }
      }
      // force 或用户确认 → copyOutput 用 force:true 逐个覆盖冲突条目
    } else if (isFilePath(options.resolvedGitDir)) {
      // 文件模式：检查目标文件是否存在
      // ⚠️ isFilePath() 需从 cli.ts 中导出供此处调用
      // ⚠️ 使用 resolvedLocalDir 而非 effectiveDir（effectiveDir 在 trailingSlash
      //    时会追加 gitDir 的 basename，导致路径重复，如 ./output/package.json/package.json）
      const localDirBase = options.resolvedLocalDir ?? resolvedLocalDir;
      const destFile = path.join(localDirBase, path.basename(options.resolvedGitDir));
      try {
        await fs.promises.stat(destFile);
        if (!options.force) {
          const shouldReplace = await promptReplaceFile(destFile);
          if (!shouldReplace) {
            console.log('cancelled');
            process.exit(0);
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        // 文件不存在 → 正常继续
      }
    }
    // 目录模式已在 clone 前完成检查，此处直接复制
    
    // ───────────── 复制 ─────────────
    await copyOutput(tempDir, options.resolvedGitDir, resolvedLocalDir, ...);
    
    await cleanupTempDir(tempDir);
    tempDir = '';
    
    console.log(`save at ${effectiveDir}`);
    process.exit(0);
  } catch (err) {
    if (tempDir) await cleanupTempDir(tempDir).catch(() => {});
    // ... 错误处理
  }
}
```

### 6.3 新增工具函数

#### `promptConflictOverwrite(dir: string, conflicts: string[]): Promise<boolean>`

列出冲突条目并询问用户是否覆盖：

```typescript
async function promptConflictOverwrite(dir: string, conflicts: string[]): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolve) => {
    const ask = () => {
      const conflictList = conflicts.map(c => `  - ${c}`).join('\n');
      // readline.question 使用 process.stdout.write，
      // \n 在 Unix/macOS/Windows 上均能正确换行，无需特殊处理
      rl.question(
        `以下条目在 ${dir} 中已存在：\n${conflictList}\n是否覆盖所有冲突条目？(yes/no)\n`,
        (answer) => {
          const trimmed = answer.trim().toLowerCase();
          if (trimmed === 'yes') { rl.close(); resolve(true); }
          else if (trimmed === 'no') { rl.close(); resolve(false); }
          else ask();
        }
      );
    };
    ask();
  });
}
```

#### `promptReplaceFile(filePath: string): Promise<boolean>`

询问用户是否替换已存在的文件：

```typescript
async function promptReplaceFile(filePath: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolve) => {
    const ask = () => {
      rl.question(`文件 ${filePath} 已存在，是否替换？(yes/no)\n`, (answer) => {
        const trimmed = answer.trim().toLowerCase();
        if (trimmed === 'yes') { rl.close(); resolve(true); }
        else if (trimmed === 'no') { rl.close(); resolve(false); }
        else ask();
      });
    };
    ask();
  });
}
```

#### `getFirstLevelConflicts(sourceDir: string, targetDir: string): Promise<string[]>`

扫描源目录第一层，返回在目标目录中已存在的条目列表（并添加目标目录不存在的短路逻辑）：

```typescript
async function getFirstLevelConflicts(sourceDir: string, targetDir: string): Promise<string[]> {
  const conflicts: string[] = [];

  // 快速短路：目标目录不存在 → 无冲突（避免 N 次无意义 stat）
  try {
    await fs.promises.stat(targetDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  
  try {
    const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      const targetPath = path.join(targetDir, entry.name);
      try {
        await fs.promises.stat(targetPath);
        conflicts.push(entry.name + (entry.isDirectory() ? '/' : ''));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        // Not found → no conflict
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // sourceDir doesn't exist yet (edge case) — no conflicts
      return [];
    }
    throw err;
  }
  
  return conflicts;
}
```

#### `isFilePath(pathStr: string): boolean`（需从 `cli.ts` 中导出）

检测路径最后一段是否有文件扩展名。当前在 `src/cli.ts:29-32` 定义为文件内函数（未 `export`），外部无法引用。

**需要修改**：在 `cli.ts` 中将 `isFilePath` 标记为 `export`，或在 `utils.ts` 中重新实现。建议直接导出复用，避免重复代码。

### 6.4 错误处理变更

- `DirExistsError` 在展开模式和文件模式下不再被 `main` 流程使用（冲突检测前移）
- `DirExistsError` 仍用于目录模式
- 新增 `CancelError` 已在 errors.ts 中存在，可复用

### 6.5 关于 `ensureOutputDir` 与 `--force` 的说明

`ensureOutputDir` 函数本身**不修改**，它的职责不变：检查目录是否存在且非空，若是则抛出 `DirExistsError`。`--force` 的处理由**调用方**（`index.ts` 的 `main` 函数）负责：

```typescript
// 调用方处理 --force
try {
  await ensureOutputDir(effectiveDir);
} catch (err) {
  if (err instanceof DirExistsError) {
    if (!options.force) {
      const shouldOverwrite = await promptOverwrite(effectiveDir);
      if (!shouldOverwrite) { /* exit */ }
    }
    // force 或用户确认 → 删除
    await cleanupTempDir(effectiveDir);
  }
}
```

`ensureOutputDir` 不感知 `--force`，保持单一职责。若希望减少调用方复杂度，`ensureOutputDir` 也可以增加可选的 `force` 参数：当 `force=true` 且目录存在时直接删除并返回（不抛出），但这**不是强制变更**。

---

## 7. 测试用例

### 7.1 单元测试 —— CLI 参数解析 (`test/cli.test.ts`)

| 用例 | 输入 | 期望 |
|------|------|------|
| `--force` 解析 | `... --force` | `options.force === true` |
| `-F` 短选项解析 | `... -F` | `options.force === true` |
| 无 force 选项 | `...` | `options.force === false` |

### 7.2 单元测试 —— 冲突检测 (`test/conflict.test.ts` 或新增到 `test/clone.test.ts`)

| 用例 | 描述 |
|------|------|
| `getFirstLevelConflicts` 无冲突 | 源目录条目在目标目录中均不存在 → 返回空数组 |
| `getFirstLevelConflicts` 有冲突 | 部分条目同名存在 → 返回冲突条目列表 |
| `getFirstLevelConflicts` 源目录不存在 | 源目录不存在 → 返回空数组（不抛错） |
| `getFirstLevelConflicts` 混合文件和目录 | 正确区分文件和目录的冲突 |
| `promptConflictOverwrite` 输入 yes | resolve(true) |
| `promptConflictOverwrite` 输入 no | resolve(false) |
| `promptReplaceFile` 输入 yes | resolve(true) |
| `promptReplaceFile` 输入 no | resolve(false) |

### 7.3 集成测试 (`test/clone.integration.test.ts`)

**用例 1：展开模式 + 有冲突 + 用户选 yes**

```
步骤：
  1. 先创建目标目录并放入一个文件（如 README.md）
  2. 运行 git-pull-dir <repo> src/* <target> （通过 stdin 输入 yes）

验证：
  - 退出码 0
  - 源目录中的文件被复制到目标
  - 目标中已有的同名文件被覆盖
  - 目标中已有的其他文件（不在源中的）被保留
```

**用例 2：展开模式 + 有冲突 + `--force`**

```
步骤：
  1. 先创建目标目录并放入一个文件
  2. 运行 git-pull-dir --force <repo> src/* <target>

验证：
  - 退出码 0
  - 静默覆盖，无交互提示
  - 目标中已有的同名文件被覆盖
  - 目标中已有的其他文件被保留
```

**用例 3：文件模式 + 文件已存在 + 用户选 no**

```
步骤：
  1. 先创建目标目录并放入一个同名文件
  2. 运行 git-pull-dir <repo> package.json <target> （输入 no）

验证：
  - 退出码 0
  - 输出 "cancelled"
  - 目标文件未被修改
```

**用例 4：文件模式 + `--force` + 文件已存在**

```
步骤：
  1. 先创建目标目录并放入一个同名文件
  2. 运行 git-pull-dir --force <repo> package.json <target>

验证：
  - 退出码 0
  - 文件被静默覆盖
```

**用例 5：目录模式 + `--force`（传统行为的 force 版本）**

```
步骤：
  1. 先创建一个非空目标目录
  2. 运行 git-pull-dir --force <repo> packages/core <target>

验证：
  - 退出码 0
  - 原目录被删除重建（目录模式行为）
  - 无交互提示
```

**用例 6：展开模式 + 无冲突（目标目录为空或不存在）**

```
输入：
  git-pull-dir <repo> src/* <empty-dir>

验证：
  - 退出码 0
  - 正常复制
  - 无交互提示
```

---

## 8. 输出示例

### 展开模式冲突交互

```bash
$ git-pull-dir https://github.com/facebook/react-native.git src/* ./output
以下条目在 /Users/me/output 中已存在：
  - index.ts
  - utils/
是否覆盖所有冲突条目？(yes/no)
yes
clone in...
setting sparse-checkout...
checkout...
save at /Users/me/output
```

```bash
$ git-pull-dir --force https://github.com/facebook/react-native.git src/* ./output
clone in...
setting sparse-checkout...
checkout...
save at /Users/me/output
```

### 文件模式交互

```bash
$ git-pull-dir https://github.com/facebook/react-native.git package.json ./output
文件 /Users/me/output/package.json 已存在，是否替换？(yes/no)
no
cancelled
```

### 目录模式 + --force

```bash
$ git-pull-dir --force https://github.com/facebook/react-native.git packages/core ./my-core
clone in...
setting sparse-checkout...
checkout...
save at /Users/me/my-core
```

---

## 9. 边界情况

### 9.1 目标目录已存在但为空

所有模式下，若目标目录存在但为空，均视为"无冲突"，直接复制，不提示。

### 9.2 `--quiet` + `--force` 同时使用

- `--quiet` 控制步骤输出（spinner vs 详情）
- `--force` 控制交互提示
- 两者独立，同时使用时：无步骤文字、无交互提示、直接覆盖

### 9.3 `--force` 不跳过目录模式的删除

目录模式下 `--force` 跳过**交互提示**，但仍会执行删除整个目录的操作（与用户说 yes 效果相同）。这是有意设计——目录模式的语义就是替换整个目录。

### 9.4 展开模式 + 目标目录中已有同名目录但不是文件夹

若源中的 `utils/` 在目标中是一个普通文件，视为冲突，提示覆盖。用户选 yes 则 `fs.cp` + `force: true` 会覆盖。

### 9.5 文件模式 + 目标文件是目录

若目标路径是一个已存在的目录而非文件，视为冲突，提示"文件/目录已存在"。

---

## 10. 不纳入本次变更的内容

| 功能 | 原因 |
|------|------|
| 逐个条目确认覆盖 | 用户体验差，当前实现为一次性确认所有冲突 |
| 递归冲突检测 | 只检测第一层，深层文件冲突由 fs.cp + force:true 静默覆盖 |
| `--interactive` 或类似模式 | 当前确认机制已足够 |
| 删除源目录中不存在的目标条目 | 展开模式是增量更新，不删除额外文件 |
