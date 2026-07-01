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

## Implementation Summary

- Added `scripts/check-cleanup-rules.mjs` and focused Vitest coverage for the
  cleanup reset rules.
- Wired the cleanup checker into `pnpm lint`.
- Moved Protobuf-ES generation from `packages/proto/src/generated` to
  ignored `packages/proto/generated`.
- Removed tracked generated Protobuf-ES output from version control.
- Updated `@spine-ts/proto` build output paths and added a generated subpath
  export for direct generated-module imports after build.
- Moved package tests from `packages/<package>/src` to
  `packages/<package>/test`, preserving the existing flat test shape.
- Updated Vitest, ESLint, TypeDoc, TypeScript tooling config, proto docs, and
  fixture docs for the new generated/test layout.
- Reflowed existing production/tooling lines longer than 120 characters.
- The semantic-name checker records inherited pre-reset long names as explicit
  exceptions and rejects new long semantic names. This avoids redesigning
  server/runtime APIs in this enforcement-only task while making new debt
  executable.

## RED Evidence

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` failed before
  the checker existed with `MODULE_NOT_FOUND` for
  `scripts/check-cleanup-rules.mjs`.
- After adding the checker, `node scripts/check-cleanup-rules.mjs` failed on
  the old repository layout: tracked generated files under
  `packages/proto/src/generated`, package tests under `src`, long lines, and
  existing semantic/callback issues.

## GREEN / Verification Evidence

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` passed with
  4 tests.
- `node scripts/check-cleanup-rules.mjs` passed.
- `corepack pnpm typecheck:build` passed.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.
- `git diff --check` passed.
- Sandboxed `corepack pnpm test` failed only in
  `packages/transport/test/zeromq-local-ipc-smoke.test.ts` with
  `Error: Operation not permitted` for both ZeroMQ local IPC smoke tests.
- Escalated `corepack pnpm test` passed with 25 test files and 297 tests.
- `corepack pnpm docs:check` passed with the existing TypeDoc warning that the
  local `origin` remote is not valid for source links.
- `corepack pnpm proto:lint` passed.
- `corepack pnpm proto:generate` completed and regenerated ignored output under
  `packages/proto/generated`.
- `corepack pnpm proto:check-generated` passed with generated output ignored
  and untracked.
- Sandboxed `env CI=true corepack pnpm verify` failed at the same ZeroMQ local
  IPC smoke tests with `Error: Operation not permitted` after node, typecheck,
  lint, format, and cleanup checks passed.
- Escalated `env CI=true corepack pnpm verify` passed, including coverage:
  statements 96.12%, branches 90.53%, functions 99.38%, lines 96.07%.
