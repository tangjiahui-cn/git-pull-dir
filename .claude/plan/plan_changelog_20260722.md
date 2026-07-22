# Plan: 为 git-pull-dir 增加 Changelog 功能

> 基于 spec: `.claude/spec/spec_changelog_20260722.md`
> 状态: 待执行

---

## 目标

引入 `cz-conventional-changelog` + `conventional-changelog-cli`，实现：
1. 规范化 Git 提交信息格式
2. 发布前自动生成/更新 `CHANGELOG.md`
3. 一键式发布流程

---

## 执行步骤

### Step 0 — 确保 Node.js 版本

**要求：** 本项目要求 Node.js 20.x，使用 nvm 切换

**命令：**
```bash
nvm use 20
```

> 后续所有 `pnpm` / `node` 命令均在此环境下执行。

---

### Step 1 — 安装依赖

**命令：**
```bash
pnpm add -D cz-conventional-changelog conventional-changelog-cli
```

**涉及文件：** `package.json`（devDependencies 自动更新）

> 注意：安装前确保已执行 `nvm use 20` 切换到 Node.js 20。若提示 `nvm: command not found`，先执行 `. "$NVM_DIR/nvm.sh"` 或 `source ~/.nvm/nvm.sh` 加载 nvm。

---

### Step 2 — 修改 package.json

在 `package.json` 中追加三处配置：

| 配置位置 | 内容 | 说明 |
|----------|------|------|
| `scripts.changelog` | `conventional-changelog -p angular -i CHANGELOG.md -s` | 生成/更新 changelog 的基础命令 |
| `scripts.version` | `pnpm changelog && git add CHANGELOG.md` | `npm version` 时自动触发，在打 tag 前更新 changelog |
| `scripts.postversion` | `git push --follow-tags` | 打完 tag 后自动推送 |
| `config.commitizen.path` | `cz-conventional-changelog` | 配置 Commitizen 适配器路径 |

**涉及文件：** `package.json`

---

### Step 3 — 首次生成 CHANGELOG.md

**命令：**
```bash
pnpm changelog -- --first-release
```

- `--first-release` 标记遍历全部 Git 历史生成初始内容
- 输出文件：`/CHANGELOG.md`

**涉及文件：** `CHANGELOG.md`（新建）

---

### Step 4 — 提交 CHANGELOG.md

```bash
git add CHANGELOG.md package.json
npx cz
# 选择: docs / (空 scope) / "add CHANGELOG.md with conventional-changelog"
```

**注意：** `package.json`（Step 2 的修改）也一并提交。

---

### Step 5 — 验证

```bash
# 增量模式应无新增内容（刚生成完）
pnpm changelog
git diff  # 期望无变化

# 验证 version 脚本语法正确
npm run version  # 仅 dry-run 检查脚本是否能正常执行
```

---

## 涉及文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `package.json` | 修改 | 追加 scripts + config |
| `pnpm-lock.yaml` | 自动更新 | 安装依赖后自动生成 |
| `CHANGELOG.md` | 新建 | 首次生成 changelog |

---

## 验证标准

- [ ] `pnpm changelog` 能成功生成/更新 `CHANGELOG.md`
- [ ] `pnpm changelog` 重复执行幂等（增量模式下无重复内容）
- [ ] `config.commitizen` 配置正确，`npx cz` 能启动交互式提交界面
- [ ] `npm run version` 能正确执行 changelog 更新和 git add（不报错）
- [ ] 不影响已有的 `build`、`test`、`prepublishOnly` 脚本
