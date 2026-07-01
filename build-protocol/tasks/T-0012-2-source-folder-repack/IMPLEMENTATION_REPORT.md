# Implementation Report: T-0012.2 Source Folder Repack

Status: Created; implementation pending
Branch: `task/T-0012-2-source-folder-repack`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-2-source-folder-repack`
Baseline commit: `32ac920`

## Setup Summary

- Parent corrective branch integrated `T-0012.1` and passed verification.
- Cleanup enforcement is active before this task starts.
- Current source structure still has flat server and transport source roots.

## Expected Implementation Shape

- Move files with `git mv` so history stays understandable.
- Keep behavior-preserving path/import changes only.
- Prefer semantic folders over class/file mirroring.
- Keep root `src/index.ts` as the package export entry point.
- Avoid introducing new helper files unless a caller becomes simpler.

## Verification Plan

- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm docs:check`
- `corepack pnpm proto:generate`
- `corepack pnpm proto:check-generated`
- `env CI=true corepack pnpm verify`, escalated if ZeroMQ local IPC is blocked
  by the sandbox.

## Implementation Notes

Pending.
