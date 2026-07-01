# Implementation Report: T-0012.2 Source Folder Repack

Status: All review lanes clean; final verification pending
Branch: `task/T-0012-2-source-folder-repack`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-2-source-folder-repack`
Baseline commit: `480feb02ebde00e03f13a30162d31b9f427e7d18`

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

- Server source mapping:
  - `src/context`: `bounded-context.ts`.
  - `src/entity`: `entity.ts`, `entity-metadata.ts`,
    `entity-transaction.ts`, `entity-transition-validation.ts`.
  - `src/handler`: handler decorators/metadata plus command/event
    registration readiness and shared readiness metadata.
  - `src/repository`: `repository.ts`.
  - `src/runtime`: runtime lifecycle, signal intake, and runtime routing.
- Server tests mirror the same folders under `packages/server/test`, with the
  root `index.test.ts` retained as the public package entry test.
- Transport source mapping:
  - `src/index.ts` remains the adapter-agnostic public export entry point.
  - `src/zeromq/adapter-config.ts` holds the adapter-private ZeroMQ config.
- Transport tests mirror the ZeroMQ folder under `packages/transport/test/zeromq`;
  root `index.test.ts` remains the public transport entry test.
- Deviation from the suggested mapping: none for folder names. Registration
  readiness files are placed under `handler` because they are derived from
  handler metadata and do not perform runtime dispatch.
- Public package exports from `packages/server/src/index.ts` are preserved.
  ZeroMQ adapter config remains adapter-private and is not exported from the
  transport package root.
- `scripts/check-cleanup-rules.mjs` was updated for the new semantic source
  paths and root `src` enforcement.

## Verification Results

- `corepack pnpm lint`: passed after formatting and cleanup-rule path update.
  Cleanup enforcement passed.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm test`: sandbox run failed only in the two ZeroMQ local IPC
  smoke tests with `Operation not permitted`; native IPC retry passed with 28
  test files / 307 tests.
- `corepack pnpm docs:check`: passed. TypeDoc emitted the existing invalid
  `origin` warning only. API check counted 100 proto / 28 core / 130 server /
  26 storage / 46 transport expected exports.
- `corepack pnpm proto:generate`: passed and verified 16 copied Spine proto
  source file checksums.
- `corepack pnpm proto:check-generated`: passed; generated proto output is
  ignored, untracked, and freshly regenerated.
- `git diff --check`: passed.
- `env CI=true corepack pnpm verify`: passed with native IPC access after the
  sandbox ZeroMQ `ipc://` bind failure was confirmed. Coverage: 96.12%
  statements, 90.53% branches, 99.38% functions, 96.07% lines.

## Documentation Review Fix

- Review found stale parent current-state language saying `T-0012.2` was still
  selected after this branch implemented it. Parent task, implementation
  report, work log, and review log now say `T-0012.2 Source Folder Repack` is
  implemented and awaiting review.
- Review found the T-0012.2 work-log chronology listed implementation entries
  before worktree/log creation. The implementation timestamps were corrected so
  the log reads in actual sequence.
- Focused documentation re-reviewer
  `019f1ed8-fc29-7de3-9519-dfe64eb524b4` reported `CLEAN` for
  `.superpowers/sdd/review-docs-1cfe314..d37a020.diff` and is closed.
- All required review lanes are clean.
