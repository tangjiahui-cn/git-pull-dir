# git-pull-dir — Changelog 功能规格说明书

## 1. 概述

为项目增加标准化的变更记录（Changelog）机制，使每次发布都能自动生成清晰的版本更新日志，同时规范 Git 提交信息的书写格式。

### 1.1 动机

- 当前项目缺少 Changelog，无法追踪每次发版的具体变更内容
- 提交信息（commit message）缺乏统一格式，不利于生成可读的发布记录
- 需要通过 Conventional Commits 规范约束提交信息，并基于此自动生成 Changelog

### 1.2 采用工具

| 工具 | 用途 | 版本 |
|------|------|------|
| `cz-conventional-changelog` | Commitizen 适配器，提供交互式命令行引导用户按 Conventional Commits 规范书写提交信息 | latest |
| `conventional-changelog-cli` | 基于 Conventional Commits 规范的 Git 提交历史，自动生成/更新 CHANGELOG.md 文件 | latest |

---

## 2. 安装与配置

### 2.1 安装依赖

```bash
pnpm add -D cz-conventional-changelog conventional-changelog-cli
```

### 2.2 package.json 配置

在 `package.json` 中添加以下节点：

```json
{
  "scripts": {
    "changelog": "conventional-changelog -p angular -i CHANGELOG.md -s",
    "version": "pnpm changelog && git add CHANGELOG.md",
    "postversion": "git push --follow-tags"
  },
  "config": {
    "commitizen": {
      "path": "cz-conventional-changelog"
    }
  }
}
```

#### 2.2.1 scripts 说明

| 脚本 | 命令 | 说明 |
|------|------|------|
| `changelog` | `conventional-changelog -p angular -i CHANGELOG.md -s` | 基于 Git 提交记录，生成或追加内容到 `CHANGELOG.md`。<br>`-p angular`: 使用 Angular 的提交规范预设<br>`-i CHANGELOG.md`: 输入/输出目标文件<br>`-s`: 以增量方式写入（保留已有内容） |
| `version` | `pnpm changelog && git add CHANGELOG.md` | 由 `npm version` 自动触发。在打 tag 前更新 CHANGELOG.md 并暂存，使 changelog 随版本发布一起提交 |
| `postversion` | `git push --follow-tags` | `npm version` 完成后自动推送提交和 tags 到远程仓库 |

#### 2.2.2 `cz-conventional-changelog` 配置项说明（可选）

若需自定义提交类型的展示效果，可在 `package.json` 中追加 `czconfig` 字段：

```json
{
  "config": {
    "commitizen": {
      "path": "cz-conventional-changelog"
    }
  }
}
```

> 也可以使用独立的 `.czrc` 文件或 `~/.czrc` 用户级配置文件。本项目统一采用 `package.json` 管理。

---

## 3. 使用流程

### 3.1 提交代码（使用 Commitizen）

不再直接使用 `git commit`，而是通过 Commitizen 交互式工具提交：

```bash
# 方式一：全局安装 commitizen 后
git cz

# 方式二：npx 免安装（推荐）
npx cz

# 方式三：通过 pnpm（如果项目 script 定义了 commit 命令）
pnpm commit
```

**交互流程引导：**
1. Select the type of change that you're committing（选择提交类型）
2. What is the scope of this change?（输入影响范围，可选）
3. Write a short description（简短描述，必填）
4. Provide a longer description（详细描述，可选）
5. Are there any breaking changes?（是否有破坏性变更）
6. Does this change affect any open issues?（关联 Issue）

### 3.2 提交类型（Commit Types）

| Type | 中文含义 | 对应 Changelog 分类 | 发布规则 |
|------|----------|---------------------|----------|
| `feat` | 新功能 | Features | 对应 MINOR 版本 |
| `fix` | Bug 修复 | Bug Fixes | 对应 PATCH 版本 |
| `docs` | 仅文档变更 | Documentation | 不发布 |
| `style` | 代码格式（不影响功能） | 不展示 | 不发布 |
| `refactor` | 代码重构（既非新功能也非修复） | Code Refactoring | 不发布 |
| `perf` | 性能优化 | Performance Improvements | 不发布 |
| `test` | 测试相关 | Tests | 不发布 |
| `build` | 构建系统或外部依赖变更 | Build System | 不发布 |
| `ci` | CI 配置变更 | Continuous Integration | 不发布 |
| `chore` | 杂项 | Miscellaneous | 不发布 |
| `revert` | 回滚 | Reverts | 不发布 |

> `BREAKING CHANGE` 标记（commit body 或 footer 中）在任何类型下都会触发 MAJOR 版本。

### 3.3 生成 Changelog

```bash
# 首次生成（完整历史）
pnpm changelog -- --first-release

# 增量更新（基于上一个 tag 至今）
pnpm changelog
```

**命令拆解说明：**

```
conventional-changelog -p angular -i CHANGELOG.md -s
  │                       │          │            │
  └── 使用 Angular        └── 读写   └── 保留     └── 增量写入
       预设                   目标文件    已有内容
```

#### 3.3.1 首次生成

```bash
pnpm changelog -- --first-release
```

- `--first-release` 标志告诉工具这是首次生成，不会基于 Git tag 做增量，而是遍历全部历史
- 生成的文件格式示例见第 4 节

#### 3.3.2 增量更新（发布时）

```bash
pnpm changelog
```

- 工具自动读取 Git tag（如 `v0.1.0`、`v0.2.0`）作为版本边界
- 只处理上一个 tag 到 HEAD 之间的提交
- `-s` 参数保证已有内容不被覆盖

### 3.4 推荐发布流程

```bash
# 1. 确认所有变更已提交（使用 cz 规范格式）
git cz

# 2. 一键发布（自动完成 changelog 更新 → 打 tag → publish）
npm version <major|minor|patch>
```

> 发布后会自动推送 tags 到远程（若配置了 `postversion`），或手动执行 `git push --follow-tags`。
> 
> `npm version` 的内部执行顺序：
> 1. `preversion` — 前置检查（如工作区干净）
> 2. 更新 `package.json` 中的 `version` 字段
> 3. **`version` 脚本 — 生成 CHANGELOG.md 并 git add**
> 4. `postversion` — 推送 tag 到远程
> 5. git commit + tag 自动完成

---

## 4. 输出产物：CHANGELOG.md

### 4.1 文件位置

项目根目录：`/CHANGELOG.md`

### 4.2 生成内容示例

```markdown
# Changelog

## [0.2.0](https://github.com/tangjiahui/git-pull-dir/compare/v0.1.0...v0.2.0) (2026-07-22)

### Features

* add README.md and LICENSE (MIT) ([f2842af](...))
* switch npm registry to npmjs.org and add .nvmrc for Node v20 ([7ca1bbd](...))

### Bug Fixes

* fix lint and edge cases ([0334310](...))
* pass all tests ([6a57ab5](...))

## 0.1.0 (2026-07-22)

### Features

* chore: bump to v0.2.0, update meta ([00d798b](...))
```

> 实际生成内容取决于 Git 提交信息是否已遵循 Conventional Commits 格式。历史提交若不规范，首次生成时内容可能不够准确。

---

## 5. 版本发布策略（与 Changelog 联动）

### 5.1 SemVer 关联

| 提交模式 | 版本提升 |
|----------|----------|
| `feat` | MINOR (`0.2.0` → `0.3.0`) |
| `fix` | PATCH (`0.2.0` → `0.2.1`) |
| 含 `BREAKING CHANGE` | MAJOR (`0.2.0` → `1.0.0`) |

> `npm version` 基于 `package.json` 的 `version` 字段自动提升并创建 Git tag。提升前应确保 `CHANGELOG.md` 已更新。

### 5.2 发布前自动更新 Changelog（核心需求）

将 changelog 生成整合进 `version` 脚本，实现在发布前自动更新：

```json
{
  "scripts": {
    "version": "pnpm changelog && git add CHANGELOG.md",
    "postversion": "git push --follow-tags"
  }
}
```

> **如何运作：**
> - `npm version <bump>` 在执行时自动触发 `version` 脚本
> - `version` 脚本先生成 changelog（从上一个 tag 到当前 HEAD），再将 CHANGELOG.md 暂存
> - npm 随后自动提交（包含 version bump + CHANGELOG.md）并打 tag
> - `postversion` 自动推送 tags 到远程
>
> **关于 `prepublishOnly`：**
> 当前项目已有 `"prepublishOnly": "pnpm run build && pnpm test"`，负责构建和测试验证。
> **不**将 changelog 生成放到 `prepublishOnly` 中，原因：
> 1. `prepublishOnly` 在 `npm publish` 时触发，此时 `npm version` 已完成并打了新 tag，changelog 生成会遗漏当前版本的内容（因为新 tag 已存在，`conventional-changelog` 的增量模式从上一个 tag 到新 tag 之间无新提交）
> 2. `version` 脚本在 `npm version` 过程中触发，此时新 tag 尚未创建，增量范围恰好是「上一个 tag → 当前待发布内容」
>
> **最终 `scripts` 发布链路：**
> ```
> npm version <bump>
>   ├─ preversion   （检查工作区干净）
>   ├─ version      ─→ pnpm changelog && git add CHANGELOG.md
>   ├─ [npm 自动提交 + 打 tag]
>   └─ postversion  ─→ git push --follow-tags
> 
> npm publish
>   └─ prepublishOnly ─→ pnpm run build && pnpm test
> ```

---

## 6. 实施步骤

### Step 1 — 安装依赖

```bash
pnpm add -D cz-conventional-changelog conventional-changelog-cli
```

### Step 2 — 修改 package.json

在现有配置中追加：
- `scripts.changelog` 脚本
- `scripts.version` — 发布前自动更新 changelog
- `scripts.postversion` — 发布后自动推送 tags
- `config.commitizen` 配置节点

### Step 3 — 首次生成 Changelog

```bash
pnpm changelog -- --first-release
```

### Step 4 — 提交 CHANGELOG.md

```bash
git add CHANGELOG.md
npx cz
# 类型选择: docs, 描述: add CHANGELOG.md with conventional-changelog
```

### Step 5 — 验证

```bash
# 验证 changelog 脚本可正常工作（再次运行增量模式应无新增内容）
pnpm changelog
git diff
```

---

## 7. 注意事项

1. **历史提交兼容性**：首次生成时，工具会尽最大努力解析历史提交信息。但只有严格遵循 Conventional Commits 格式的提交才能被正确归类。格式不符合的提交会归为 "Other" 或遗漏。
2. **不破坏现有工作流**：使用 `cz-conventional-changelog` 是可选增强，不影响原有的 `git commit` 方式。团队可逐步过渡。
3. **CHANGELOG.md 的维护**：生成后建议手动审阅和润色（尤其首次生成），确保分类和措辞准确。`-s` 模式不会覆盖人工修改的内容。
4. **没有额外的 commit-msg hook**：当前不引入 husky/commitlint，保持工具链轻量。开发者通过 `npx cz` 自觉遵循规范即可。
5. **Git tag 的重要性**：`conventional-changelog-cli` 依赖 Git tag 来划分版本边界。务必为每个发布版本打 tag（`git tag v0.2.0`），否则增量模式无法正确工作。

---

## 8. 相关资源

- [Conventional Commits 规范](https://www.conventionalcommits.org/zh-hans/)
- [commitizen/cz-cli](https://github.com/commitizen/cz-cli)
- [conventional-changelog/conventional-changelog](https://github.com/conventional-changelog/conventional-changelog)
- [conventional-changelog 配置选项](https://github.com/conventional-changelog/conventional-changelog/tree/master/packages/conventional-changelog-cli)
- [cz-conventional-changelog 配置](https://github.com/commitizen/cz-conventional-changelog)
