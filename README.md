# git-pull-dir

> 从远程 Git 仓库中仅拉取指定目录或文件到本地 — 告别巨量 monorepo 的完整克隆。

[![npm version](https://img.shields.io/npm/v/git-pull-dir.svg)](https://www.npmjs.com/package/git-pull-dir)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Motivation

大型 monorepo（如 `facebook/react-native`、`vercel/next.js`）体积巨大，但开发者往往只关心其中某个子目录（如 `packages/core`）。传统 `git clone` 会下载整个仓库历史，浪费带宽和时间。

**git-pull-dir** 利用 Git 的 `sparse-checkout` + `partial clone` 技术，让你只拉取需要的部分。

## Requirements

- **Node.js** ≥ 18.0.0 (LTS)
- **Git** ≥ 2.25.0（`sparse-checkout` 命令在该版本引入）

## Installation

```bash
# 全局安装
npm install -g git-pull-dir

# 或使用 npx 免安装运行
npx git-pull-dir <url> <dir>
```

## Usage

```bash
git-pull-dir <git-url> <git-dir> [local-dir] [--branch=<name>] [--quiet]
```

| 参数 | 是否必填 | 描述 | 示例 |
|------|----------|------|------|
| `<git-url>` | 是 | 远程 Git 仓库 URL（HTTPS / SSH） | `https://github.com/facebook/react-native.git` |
| `<git-dir>` | 是 | 仓库内需要拉取的目录或文件路径 | `packages/core` |
| `[local-dir]` | 否 | 本地存放目录。省略时取 `<git-dir>` 最后一段作为目录名 | `./my-core` |
| `--branch=<name>` | 否 | 指定分支，默认 `main` | `--branch=main` |
| `--quiet` | 否 | 静默模式，仅显示 spinner | `--quiet` |

> 包名以 `git-` 为前缀，Git 别名机制使 `git pull-dir` 也可直接调用。

## Examples

```bash
# 基本用法：拉取 react-native 的 packages/core 到 ./core
git-pull-dir https://github.com/facebook/react-native.git packages/core

# 指定本地目录名
git-pull-dir https://github.com/facebook/react-native.git packages/core ./my-core

# 通过 git 子命令调用
git pull-dir https://github.com/vercel/next.js.git packages/next ./next-local

# SSH 地址
git-pull-dir git@github.com:facebook/react-native.git packages/core

# 指定分支
git-pull-dir https://github.com/facebook/react-native.git packages/core --branch=main

# 静默模式
git-pull-dir --quiet https://github.com/facebook/react-native.git packages/core ./my-core
```

## Output

```bash
# 默认模式：逐行显示步骤
$ git-pull-dir https://github.com/facebook/react-native.git packages/core ./my-core
clone in...
setting sparse-checkout...
checkout...
save at /Users/me/my-core

# --quiet 模式：仅显示 spinner
$ git-pull-dir --quiet https://github.com/facebook/react-native.git packages/core ./my-core
⠋ downloading...
save at /Users/me/my-core

# 目录已存在，用户确认覆盖
$ git-pull-dir https://github.com/facebook/react-native.git packages/core ./my-core
目录 /Users/me/my-core 已存在，是否覆盖？(yes/no)
yes
clone in...
setting sparse-checkout...
checkout...
save at /Users/me/my-core

# 用户取消
$ git-pull-dir https://github.com/facebook/react-native.git packages/core ./my-core
目录 /Users/me/my-core 已存在，是否覆盖？(yes/no)
no
cancelled
```

## How It Works

采用 **partial clone** + **sparse-checkout** 组合方案：

```
git clone --filter=blob:none --no-checkout <url> <work-dir>
git -C <work-dir> sparse-checkout init --cone
git -C <work-dir> sparse-checkout set <git-dir>
git -C <work-dir> checkout <branch>
```

1. `--filter=blob:none` — 初始克隆时不下载文件内容（blob），只下载 commit 树结构
2. `--no-checkout` — 克隆后不立即检出工作区文件
3. `sparse-checkout init --cone` — 启用锥形模式，仅允许显式声明的目录被检出
4. `sparse-checkout set <dir>` — 声明需要检出的目录

这样只有指定目录的文件会实际传输，不会下载整个仓库历史。

## Exit Codes

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 / 用户取消 |
| 1 | 参数错误 / Git 未安装或版本过低 / URL 不可达 / 目录不存在 / 网络超时 / 磁盘空间不足 |
| 130 | 用户按 Ctrl+C 中断 |

## License

MIT
