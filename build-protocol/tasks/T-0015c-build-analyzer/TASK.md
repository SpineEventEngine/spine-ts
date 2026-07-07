# T-0015c: Build-Time Handler Analyzer

Status: complete
Start: `2026-07-07 20:36 WEST`
End: `2026-07-07 21:22 WEST`
Baseline commit: `4b802fc`
Task log path: `build-protocol/tasks/T-0015c-build-analyzer/TASK.md`
Branch: `task/T-0015c-build-analyzer`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0015c-build-analyzer`
Requirements splitter: `019f3dce-6067-7190-919d-cf6a62eebfa7`; completed and closed during T-0015a setup.
Authoring sub-agent: completed
Reviewer sub-agents: all required review lanes completed clean and closed.
Implementation commit: `89afdc1`
Final branch HEAD: Pending final log commit
Integrated to main: Pending

## Objective

Add the build-time TypeScript analyzer that discovers bare Spine handler
decorators in end-user source and extracts enough metadata for generated handler
registry modules.

T-0015c must not implement package-level registry file generation, automatic
runtime discovery, to-do example migration, or handler invocation. It should
produce a structured analysis result that the later generator slice can render
into source code.

## Human-Imposed Requirements Ledger

- End-user apps use bare `@Assign`, `@Command`, `@React`, and `@Subscribe`.
- No explicit schema decorators are allowed in ordinary end-user code.
- No app-owned handler materialization/discovery helpers.
- Generated registry/build-time tooling owns schema inference from explicit
  first parameter types and emitted schemas from explicit return types.
- `@Assign`, `@Command`, and `@React` handlers require explicit return types.
- `@Subscribe` handlers require explicit `void` return types.
- `handler(signal)` and `handler(signal, context)` are accepted for all handler
  kinds covered by generated registries.
- `@Apply` is not supported for generated registries.
- Ordinary end-user handlers return generated domain messages, not framework
  `Command` or `Event` envelopes.
- Analyzer output must feed the T-0015b generated registry contract without
  introducing a parallel runtime registry.
- Keep the implementation small and avoid over-invented abstractions.

## Context From Earlier Slices

- T-0015a documented the generated registry contract and cleanup guard rules.
- T-0015b added `HandlerRegistryIngestor` and the version-1 generated registry
  contract in `packages/server/src/handler/generated-handler-registry.ts`.
- Generated event reactions may declare zero emitted schemas for ADR
  0001-compatible no-emission reactions. Command assignees and command reactors
  require at least one emitted schema. Event subscribers must declare no emitted
  schemas.

## Acceptance Criteria

- Provide a build-time analyzer API or script module that uses the TypeScript
  compiler API to inspect configured source files.
- Discover bare standard-decorator handler methods for `@Assign`, `@Command`,
  `@React`, and `@Subscribe`.
- Reject schema-bearing handler decorators in ordinary analyzed app source.
- Reject `@Apply` in analyzed generated-registry source.
- Require explicit first parameter type annotations and public arity `1 | 2`.
- Require explicit return type annotations for `@Assign`, `@Command`, and
  `@React`; require explicit `void` return type for `@Subscribe`.
- Map first parameter message types and return message types to importable
  generated schemas without asking end-user code to reference `...Schema`
  symbols.
- Support singular and readonly/regular array return types for emitting
  handlers.
- Support zero-emission `@React` according to ADR 0001.
- Emit deterministic structured analysis data suitable for the later generator
  task, without writing generated registry files in this slice.
- Add focused tests using fixture TypeScript source.
- Update relevant architecture/API docs and durable logs.

## Work Log

- `2026-07-07 20:36 WEST`: Created T-0015c branch and worktree from `main`
  commit `4b802fc`. The first sandboxed worktree creation attempt could not
  write Git refs; the same command succeeded through the approved escalation
  path.
- `2026-07-07 20:38 WEST`: `corepack pnpm install` in the sandbox failed with
  npm registry `ENOTFOUND`; reran the same command through the approved
  escalation path and linked the worktree dependencies successfully.
- `2026-07-07 20:44 WEST`: Implementation sub-agent added the build-time
  handler analyzer and focused tests.
  Files/commands: `packages/server/src/handler/build-time-handler-analyzer.ts`,
  `packages/server/test/handler/build-time-handler-analyzer.test.ts`,
  `corepack pnpm vitest run
packages/server/test/handler/build-time-handler-analyzer.test.ts`,
  `corepack pnpm typecheck:build`, `corepack pnpm lint`.
  Result: analyzer returns structured entity handler groups and diagnostics
  without writing generated registry files or adding a root public export.
- `2026-07-07 21:00 WEST`: Implementation sub-agent fixed review round 1
  findings.
  Files/commands: `packages/server/src/handler/build-time-handler-analyzer.ts`,
  `packages/server/test/handler/build-time-handler-analyzer.test.ts`,
  `build-protocol/TECHNICAL_SPEC.md`, `build-protocol/DEVELOPER_API.md`,
  `build-protocol/DECISION_LOG.md`, `corepack pnpm vitest run
packages/server/test/handler/build-time-handler-analyzer.test.ts`,
  `corepack pnpm typecheck:build`.
  Result: analyzer now verifies generated module exports, guards alias cycles,
  requires exported decorated entity classes, accepts `Array<T>` returns,
  accepts event inputs for `@Command`, validates emitted schema roles, and docs
  reflect the T-0015c analyzer scope.
- `2026-07-07 21:12 WEST`: Implementation sub-agent fixed review round 2
  findings.
  Files/commands: `packages/server/src/handler/build-time-handler-analyzer.ts`,
  `packages/server/test/handler/build-time-handler-analyzer.test.ts`,
  `build-protocol/BUILD_PROTOCOL.md`, `build-protocol/TODO_EXAMPLE_SPEC.md`,
  `build-protocol/DEVELOPER_API.md`, `build-protocol/TECHNICAL_SPEC.md`,
  `corepack pnpm vitest run
packages/server/test/handler/build-time-handler-analyzer.test.ts`,
  `corepack pnpm typecheck:build`.
  Result: analyzer now requires schema companions and namespace state schemas
  to be runtime value exports, rejects default-exported entity classes while
  accepting named export lists, surfaces TypeScript syntax diagnostics, and docs
  no longer document unimplemented rest tuple return forms.
- `2026-07-07 21:16 WEST`: Review round 3 returned clean documentation,
  TypeScript/API, security, performance/reliability, and JVM/ADR reviews. Style
  reported one P3 unreachable subscriber emitted-schema branch.
- `2026-07-07 21:17 WEST`: Main orchestrator removed the unreachable subscriber
  emitted-schema branch and diagnostic code.
- `2026-07-07 21:22 WEST`: Main orchestrator reran focused tests,
  `typecheck:build`, `docs:check`, `lint`, `format:check`, and diff checks; all
  commands passed. `docs:check` still reports the known invalid-origin TypeDoc
  source-link warning only.
- `2026-07-07 21:23 WEST`: Committed implementation as `89afdc1`.

## Verification Plan

- Focused analyzer tests with valid and invalid fixture source.
- `corepack pnpm typecheck:build`.
- `corepack pnpm docs:check` if public exports/API docs change.
- `corepack pnpm lint`.
- `corepack pnpm format:check`.
- `git diff --check`.
