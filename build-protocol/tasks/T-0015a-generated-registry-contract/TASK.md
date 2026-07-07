# T-0015a: Generated Registry Contract And Red Tests

Status: complete
Start: `2026-07-07 19:21 WEST`
End: `2026-07-07 19:53 WEST`
Baseline commit: `d40e388`
Task log path: `build-protocol/tasks/T-0015a-generated-registry-contract/TASK.md`
Branch: `task/T-0015a-generated-registry-contract`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0015a-generated-registry-contract`
Requirements splitter: `019f3dce-6067-7190-919d-cf6a62eebfa7`; completed and closed.
Authoring sub-agent: `019f3dd3-88d7-7643-9bc6-9710a713ad3d`
Reviewer sub-agents: round 2 clean; all participating reviewers closed
Implementation commit: `689ad50`
Final branch HEAD: log-maintenance commit after `689ad50`; see branch `HEAD`
Integrated to main: Pending

## Objective

Define the smallest generated handler registry contract needed for framework-owned
schema inference/materialization from bare end-user decorators, and add red or
contract tests that pin the required diagnostics before broader implementation.

T-0015a must not implement the full analyzer, package generator, runtime
discovery, or to-do migration. It establishes the contract and failing/guarding
tests for the next subtasks.

## Human-Imposed Requirements Ledger

- End-user apps use bare `@Assign`, `@Command`, `@React`, and `@Subscribe`.
- No end-user schema-bearing decorators such as `@Assign(CreateTaskSchema)`.
- No end-user `materializeDecoratedEntityHandlers()` or app-owned handler
  discovery/materialization helpers.
- Generated registry/build-time tooling infers handler signal schemas from
  explicit first parameter types and emitted schemas from explicit return types.
- `@Assign`, `@Command`, and `@React` handlers require explicit return types.
- `@Subscribe` handlers require explicit `void` return types.
- `handler(signal)` and `handler(signal, context)` must be supported for
  `@Assign`, `@Command`, `@React`, and `@Subscribe`.
- `@Apply` is not supported for new aggregate behavior.
- Ordinary end-user handlers return generated domain messages, not framework
  `Command` or `Event` envelopes.
- Generated Protobuf output remains under ignored `generated` directories and
  is not committed.
- Keep APIs small and JVM-familiar. Do not add broad registry infrastructure,
  new facades, or speculative discovery mechanisms in this contract slice.

## Splitter Roadmap Summary

The T-0015 splitter decomposed generated registry work into:

1. T-0015a generated registry contract and red tests.
2. T-0015b framework registry ingestion API.
3. T-0015c build-time handler analyzer.
4. T-0015d package/application registry generation.
5. T-0015e automatic runtime discovery.
6. T-0015f two-argument handler invocation.
7. T-0015g to-do example migration.
8. T-0015h docs, API docs, and quality closure.

T-0015a is the first non-blocked implementable subtask.

## Acceptance Criteria

- Build-protocol/API docs define the generated registry shape, discovery
  convention, and ownership boundary.
- Focused tests pin failure for bare-decorated entity metadata that lacks
  generated registry metadata.
- Tests or checker fixtures cover required explicit first parameter type,
  explicit emitter return type, `@Subscribe: void`, non-empty emitter returns,
  framework-envelope rejection, schema-bearing decorator rejection, and
  `@Apply` rejection.
- No generated output is committed.
- No full analyzer, package generator, automatic discovery, or to-do migration
  is introduced in this slice.

## Current Plan

1. Inspect current handler metadata/decorator and cleanup checker behavior.
2. Write a narrow generated registry contract brief in build-protocol/API docs.
3. Add focused red/contract tests for the unsupported bare-decorator metadata
   path and analyzer diagnostics.
4. Run focused verification.
5. Run the required reviewer loop.

## Work Log

- `2026-07-07 19:21 WEST`: Created T-0015a branch and worktree from `main`
  commit `d40e388`.
- `2026-07-07 19:21 WEST`: Recorded splitter result. Splitter
  `019f3dce-6067-7190-919d-cf6a62eebfa7` completed with no blockers and was
  closed.
- `2026-07-07 19:22 WEST`: Linked worktree dependencies with `corepack pnpm
install`. The first sandboxed attempt failed with registry `ENOTFOUND`; the
  escalated retry succeeded without lockfile changes.
- `2026-07-07 19:28 WEST`: Implementation sub-agent ran an initial focused
  cleanup guard check with `corepack pnpm vitest run
scripts/check-cleanup-rules.test.mjs`. The suite passed with 84 tests, but
  round-1 review later found that the required missing first-parameter
  diagnostic fixture was absent.
- `2026-07-07 19:32 WEST`: Implementation sub-agent documented the generated
  handler registry contract in the technical spec, developer API, public API
  docs, package README, and decision log. Runtime loading/discovery remains
  deferred to later T-0015d/T-0015e work.
- `2026-07-07 19:35 WEST`: Implementation sub-agent ran focused verification.
  `corepack pnpm vitest run packages/server/test/handler/handler-decorators.test.ts
scripts/check-cleanup-rules.test.mjs` passed after `corepack pnpm
typecheck:build` prepared package `dist` outputs. `corepack pnpm format:check`
  and `git diff --check` passed. `git status --ignored --short
packages/proto/generated packages/*/dist` showed only ignored generated/build
  outputs.
- `2026-07-07 19:44 WEST`: Implementation sub-agent completed round-1 review
  fixes. Added cleanup checker diagnostics and fixtures for missing explicit
  first signal-parameter type annotations on bare `@Assign`, `@Command`,
  `@React`, and `@Subscribe`. Verification passed: `corepack pnpm vitest run
scripts/check-cleanup-rules.test.mjs` (86 tests), `corepack pnpm docs:check`,
  `corepack pnpm lint`, `corepack pnpm format:check`, and `git diff --check`.
  Generated/build outputs remained ignored.
- `2026-07-07 19:46 WEST`: Main orchestrator independently re-ran focused
  verification after the round-1 fix. `corepack pnpm vitest run
scripts/check-cleanup-rules.test.mjs` passed with 86 tests, `corepack pnpm
docs:check` passed with the known TypeDoc invalid-remote source-link warning,
  `corepack pnpm lint` passed, `corepack pnpm format:check` passed, and `git
diff --check` passed.
- `2026-07-07 19:50 WEST`: Round-2 reviewers reported all substantive lanes
  clean. Documentation and reliability reviewers found only a stale task header
  that still said round 1 was in progress; the header is now updated for the
  final log recheck.
- `2026-07-07 19:53 WEST`: Final documentation and reliability rechecks
  reported `CLEAN`. All six reviewer lanes are clean.
- `2026-07-07 19:54 WEST`: Closed participating reviewer sub-agents:
  style/maintainability `019f3ddf-0174-7270-8c58-593f9df387bd`,
  documentation `019f3ddf-0223-7b01-ba16-efdd0aa06de8`, TypeScript/API
  `019f3ddf-0295-7463-bf75-6791599851be`, security
  `019f3ddf-0319-7173-8229-3c520f936b5f`, performance/reliability
  `019f3ddf-03b8-7963-abea-e813fd72e0a0`, and JVM/ADR alignment
  `019f3de2-42f2-7220-b44e-76bb2fd3c124`.
- `2026-07-07 19:55 WEST`: Final verification passed before commit. Focused
  handler/guard tests passed 96/96, `docs:check` passed with TypeDoc's known
  invalid-remote source-link warning, `lint` passed, `format:check` passed, and
  `git diff --check` passed.
- `2026-07-07 19:56 WEST`: Committed the reviewed T-0015a implementation as
  `689ad50` (`Define generated handler registry contract`). This
  log-maintenance update records that now-known commit and cannot name its own
  future hash.

## Verification Plan

- Focused tests for handler decorators/metadata and cleanup guard.
- `corepack pnpm format:check`.
- `corepack pnpm lint`.
- `corepack pnpm docs:check` when API docs or public exports change.
- `git diff --check`.
