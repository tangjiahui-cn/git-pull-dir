---
name: git-commit
description: >
  Help committing git changes with proper conventional commit messages.
  Use this skill whenever the user asks to commit changes, stage files, create a git commit,
  says "let's commit", "I'm ready to commit", or any variation of wanting to make a git commit.
  Also trigger when the user asks you to "概括修改内容" (summarize changes) or mentions wanting
  to save/publish their work via git.
---

# Git Commit Skill

## Overview

This skill streamlines the git commit workflow. When invoked, it:
1. Checks the current git status and diff to understand what changed
2. Generates a concise, **English** conventional commit message (≤ 50 characters)
3. Presents the message to the user for **approval** (never commits without asking)
4. On confirmation, stages all changes (`git add .`) and commits with the message

## Commit Message Rules

### Format
Use **Conventional Commits** format:
```
<type>(<scope>): <description>
```

**Types** (pick the most appropriate):
- `feat` — A new feature
- `fix` — A bug fix
- `docs` — Documentation only changes
- `style` — Changes that do not affect the meaning of the code (formatting, etc.)
- `refactor` — A code change that neither fixes a bug nor adds a feature
- `perf` — A code change that improves performance
- `test` — Adding missing tests or correcting existing tests
- `chore` — Changes to the build process or auxiliary tools
- `ci` — Changes to CI configuration files and scripts

**Scope** (optional, keep short):
- Use the module/component name, e.g. `feat(auth):`, `fix(api):`, `docs(readme):`
- Omit when the change spans many areas: `feat: add logging`

### Length
- **Maximum 50 characters** for the entire subject line including type and scope
- Be concise — if the message is too long, split into summary + body or shorten scope

### Language
- **Always English**
- Use imperative mood: "Add", "Fix", "Update", "Remove" — not "Added", "Fixes", "Updated"
- No trailing period

## Workflow

### Step 1: Check Status

Run `git status --short` and `git diff --stat` to understand the changes. If there are no changes, inform the user and stop.

### Step 2: Generate Commit Message

Read the diff content (`git diff` and/or `git diff --cached`) to understand what was changed. Generate a conventional commit message that:

- Correctly identifies the **type** based on the change
- Optionally includes a **scope** (the module/component affected)
- Has a **description** in English, imperative mood, ≤ 50 chars total
- Covers the **most important change** — don't list everything, capture the essence

### Step 3: Present for Approval

Show the user the proposed commit message. Say something like:

```
Proposed commit message:
  feat(cli): add --dry-run flag

Run `git add . && git commit -m "feat(cli): add --dry-run flag"`?
```

Wait for the user to confirm. They might:
- Say yes / confirm → proceed to Step 4
- Request a different message → update and show again, repeat Step 3
- Reject / say no → stop without committing

### Step 4: Commit

On user confirmation:
1. Run `git add .` to stage all changes
2. Run `git commit -m "<message>"` with the confirmed message
3. Show the commit output to the user

## Error Handling

- **No changes to commit**: Inform the user — "No changes detected. Working tree is clean."
- **Git command fails**: Show the error output to the user and ask how to proceed
- **User wants to edit the message**: Accept their revision, show the updated version, and ask for confirmation again
- **Only untracked files**: Proceed normally — `git add .` will stage them

## Examples

**Example 1: Adding a new feature**
```
Changes:
  src/cli.ts        | +45 -2
  src/commands.ts   | +12 -0

→ Proposed: feat(cli): add --dry-run flag
```

**Example 2: Fixing a bug**
```
Changes:
  src/parser.ts     | +8 -12

→ Proposed: fix(parser): handle empty input
```

**Example 3: Documentation update**
```
Changes:
  README.md         | +15 -5

→ Proposed: docs(readme): update install instructions
```

**Example 4: Multiple changes across areas**
```
Changes:
  src/utils.ts      | +3 -1
  src/api.ts        | +20 -8
  package.json      | +2 -2

→ Pick the dominant change as type. If unclear, use chore or refactor.
  Proposed: refactor(api): simplify error handling
```
