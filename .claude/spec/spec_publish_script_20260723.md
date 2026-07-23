# git-pull-dir — 发布前置检查脚本功能规格说明书

## 1. 概述

为项目新增一个 `release` 脚本，作为 `pnpm publish` 前的**前置检查与准备工作**。该脚本串联工作区检查、环境校验、测试、构建、版本号更新、Changelog 生成及 Git 推送等环节。脚本执行完成后，由用户手动执行 `pnpm publish` 完成最终发布。

### 1.1 动机

- 当前发版依赖开发者手动执行多个步骤（测试 → 构建 → 改版本号 → 生成 changelog → 打 tag → 推送），容易遗漏或出错
- 缺少统一的入口脚本，新维护者不清楚发版流程
- 需要在发版前保证：工作区干净、环境正确、测试通过、构建产物正常
- 将 `pnpm publish` 保留为独立步骤，方便开发者做最终确认，也利于 CI 场景灵活编排

### 1.2 脚本定位

| 属性 | 值 |
|------|-----|
| 脚本名称 | `release` |
| 类型 | 独立的 Node.js 脚本（`scripts/release.mjs`） |
| 注册为 | `package.json` `scripts.release` → `"node scripts/release.mjs"` |
| 调用方式 | `pnpm release` 或 `node scripts/release.mjs` |
| 执行模式 | 交互式（分步提示确认）+ 可跳过模式（`--yes`） |
| 职责边界 | 只做发布前的验证和准备，**不执行 `pnpm publish`** |

---

## 2. 前置依赖

### 2.1 环境要求

| 依赖 | 版本要求 | 当前状态 |
|------|----------|----------|
| Node.js | >= 20 | `package.json` `engines.node` 为 `>=18.0.0`，但 `.nvmrc` 为 `v20`，本规范以 `.nvmrc`（v20）为准 |
| pnpm | 项目已使用 | 脚本内部通过 `pnpm run` 执行测试和构建 |
| Git | 任意现代版本 | — |

> **关于 Node.js 版本不一致**：`package.json` 中 `engines.node` 为 `>=18.0.0`，但 `.nvmrc` 要求 `v20`。
>
> **行动计划**：在实现 release 脚本的同时，将 `package.json` 中的 `engines.node` 从 `>=18.0.0` 修改为 `>=20`，与 `.nvmrc` 保持一致。在此之前，脚本以 `>=20` 为准。

### 2.2 项目依赖（devDependencies）

| 依赖 | 用途 | 状态 |
|------|------|------|
| `conventional-changelog-cli` | 从 Git 提交历史生成 CHANGELOG.md | 已安装 ✓ |
| `cz-conventional-changelog` | Commitizen 适配器，规范提交信息 | 已安装 ✓ |

---

## 3. 脚本执行流程

### 3.1 总流程图

```
[开始]
   │
   ├─ 1. 检查 Git 工作区是否干净
   │     ├─ 干净 → 继续
   │     └─ 有变更 → 提示提交或中止
   │          ├─ --yes 模式 → 直接中止（退出码 1）
   │
   ├─ 2. 检查 Node.js 版本
   │     ├─ >= 20 → 继续
   │     └─ < 20 → 尝试 nvm use（读取 .nvmrc）
   │          ├─ 成功 → 继续
   │          └─ 失败/无 nvm → 中止
   │
   ├─ 3. 运行测试（pnpm test）
   │     ├─ 通过 → 继续
   │     └─ 失败 → 中止
   │
   ├─ 4. 运行构建（pnpm build）
   │     ├─ 成功 → 继续
   │     └─ 失败 → 中止
   │
   ├─ 5. 交互：选择版本号更新类型（major / minor / patch）
   │
   ├─ 6. 再次确认 Git 工作区干净
   │     ├─ 干净 → 执行 npm version <type>
   │     │     └─ 触发 version hook → 生成 Changelog → git add CHANGELOG.md
   │     └─ 不干净 → 中止（退出码 2）
   │
   └─ 7. 推送 Git 提交和 Tags 到远程
         └─ 完成 ✅ 提示可执行 pnpm publish
```

### 3.2 各步骤详细行为

#### 3.2.1 步骤 1：Git 工作区检查

**目标**：确保发布基于干净的 Git 工作区，避免未提交的代码被遗漏或意外发布。

```bash
git status --porcelain
```

**交互模式**（默认）：

| 结果 | 行为 |
|------|------|
| 输出为空（干净） | ✅ 自动继续 |
| 输出非空（有变更） | 列出变更文件 → **交互提示**："工作区有未提交的变更。请选择：<br>1. 提交变更并继续 — 自动执行 `git add -A` 并提示输入 commit message<br>2. 暂存(stash)变更并继续 — 自动执行 `git stash`<br>3. 中止流程"<br>用户选择 1 或 2 后自动执行对应操作；选择 3 则退出码 0 中止 |

**`--yes` 模式**：

| 结果 | 行为 |
|------|------|
| 输出为空（干净） | ✅ 自动继续 |
| 输出非空（有变更） | ❌ **直接中止**，退出码 1。提示："CI 模式下工作区必须干净，请手动处理未提交的变更后重试" |

**实现细节**：
- 选择"提交变更并继续"时：自动执行 `git add -A`，然后提示用户输入 commit message → 执行 `git commit -m "<message>"`。若用户未输入 message，使用默认值 `"chore: pre-release changes"`。
- 选择"暂存变更并继续"时：自动执行 `git stash`，并在脚本结束时（步骤 7 完成后）提示 `git stash pop` 恢复。
- `--yes` 模式下不提供交互选项，直接中止。

#### 3.2.2 步骤 2：Node.js 版本检查

**目标**：确保发布时使用的 Node.js 版本符合要求（>= 20）。

```bash
node -v   # 输出 v20.x.x 或更高
```

| 条件 | 行为 |
|------|------|
| `>= 20` | ✅ 自动继续 |
| `< 20` | 提示"当前 Node.js 版本为 vxx，需要 v20+" → 尝试 `nvm use`（不带参数，自动读取 `.nvmrc` 中的 `v20`） → 若 `nvm` 不存在或切换失败，**中止**流程，退出码 1 |

**nvm 检测方法**：通过检查 `NVM_DIR` 环境变量或 `command -v nvm` 判断。

> 项目根目录已有 `.nvmrc`，内容为 `v20`。因此 `nvm use` 无需指定版本号，自动读取 `.nvmrc`。

#### 3.2.3 步骤 3：运行测试

**目标**：确保构建前代码逻辑正确。

```bash
pnpm test
```

| 结果 | 行为 |
|------|------|
| 退出码 0 | ✅ 自动继续 |
| 退出码非 0 | ❌ **中止**流程，退出码 1，显示测试失败输出 |

#### 3.2.4 步骤 4：运行构建

**目标**：确保构建产物（如 `dist/` 目录）生成正常。

```bash
pnpm build
```

| 结果 | 行为 |
|------|------|
| 退出码 0 | ✅ 自动继续 |
| 退出码非 0 | ❌ **中止**流程，退出码 1，显示构建失败输出 |

#### 3.2.5 步骤 5：交互选择版本号更新类型

**目标**：让用户指定本次发布的版本号更新类型。

```bash
# 非交互式用法（CI/自动化）
pnpm release -- --type=patch

# 交互式用法（默认）
# 提供 major / minor / patch / premajor / preminor / prepatch / prerelease 选项
```

**交互方式**：使用 Node.js 内置 `readline` 模块或社区工具（如 `inquirer` / `enquirer`），提供选择列表。

**默认值**：`patch`（最常见的小版本发布）。

**支持参数**：
- `--type=<type>` 或 `-t <type>`：跳过交互，直接使用指定类型

#### 3.2.6 步骤 6：执行 `npm version`

**目标**：更新 `package.json` 中的版本号，并通过 npm lifecycle hooks 触发 Changelog 生成和 Git tag 创建。

**前置检查**：在执行 `npm version` 前，**再次快速确认 Git 工作区干净**（`git status --porcelain`）。因为：
- 若跳过了步骤 1（`--skip=check-git`），工作区可能不干净
- `npm version` 在 dirty 工作区会失败

若不干净则中止，退出码 2。

```bash
npm version <type> -m "chore(release): v%s"
```

**`package.json` 中需配置的 hooks**：

```json
{
  "scripts": {
    "changelog": "conventional-changelog -p angular -i CHANGELOG.md -s",
    "version": "pnpm changelog && git add CHANGELOG.md"
  }
}
```

| Hook | 触发时机 | 行为 |
|------|----------|------|
| `version` | `npm version` 修改 `package.json` 后、git commit / tag 前 | 1. 运行 `conventional-changelog` 基于 commit 记录生成/更新 CHANGELOG.md（使用 `pnpm changelog`）<br>2. `git add CHANGELOG.md` 将 changelog 纳入本次 version commit |

**注意事项**：
- `postversion` hook 不在此处配置——Git 推送由发布脚本的步骤 7 统一管理。
- 当前 `package.json` 中已有 `"postversion": "git push --follow-tags"`，该 hook 与步骤 7 功能重复，需要**删除**此项。
- commit message 模板可通过 `release.config.json` 的 `commitMessage` 字段自定义（见 §4.1）。
- 删除 `postversion` 后，若开发者直接执行 `npm version <type>`（不通过 release 脚本），将不会自动推送 commit 和 tag 到远程。建议使用 `pnpm release` 以获取完整的推送流程，或手动执行 `git push --follow-tags`。

#### 3.2.7 步骤 7：推送 Git 提交和 Tags 到远程

**目标**：将版本发布 commit 和 tag 推送到远程。

```bash
git push <remote> <current-branch>
git push <remote> --tags
```

| 结果 | 行为 |
|------|------|
| 推送成功 | ✅ 显示"✅ 前置准备完成！请执行 `pnpm publish` 完成发布" |
| 推送失败 | ❌ **中止**流程，显示错误信息，退出码 3 |

**错误处理**：
- `git push <remote> <branch>` 失败 → 显示错误，**中止**流程
- `git push <remote> --tags` 失败 → 显示错误，**中止**流程

**远程名称**：默认 `origin`，可通过 `--remote` 参数或 `release.config.json` 的 `remoteName` 字段覆盖（见 §4.1 / §4.2）。

---

## 4. 脚本入口与 CLI 参数

### 4.1 配置文件

脚本约定配置文件 `release.config.json`（位于项目根目录），用于定制发布行为。**该文件需手动创建并提交到 Git 管理**（属于项目共享配置）。建议初始内容为所有字段显式填写默认值，便于开发者即时修改：

```json
{
  "nodeVersion": ">=20",
  "buildScript": "build",
  "testScript": "test",
  "remoteName": "origin",
  "pushBranch": "master",
  "commitMessage": "chore(release): v%s"
}
```

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `nodeVersion` | `>=20` | 要求的 Node.js 版本范围 |
| `buildScript` | `build` | 构建的 pnpm script 名称 |
| `testScript` | `test` | 测试的 pnpm script 名称 |
| `remoteName` | `origin` | 推送的 remote 名称 |
| `pushBranch` | `master` | 推送的目标分支 |
| `commitMessage` | `chore(release): v%s` | `npm version` 的 commit message 模板，`%s` 会被替换为版本号 |

**配置文件加载策略**：

| 场景 | 行为 |
|------|------|
| 文件不存在 | ✅ 全部使用硬编码默认值，继续执行 |
| 文件存在但 JSON 解析失败 | ❌ **中止**，退出码 1，显示解析错误和文件路径 |
| 文件存在但某字段缺失 | ✅ 缺失的字段使用默认值，已有字段覆盖默认值 |
| 文件存在但有未知字段 | ✅ 忽略未知字段，不报错 |

### 4.2 CLI 参数

```bash
node scripts/release.mjs [options]
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `-h, --help` | boolean | — | 显示帮助信息并退出 |
| `-t, --type <type>` | string | 交互选择 | 版本更新类型：`major` / `minor` / `patch` / `premajor` / `preminor` / `prepatch` / `prerelease` |
| `-d, --dry-run` | boolean | false | 模拟运行，只输出各步骤将执行的操作，不实际更改任何文件、不推送、不打 tag。若同时指定 `--yes`，则必须同时提供 `--type` |
| `-s, --skip <steps>` | string | — | 跳过指定步骤，逗号分隔。可用值：`check-git`, `check-node`, `test`, `build`, `version`, `push`。<br>跳过的步骤不会以任何形式执行，包括其前置条件验证。若跳过了 `check-node` 但当前 Node.js 版本不满足要求，后续步骤可能因环境问题失败——这是用户主动跳过的预期行为，脚本不额外拦截。 |
| `-y, --yes` | boolean | false | 跳过所有交互确认（CI 模式）。若工作区不干净则直接中止（退出码 1）。<br>与 `--dry-run` 组合使用时，**必须同时提供 `--type`** 指定版本类型，否则中止并提示错误。 |
| `-r, --remote <name>` | string | `origin` | 推送目标 remote 名称，优先级高于 `release.config.json` 的 `remoteName` |

### 4.3 步骤标识

| 步骤 | 标识 | `--skip` 值 |
|------|------|-------------|
| Git 工作区检查 | `check-git` | `check-git` |
| Node 版本检查 | `check-node` | `check-node` |
| 测试 | `test` | `test` |
| 构建 | `build` | `build` |
| 版本更新 | `version` | `version` |
| Git 推送 | `push` | `push` |

---

## 5. 与现有 `prepublishOnly` 的关系

### 5.1 现状

`package.json` 中已有 `prepublishOnly` hook：

```json
{
  "prepublishOnly": "pnpm run build && pnpm test"
}
```

该 hook 会在每次 `pnpm publish` 前自动运行 test 和 build。

### 5.2 重叠问题

release 脚本的步骤 3（test）和步骤 4（build）与 `prepublishOnly` 的功能重叠。当开发者执行：

```bash
pnpm release && pnpm publish
```

test 和 build 会被执行两遍。

### 5.3 方案选择

| 方案 | 做法 | 评价 |
|------|------|------|
| **A（推荐）** | 保留 `prepublishOnly`，不做特殊处理 | 第二次执行是幂等的，虽多花几十秒但保证了 `pnpm publish` 时不会漏掉构建。简单、安全。 |
| **B** | 发布时使用 `pnpm publish --ignore-scripts` 跳过 `prepublishOnly` | 减少重复时间，但增加了出错风险（可能忘记跳转而重复，或错误地跳过了必要构建）。 |
| **C** | 移除 `prepublishOnly`，完全依赖 release 脚本 | 需要开发者严格遵循 `pnpm release && pnpm publish` 流程；若直接执行 `pnpm publish` 会跳过 test/build。 |

**本项目采用方案 A**：保留 `prepublishOnly`，接受 test/build 在 pipeline 中被执行两次。第二次执行的成本低（缓存 + 幂等），安全性更高。

---

## 6. 退出码约定

| 退出码 | 含义 |
|--------|------|
| 0 | 全部完成 或 用户主动中止（非错误） |
| 1 | 前置检查失败（工作区不干净 / 环境 / 测试 / 构建 / 配置文件解析失败） |
| 2 | 版本号操作失败（`npm version` 错误或 Git 工作区在步骤 6 不干净） |
| 3 | 推送失败 |

---

## 7. 开发与调试指引

```bash
# 查看帮助
node scripts/release.mjs --help

# Dry-run 模式：不实际改任何文件、不推送
node scripts/release.mjs --dry-run

# 跳过耗时步骤，只调试版本更新和推送
node scripts/release.mjs --skip=test,build

# CI 模式（无交互），指定 patch 版本更新
node scripts/release.mjs --yes --type=patch

# 调试模式：设置 DEBUG=1 输出详细执行日志
DEBUG=1 node scripts/release.mjs
```

`--dry-run` 模式下脚本行为：
- 步骤 1：正常执行检查
- 步骤 2：正常执行 `node -v` 检查，若版本不满足要求，输出"将执行：nvm use"，但**不实际执行** `nvm use`
- 步骤 3-4：输出"将执行：pnpm test/build"，不实际运行
- 步骤 5：正常交互或读取参数
- 步骤 6：输出"将执行：npm version <type> -m ..."，不实际运行
- 步骤 7：输出"将执行：git push ..."，不实际推送

---

## 8. 回滚指南

若脚本执行完成后发现问题（如推送了错误的 version commit 或 tag），可执行以下回滚操作：

```bash
# 删除远程 tag
git push origin :refs/tags/v<version>

# 删除远程 commit（谨慎操作，需要 force push）
git push origin <commit-hash>:<branch> --force

# 本地回退一个 commit
git reset --hard HEAD~1

# 删除本地 tag
git tag -d v<version>
```

> **回滚后修复问题**，重新执行 `pnpm release` 再次走完整流程。

---

## 9. 输出示例

### 9.1 执行成功

```
🚀 git-pull-dir v0.3.2 发布前置检查
────────────────────────────────────

[1/7] 检查 Git 工作区... ✅ 工作区干净

[2/7] 检查 Node.js 版本... ✅ v20.11.0

[3/7] 运行测试...
    PASS  test/index.test.js
    PASS  test/pull-dir.test.js
    ✅ 测试全部通过

[4/7] 运行构建... ✅ 构建成功

[5/7] 选择版本更新类型
    ❯ patch (0.3.1 → 0.3.2)
      minor (0.3.1 → 0.4.0)
      major (0.3.1 → 1.0.0)

[6/7] 执行 npm version patch...
    package.json: 0.3.1 → 0.3.2
    CHANGELOG.md 已更新
    Git tag v0.3.2 已创建 ✅

[7/7] 推送 Git 提交和 tags...
    → origin master ✓
    → tags ✓

────────────────────────────────────
✅ 前置准备完成！
请执行 `pnpm publish` 完成发布。
```

### 9.2 环境检查失败中止

```
[1/7] 检查 Git 工作区... ✅ 工作区干净

[2/7] 检查 Node.js 版本... ❌ v18.19.0 (<20)
  尝试 nvm use...（读取 .nvmrc v20）
  → nvm 未安装
  ❌ 请安装 Node.js v20+ 后重试。
  中止发布流程。
```

### 9.3 --yes 模式下工作区不干净

```
[1/7] 检查 Git 工作区... ❌ 工作区有未提交的变更
  → --yes 模式下工作区必须干净
  ❌ 请手动处理未提交的变更后重试。
  中止发布流程。（退出码 1）
```

---

## 10. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `scripts/release.mjs` | **新增** | 发布前置检查脚本主文件 |
| `release.config.json` | **新增** | 发布配置文件。需手动创建并提交到 Git 管理 |
| `package.json` | 修改 | 将 `engines.node` 从 `>=18.0.0` 提升至 `>=20`；在 `scripts` 中添加 `"release": "node scripts/release.mjs"`；**移除** `"postversion": "git push --follow-tags"` |
| `.claude/spec/spec_publish_script_20260723.md` | **新增** | 本文档 |
| `suggest-spec.md` | **删除** | 审查建议文件，建议内容已合并入本规范 |
