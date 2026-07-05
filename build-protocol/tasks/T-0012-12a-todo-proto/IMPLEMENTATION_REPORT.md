# Implementation Report: T-0012.12a Todo Proto Generation

Status: final log-state correction at current HEAD; clean final review pending
Branch: `task/T-0012-12a-todo-proto`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12a-todo-proto`
Baseline commit: `b12ef3b`

## Summary

This slice prepares `examples/todo` for real domain code by adding its
Protobuf contract and generation workflow. It must not implement aggregate,
projection, service, or server runtime behavior.

## Current State

- Worktree started the now-committed reliability fix history at HEAD `ddefd95`,
  the committed first review-fix pass on top of implementation commit
  `cbdb35c`.
- Re-review found documentation wording, maintainability cleanup, and
  generated-root publish reliability issues. The second focused reliability
  pass closed that gap and was committed as
  `56f0b8d Stabilize todo proto generation publishing`.
- Final re-review after `56f0b8d` found stale post-commit log wording and a
  public generated-schema facade. This small final-review fix updates durable
  state and removes that facade while keeping the direct generated import proof
  in the test. Required final-review fix verification passed, and the main
  orchestrator reran the verification subset at `2026-07-05 13:02 WEST`.
- The final-review fix was committed as
  `33aa420 Remove todo generated schema facade`.
- The first log-state correction was committed as
  `733c7ae Record final todo proto review state`; current HEAD carries the last
  log-only status correction for clean final review and integration.
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
- `pnpm proto:generate` now stages every generated root in a temporary sibling
  directory before publishing any root. Publishing backs up current generated
  contents into stage-owned backup directories, mirrors staged files into the
  existing generated roots, removes orphaned generated files/directories, and
  restores touched roots from backups if any target publish fails. The live
  generated root directories are not renamed away during normal successful
  publishing.
- Root `test` and `test:coverage` now run `pnpm proto:generate` first so fresh
  checkouts have ignored generated output before generated-dependent tests run.
- The production example entry point exports only skeleton metadata; the smoke
  test imports generated `TaskSchema` directly from ignored generated output.

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
- Focused re-review fix verification:
  `pnpm proto:generate` passed; `pnpm exec vitest run scripts/proto-workflow.test.mjs --passWithNoTests`
  passed with 1 file and 5 tests;
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed with 1 file and 2 tests; `pnpm proto:check-generated`,
  `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm docs:check`,
  `git diff --check`, generated-output ignore checks, and generated-output
  tracking checks passed.
- Focused re-review fix coverage result: sandboxed `pnpm test:coverage`
  failed with 2 failed files, 43 passed files, 21 failed tests, 603 passed
  tests, and 19 unhandled errors due to local endpoint restrictions:
  ZeroMQ IPC `Operation not permitted` and HTTP/2
  `listen EPERM: operation not permitted 127.0.0.1`. Escalated rerun was
  requested but rejected by the environment policy.
- `pnpm format:check` initially flagged `scripts/proto-workflow.test.mjs` and
  pre-existing untracked
  `build-protocol/review-packages/T-0012-12a-fix-pass.diff.md`; both were
  formatted, and final format verification passed.
- Second focused reliability fix red step:
  `pnpm exec vitest run scripts/proto-workflow.test.mjs --passWithNoTests`
  failed before implementation with 2 expected failures: the live generated
  root was not observed present during publish, and staged symlink output was
  accepted.
- Second focused reliability fix verification passed:
  `pnpm exec vitest run scripts/proto-workflow.test.mjs --passWithNoTests`
  passed with 1 file and 6 tests; `pnpm proto:generate` passed and verified 25
  copied Spine proto source checksums; `pnpm proto:check-generated` passed;
  `pnpm typecheck` passed; `pnpm lint` passed; `pnpm format:check` passed; and
  `git diff --check` passed.
- Main orchestrator verified the second focused fix pass: generation, focused
  proto workflow tests, focused todo smoke, generated-clean, typecheck, lint,
  format check, docs check, whitespace check, generated-output Git guards,
  sandboxed coverage, and escalated coverage. Escalated coverage passed with
  45 test files, 625 tests, statements 95.06%, branches 90.22%, functions
  97.60%, lines 95.08%.
- Final-review fix verification passed:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed with 1 file and 2 tests; `pnpm typecheck` passed; `pnpm lint`
  passed; final `pnpm format:check` passed after formatting only
  `build-protocol/work-logs/T-0012-12a.md`; `pnpm docs:check` passed with the
  existing TypeDoc invalid-origin warning; `git diff --check` passed.

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
