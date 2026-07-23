# 项目规则

## 技术栈

| 类别 | 选型 |
|------|------|
| 语言 | TypeScript 5.7+ |
| 运行时 | Node.js >= 20 |
| 包管理 | pnpm |
| 模块系统 | ESM（`"type": "module"`） |
| 构建工具 | tsup（输出 cjs + esm + dts） |
| 测试框架 | vitest |
| 代码检查 | ESLint 10 + `typescript-eslint` |
| 命令行框架 | commander |
| 进程执行 | execa |
| 发布工作流 | 自编 release 脚本 + conventional-changelog + commitizen |

## Node.js 版本要求

本项目要求 **Node.js >= 20** 运行。

### 检查与切换

在执行任何命令之前，请确保使用正确的 Node.js 版本：

```bash
node -v                     # 查看当前版本
nvm use 20                  # 如版本低于 20，用 nvm 切换到 20+
```

> 项目已配置 `.nvmrc`（内容为 `v20`），在项目目录下执行 `nvm use` 即可自动切换到对应版本。

### 常用命令

```bash
pnpm install                # 安装依赖
pnpm run build              # 构建
pnpm test                   # 运行测试
pnpm run lint               # 代码检查
pnpm run release            # 发布
```
