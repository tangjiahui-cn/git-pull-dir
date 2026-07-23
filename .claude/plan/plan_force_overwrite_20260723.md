# Plan: git-pull-dir `--force` 与精细化覆盖冲突处理

> 基于 `.claude/spec/spec_force_overwrite_20260723.md`
> 状态: 待执行

---

## 1. 变更文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/cli.ts` | 修改 | `CliOptions` 接口增加 `force` 字段；`isFilePath` 改为 `export` |
| `src/clone.ts` | 修改 | 新增 `getFirstLevelConflicts` |
| `src/utils.ts` | 修改 | 新增 `promptConflictOverwrite`、`promptReplaceFile` |
| `src/index.ts` | 修改 | 主流程三种模式分支 + `force` 处理；`import { isFilePath }` |
| `test/cli.test.ts` | 修改 | 新增 `--force` / `-F` 参数解析测试 |
| `test/clone.test.ts` | 修改 | 新增冲突检测单元测试 |
| `test/clone.integration.test.ts` | 修改 | 新增 6 个集成测试用例 |

---

## 2. 分步实现

### Step 0 — 环境准备

**确保 Node.js >= 20，使用 pnpm 管理依赖：**

```bash
# 1. 检查 Node 版本，不足 20 则用 nvm 切换
node -e "process.exit(Number(process.version.slice(1).split('.')[0] < 20))" || nvm use 20

# 2. 检查 pnpm 可用
which pnpm || npm i -g pnpm

# 3. 安装依赖（如果 node_modules 不存在）
pnpm install

# 4. 检查工作区是否有未提交变更
git status --porcelain
```

- Node 版本 < 20 → 自动 `nvm use 20` 切换
- pnpm 未安装 → 全局安装
- 若存在未提交变更 → 要求用户先提交
- 若干净 → 继续

---

### Step 1 — `CliOptions` 接口增加 `force` 字段

**文件**: `src/cli.ts`

- 在 `CliOptions` 接口中新增 `force: boolean`
- 在 `parseArgs` 中增加 `-F, --force` 选项定义
- `force` 默认值 `false`
- 将 `isFilePath` 函数标记为 `export`

---

### Step 2 — 新增工具函数

**文件**: `src/clone.ts`

新增一个 `export` 函数 `getFirstLevelConflicts`（与 `copyOutput` 同类，属文件系统扫描）：

1. **`getFirstLevelConflicts(sourceDir: string, targetDir: string): Promise<string[]>`**
   - 扫描源目录第一层条目，返回在目标目录中已存在的同名条目列表
   - 目标目录不存在时快速短路返回空数组
   - 目录名附带 `/` 后缀以区分文件和目录

**文件**: `src/utils.ts`（与现有 `promptOverwrite` 同类，保持交互提示函数内聚）

新增两个 `export` 函数：

2. **`promptConflictOverwrite(dir: string, conflicts: string[]): Promise<boolean>`**
   - 列出冲突条目并询问用户是否覆盖
   - 只有 `yes` / `no` 有效输入，其他输入重复询问

3. **`promptReplaceFile(filePath: string): Promise<boolean>`**
   - 询问用户是否替换已存在的文件
   - 只有 `yes` / `no` 有效输入，其他输入重复询问

---

### Step 3 — `index.ts` 主流程改造

**文件**: `src/index.ts`

- 在 `import` 中增加 `isFilePath`（从 `./cli.js` 导入）
- 三种模式判定逻辑：
  - `options.expandMode === true` → **展开模式**
  - `isFilePath(options.resolvedGitDir) === true` → **文件模式**
  - 默认 → **目录模式**

改造 `main` 函数，根据三种模式走不同分支：

**目录模式（默认，无 `/*`，非文件路径）**：
- clone **前**检查 `effectiveDir` 是否存在且非空
- 若存在且非空：
  - 无 `--force`：交互提示 → yes 则删除整个目录继续，no 则取消
  - 有 `--force`：静默删除整个目录，不提示

**展开模式（`dir/*`）**：
- 跳过 clone 前检查，直接 clone
- clone 后扫描源目录第一层，调用 `getFirstLevelConflicts`
- 有冲突：
  - 无 `--force`：调用 `promptConflictOverwrite` → yes 则覆盖全部冲突，no 则取消
  - 有 `--force`：静默覆盖，不提示
- 无冲突：直接复制
- ⚠️ **资源清理**：用户选 "no" 取消时，需在 `process.exit(0)` 前清理 `tempDir` 和 SIGINT 处理器，否则 `/tmp/git-pull-dir-xxxxx` 残留

**文件模式（有文件扩展名）**：
- 跳过 clone 前检查，直接 clone
- clone 后检查目标文件是否存在（使用 `resolvedLocalDir` 而非 `effectiveDir`，避免路径重复）
- 文件已存在：
  - 无 `--force`：调用 `promptReplaceFile` → yes 则覆盖，no 则取消
  - 有 `--force`：静默覆盖，不提示
- ⚠️ **边界情况**：若目标路径是一个已存在的目录而非文件，同样视为冲突
  - 无 `--force`：提示「文件/目录 XXX 已存在，是否替换？(yes/no)」
  - 有 `--force`：静默删除该目录，继续复制
- 文件不存在：直接复制
- ⚠️ **资源清理**：用户选 "no" 取消时，需在 `process.exit(0)` 前清理 `tempDir` 和 SIGINT 处理器

**`--force` 与 `--quiet` 关系**：两者独立，同时使用时 → 无步骤输出、无交互提示、直接覆盖。

---

### Step 4 — 新增单元测试

**文件**: `test/cli.test.ts`

| 用例 | 说明 |
|------|------|
| `--force` 解析 | `options.force === true` |
| `-F` 短选项解析 | `options.force === true` |
| 无 force 选项 | `options.force === false` |

**文件**: `test/clone.test.ts`

| 用例 | 说明 |
|------|------|
| `getFirstLevelConflicts` 无冲突 | 返回空数组 |
| `getFirstLevelConflicts` 有冲突 | 返回冲突条目列表 |
| `getFirstLevelConflicts` 源目录不存在 | 返回空数组（不抛错） |
| `getFirstLevelConflicts` 混合文件和目录 | 正确区分文件/目录冲突 |
| `promptConflictOverwrite` 输入 yes | `resolve(true)` |
| `promptConflictOverwrite` 输入 no | `resolve(false)` |
| `promptReplaceFile` 输入 yes | `resolve(true)` |
| `promptReplaceFile` 输入 no | `resolve(false)` |

---

### Step 5 — 新增集成测试

**文件**: `test/clone.integration.test.ts`

> ⚠️ 用例 1、3 需要 stdin 交互（输入 "yes"/"no"），需在测试准备工作中改造 `runCli` 辅助函数：
>
> ```typescript
> async function runCli(args: string[], input?: string): Promise<...> {
>   const result = await execa('node', ['dist/index.cjs', ...args], {
>     timeout: 180_000,
>     reject: false,
>     input,  // 注入 stdin
>   });
> }
> ```

| 用例 | 场景 | 验证点 |
|------|------|--------|
| 1 | 展开模式 + 有冲突 + 用户选 yes | 退出码 0，冲突文件覆盖，其他文件保留 |
| 2 | 展开模式 + 有冲突 + `--force` | 静默覆盖，无交互，其他文件保留 |
| 3 | 文件模式 + 文件已存在 + 用户选 no | 退出码 0，输出 "cancelled"，文件不变 |
| 4 | 文件模式 + `--force` + 文件已存在 | 静默覆盖 |
| 5 | 目录模式 + `--force` | 目录删除重建，无交互 |
| 6 | 展开模式 + 无冲突（目标目录空或不存在） | 正常复制，无交互 |

---

### Step 6 — 验证与收尾

```bash
pnpm run build        # 确保 TypeScript 编译通过
pnpm run test         # 全部测试通过
```

> 注：当前项目未安装 coverage provider（需 `@vitest/coverage-v8`），且 vitest 在 Node 环境下 `--coverage` 有 `crypto.getRandomValues` 兼容性问题。故不纳入本次变更。

- `--force` 不影响现有非 force 场景的任何行为
- 确认所有 `console.log` / `process.exit` 调用符合 spec
