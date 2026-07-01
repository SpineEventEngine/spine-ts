# Implementation Report: T-0012.1 Cleanup Enforcement Baseline

Status: Started
Branch: `task/T-0012-1-cleanup-enforcement-baseline`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-1-cleanup-enforcement-baseline`
Baseline commit: `a65ac4d`

## Setup Summary

- Parent corrective roadmap selected this as the first non-blocked cleanup
  subtask.
- The task starts after the reset policy was recorded in `D-0047`,
  `BUILD_PROTOCOL.md`, `CODE_QUALITY.md`, `TECHNICAL_SPEC.md`,
  `RUNTIME_ARCHITECTURE.md`, and `TODO_EXAMPLE_SPEC.md`.
- The goal is enforcement and path/layout cleanup only.

## Expected Implementation Shape

- Add a small repository-local quality check script if ESLint alone cannot
  enforce the reset rules clearly.
- Move generated Protobuf-ES output out of `src` and keep it ignored.
- Move existing tests out of package `src` trees.
- Keep behavior changes to import/path adjustments.

## Verification Plan

- Focused RED evidence for new checks against old patterns.
- `corepack pnpm typecheck:build`
- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `git diff --check`
- `corepack pnpm test`
- `corepack pnpm docs:check`
- `corepack pnpm proto:lint`
- `corepack pnpm proto:generate`
- `corepack pnpm proto:check-generated`
- Escalated `env CI=true corepack pnpm verify` if needed for ZeroMQ IPC smoke
  tests.

No implementation has started yet.
