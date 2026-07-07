# T-0015d: Generated Registry File Generation

Status: integrated
Start: `2026-07-07 21:27 WEST`
End: `2026-07-07 22:35 WEST`
Baseline commit: `6691f62`
Task log path: `build-protocol/tasks/T-0015d-registry-generation/TASK.md`
Branch: `task/T-0015d-registry-generation`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0015d-registry-generation`
Requirements splitter: `019f3dce-6067-7190-919d-cf6a62eebfa7`; completed and closed during T-0015a setup.
Authoring sub-agent: completed
Reviewer status: final narrow review findings addressed; verification passed
Implementation commit: `103f48b`
Final branch HEAD: `103f48b`
Integrated to main: `5e13d6d`; integration logging recorded on `main`

## Objective

Add the build-time generation step that renders version-1 generated handler
registry TypeScript source from the T-0015c analyzer output and T-0015b
registry contract.

T-0015d must not implement automatic runtime discovery, to-do example migration,
or handler invocation. It may provide a CLI/script entrypoint and deterministic
file rendering that later app/package build scripts can invoke.

## Human-Imposed Requirements Ledger

- End-user apps use bare `@Assign`, `@Command`, `@React`, and `@Subscribe`.
- No explicit schema decorators are allowed in ordinary end-user code.
- Generated registry/build-time tooling owns schema inference and schema imports.
- Generated output must live under a package `generated` directory and be ignored
  by Git.
- Generated registry records exclude `@Apply`.
- `@Assign` emits events, `@Command` emits commands, `@React` emits events or
  nothing, and `@Subscribe` emits nothing.
- `handler(signal)` and `handler(signal, context)` arity must be preserved in
  generated records.
- Ordinary end-user handlers return generated domain messages, not framework
  `Command` or `Event` envelopes.
- Keep the generation API small and deterministic.

## Context From Earlier Slices

- T-0015b added `GeneratedHandlerRegistry` and `HandlerRegistryIngestor`.
- T-0015c added the internal build-time analyzer in
  `packages/server/src/handler/build-time-handler-analyzer.ts`.
- The analyzer output is intentionally internal to avoid loading `typescript`
  from the runtime package root.

## Acceptance Criteria

- Provide a build-time generator API or script module that accepts analyzer
  output and renders deterministic TypeScript registry source.
- Render imports for entity classes and generated `...Schema` values without
  requiring end-user source to mention schema decorators.
- Render a version-1 object satisfying the T-0015b generated registry contract.
- Preserve handler order, entity order, method names, schema references, emitted
  schema references, and public arity.
- Write generated registry files only when explicitly invoked; do not add
  runtime discovery in this slice.
- Ensure generated output paths are under `packages/<package>/generated` or an
  explicitly configured generated directory and remain ignored by Git.
- Add focused tests for deterministic rendering and writing.
- Update docs, API notes, ignore rules, and durable logs as needed.

## Work Log

- `2026-07-07 21:27 WEST`: Created T-0015d branch and worktree from `main`
  commit `6691f62` through the approved Git worktree escalation path.
- `2026-07-07 21:30 WEST`: `corepack pnpm install` in the sandbox failed with
  npm registry `ENOTFOUND`; reran the same command through the approved
  escalation path and linked the worktree dependencies successfully.
- `2026-07-07 21:30 WEST`: Codex implementation sub-agent started T-0015d in
  the task worktree. Planned the smallest internal writer around a pure render
  step plus an explicit guarded write step, with focused red/green tests for
  deterministic source output and generated-path safety.
- `2026-07-07 21:39 WEST`: Codex implementation sub-agent completed the
  implementation pass. Added the internal generated registry writer plus
  focused writer tests, updated the generated-registry docs, and verified the
  requested handler tests, build/typecheck, docs, lint, format, and diff
  checks. Runtime discovery remains deferred by design.
- `2026-07-07 22:03 WEST`: Codex round-2 fix implementation sub-agent reopened
  T-0015d in the task worktree after reading the round-2 review findings,
  writer/analyzer tests, and durable task artifacts. Planned a minimal red/
  green pass for registry-name validation, repeated entity import reuse,
  compiler-backed registry rendering coverage, write prevalidation, symlinked
  `repoRoot` rejection, locale-independent ordering, and log-state refresh.
- `2026-07-07 22:04 WEST`: Codex round-2 fix implementation sub-agent added
  focused regression coverage in
  `packages/server/test/handler/generated-registry-writer.test.ts` for
  reserved/colliding registry names, repeated identical entities, package
  schema module specifiers plus isolated-declarations compilation, prevalidation
  before directory creation, and symlinked `repoRoot` rejection. The first red
  rerun failed in the expected validation/reuse/symlink cases before the writer
  changes.
- `2026-07-07 22:04 WEST`: Codex round-2 fix implementation sub-agent
  implemented the minimal writer updates in
  `packages/server/src/handler/generated-registry-writer.ts`: registry-name
  reserved-word and import-collision rejection, repeated identical entity
  binding reuse, render-before-mkdir prevalidation, `repoRoot` symlink
  rejection, and locale-independent import ordering. The focused writer suite
  is green again.
- `2026-07-07 22:08 WEST`: Codex round-2 fix implementation sub-agent reran
  the full required verification set after a Prettier cleanup pass on the
  touched writer files. Results: focused handler suites green (`39` tests),
  `typecheck:build` green, `docs:check` green with the existing TypeDoc
  invalid-remote warning only, `lint` green, `format:check` green, and
  `git diff --check` green. Round-3 review then started on the same worktree
  diff.
- `2026-07-07 22:19 WEST`: Codex round-3 fix implementation sub-agent reopened
  T-0015d in the task worktree after reading the round-3 findings, current
  writer/test sources, and durable task artifacts. Planned a minimal pass for
  strict-mode forbidden `registryName` validation, post-`mkdir` output-path
  symlink revalidation, `repoRoot` ancestor symlink rejection, and state
  refresh only.
- `2026-07-07 22:19 WEST`: Codex round-3 fix implementation sub-agent added
  focused writer regressions first for `eval`/`arguments`, symlinked
  `repoRoot` ancestors, and the output-directory recheck expectation, then ran
  `corepack pnpm vitest run
packages/server/test/handler/generated-registry-writer.test.ts`. The first
  red rerun failed in the expected registry-name validation case and exposed a
  temporary-path fixture issue for the new repo-root ancestor coverage.
- `2026-07-07 22:20 WEST`: Codex round-3 fix implementation sub-agent
  implemented the minimal writer updates in
  `packages/server/src/handler/generated-registry-writer.ts`: reject
  `eval`/`arguments`, re-check the output directory path after `mkdirSync()`,
  and reject symlinked `repoRoot` ancestors before accepting the repo root. The
  focused writer suite is green again after canonicalizing temp-fixture paths
  in the writer test.
- `2026-07-07 22:21 WEST`: Codex round-3 fix implementation sub-agent reran
  the full required verification set after a task-log Prettier cleanup. Final
  results: focused handler suites green (`41` tests), `typecheck:build` green,
  `docs:check` green with the existing TypeDoc invalid-remote warning only,
  `lint` green, `format:check` green, and `git diff --check` green. Task is
  ready for review closure on the current worktree diff.

## Verification Plan

- Focused generator tests.
- `corepack pnpm typecheck:build`.
- `corepack pnpm docs:check` if public docs/API expectations change.
- `corepack pnpm lint`.
- `corepack pnpm format:check`.
- `git diff --check`.
