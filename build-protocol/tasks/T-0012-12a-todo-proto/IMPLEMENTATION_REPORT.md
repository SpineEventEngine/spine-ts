# Implementation Report: T-0012.12a Todo Proto Generation

Status: implementation complete; review-fix commit pending re-review
Branch: `task/T-0012-12a-todo-proto`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12a-todo-proto`
Baseline commit: `b12ef3b`

## Summary

This slice prepares `examples/todo` for real domain code by adding its
Protobuf contract and generation workflow. It must not implement aggregate,
projection, service, or server runtime behavior.

## Current State

- Worktree is open at the review-fix commit on top of implementation commit
  `cbdb35c`; re-review is pending against current HEAD.
- Required task/spec/tooling inputs have been read.
- Example-owned todo `.proto` files define `TaskId`, `Task`, `TaskList`,
  create/rename/complete/reopen commands, and corresponding events.
- `pnpm proto:generate` now regenerates both framework and todo generated
  roots, and `pnpm proto:check-generated` verifies both roots.
- Generated output is ignored and untracked under `examples/todo/generated/`.
- The todo smoke test imports `TaskSchema` directly from generated output.
- Existing Buf / Protobuf-ES tooling was reused. The example package now
  declares the already-pinned `@bufbuild/protobuf` runtime dependency so
  generated imports resolve from the example workspace.
- `pnpm proto:generate` now stages each generated root in a temporary sibling
  directory and swaps it into place after successful Buf generation, preserving
  live generated roots while generation runs.
- Root `test` and `test:coverage` now run `pnpm proto:generate` first so fresh
  checkouts have ignored generated output before generated-dependent tests run.
- The production example entry point imports a generated schema reference
  directly, and the example build emits a viable `dist/src/index.js` export.

## Files Changed

- Added `examples/todo/proto/spine/example/todo/v1/*.proto`.
- Added `examples/todo/buf.gen.yaml`.
- Updated Buf generation/check scripts and generated-output excludes.
- Updated example package metadata and smoke test.
- Updated task/report/work logs.
- Updated placeholder README/user-guide status wording.

## Verification

- `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  failed before implementation because
  `../generated/spine/example/todo/v1/tasks_pb.js` was missing.
- `pnpm proto:generate`: passed.
- `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`:
  passed with 2 tests.
- `pnpm proto:lint`: passed.
- `git check-ignore -- examples/todo/generated/.cleanup-enforcement-check`:
  passed; path is ignored.
- `git ls-files -- examples/todo/generated`: passed; output was empty.
- `pnpm proto:check-generated`: passed for package and todo generated roots.
- `pnpm exec vitest run scripts/check-generated-clean.test.mjs --passWithNoTests`:
  passed with 3 tests.
- `pnpm docs:check`: passed with the existing TypeDoc invalid-origin warning.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `pnpm test:coverage`: sandboxed run failed with ZeroMQ IPC `Operation not
permitted` and HTTP/2 `listen EPERM 127.0.0.1`; escalated rerun passed with
  45 test files, 621 tests, statements 95.06%, branches 90.22%, functions
  97.60%, lines 95.08%.
- `git diff --check`: passed.
- Main orchestrator reran generation-dependent checks sequentially before
  commit because concurrent generation/read commands can race on ignored
  generated output. The sequential rerun passed: `pnpm proto:generate`,
  focused example smoke test, `pnpm proto:check-generated`, `pnpm typecheck`,
  `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, generated-clean unit
  test, `git diff --check`, sandboxed `pnpm test:coverage` with known
  local-endpoint failure, and escalated `pnpm test:coverage` with branch
  coverage 90.22%.
- Review-fix verification passed: `pnpm proto:generate`, focused example
  smoke, `pnpm proto:check-generated`, generated-clean unit test,
  `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm docs:check`,
  `git diff --check`, and the proto-workflow regression test.
- Review-fix coverage result: sandboxed `pnpm test:coverage` failed with
  ZeroMQ IPC `Operation not permitted` and HTTP/2
  `listen EPERM 127.0.0.1`; escalated `pnpm test:coverage` passed with 45 test
  files, 621 tests, statements 95.06%, branches 90.22%, functions 97.60%,
  lines 95.08%.
- Main orchestrator reran the same review-fix verification after interruption:
  generation, focused todo smoke, generated-clean checks, proto workflow
  regression test, typecheck, lint, format check, docs check, whitespace check,
  generated-output Git guards, sandboxed coverage, and escalated coverage all
  match the evidence above.

## Generated Files Status

- `examples/todo/generated/` and `packages/proto/generated/` exist only as
  ignored generated output.
- `git check-ignore -- examples/todo/generated/.cleanup-enforcement-check packages/proto/generated/.cleanup-enforcement-check`
  printed both paths.
- `git ls-files -- examples/todo/generated packages/proto/generated` returned
  no tracked files.
- Generated TypeScript was not committed.

## Reviewer Risks

- The todo generated root includes a generated local `spine/options_pb.ts`
  because the example generator uses `include_imports: true` so custom option
  imports resolve in ignored output.
- No aggregate, projection, runtime, or `@spine-ts/server` API behavior is
  implemented in this slice.
