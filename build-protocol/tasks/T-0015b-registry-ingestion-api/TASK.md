# T-0015b: Framework Registry Ingestion API

Status: integrated to main
Start: `2026-07-07 19:57 WEST`
End: `2026-07-07 20:25 WEST`
Baseline commit: `0d0f0eb`
Task log path: `build-protocol/tasks/T-0015b-registry-ingestion-api/TASK.md`
Branch: `task/T-0015b-registry-ingestion-api`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0015b-registry-ingestion-api`
Requirements splitter: `019f3dce-6067-7190-919d-cf6a62eebfa7`; completed and closed during T-0015a setup.
Authoring sub-agent: `019f3df6-7af3-7180-89e9-7db33a739884`; completed and closed.
Reviewer sub-agents: all required review lanes completed clean and closed.
Implementation commit: `8f8efcd`
Final branch HEAD: `37f7b16`
Integrated to main: `2026-07-07 20:34 WEST`

## Objective

Add a small framework-owned ingestion contract that can turn generated handler
registry metadata into the existing canonical `EntityHandlersMetadata` shape.

T-0015b must not implement TypeScript source analysis, package-level generation,
automatic runtime discovery, to-do example migration, or two-argument invocation.
It only defines the ingestion-side API that later generated modules can call.

## Human-Imposed Requirements Ledger

- End-user apps use bare `@Assign`, `@Command`, `@React`, and `@Subscribe`.
- No end-user schema-bearing decorators in ordinary app code.
- No app-owned `materializeDecoratedEntityHandlers()` or handler
  discovery/materialization helpers.
- Generated registry/build-time tooling owns schema inference from explicit
  first parameter types and emitted schemas from explicit return types.
- `@Assign`, `@Command`, and `@React` handlers require explicit return types.
- `@Subscribe` handlers require explicit `void` return types.
- `handler(signal)` and `handler(signal, context)` must be represented in the
  registry contract for later invocation support.
- `@Apply` is not supported for new generated registry records.
- Ordinary end-user handlers return generated domain messages, not framework
  `Command` or `Event` envelopes.
- Generated output remains ignored and uncommitted.
- Keep the ingestion API small and JVM-familiar; convert generated records into
  existing handler metadata rather than creating a parallel runtime registry.

## Context From T-0015a

T-0015a accepted `D-0059` and documented the logical registry shape:

- registry version `1`;
- entity groups with `entityType`, `stateSchema`, and handler records;
- handler records with kind, method name, signal schema, emitted schemas, and
  public arity `1 | 2`;
- supported kinds are command assignment, command reaction, event subscription,
  and event reaction;
- `event-application`/`@Apply` is excluded.

## Acceptance Criteria

- Add a narrow public or framework-owned TypeScript contract for generated
  handler registries.
- Provide an ingestion function/class that validates generated registry records
  and returns/folds into existing `EntityHandlersMetadata`.
- Preserve existing `defineEntityHandlers()` compatibility.
- Reject unsupported registry versions, `event-application` records, invalid
  arity, empty emitted schemas for command assignees/reactors, emitted schemas
  on subscribers, and duplicate/invalid records through existing metadata
  validation where possible. Event reactors may declare zero emitted schemas for
  ADR 0001-compatible no-emission reactions.
- Do not add analyzer, package generator, automatic discovery, to-do migration,
  or handler invocation behavior in this slice.
- Update docs/API docs and export expectations only for the API introduced here.

## Work Log

- `2026-07-07 19:57 WEST`: Created T-0015b branch and worktree from `main`
  commit `0d0f0eb`.
- `2026-07-07 20:20 WEST`: `corepack pnpm install` in the sandbox failed with
  npm registry `ENOTFOUND`; reran the same command through the approved
  escalation path and linked the worktree dependencies successfully.
- `2026-07-07 20:22 WEST`: Confirmed the implementation should keep the
  ingestion API narrow by translating generated records through
  `defineEntityHandlers()` so existing handler method validation and
  `HandlerMetadataRegistry` duplicate checks remain authoritative.
- `2026-07-07 20:23 WEST`: Implemented `HandlerRegistryIngestor` and the
  generated registry contract in `packages/server/src/handler/`, with focused
  tests for version, kind, arity, emitted-schema, method validation, and
  duplicate registry validation. Updated public exports, README/API
  expectations, and wrote the implementation report.
- `2026-07-07 20:25 WEST`: Fixed review round 1 findings. Registration now
  preflights complete target state before mutating caller-owned registries;
  generated state, signal, and emitted schemas are checked for object shape and
  non-empty `typeName`; top-level registry typing accepts heterogeneous
  per-entity groups; and generated event reactions may declare zero emitted
  schemas. Appended the round-1 fix report.
- `2026-07-07 20:30 WEST`: Review round 2 completed clean across
  code style/maintainability, documentation, TypeScript/API docs, security,
  performance/reliability, and JVM/ADR alignment. All participating sub-agents
  were closed.
- `2026-07-07 20:31 WEST`: Main orchestrator reran focused tests,
  `typecheck:build`, `docs:check`, `lint`, `format:check`, and
  `git diff --check`; all commands passed. `docs:check` still reports the known
  invalid-origin TypeDoc source-link warning only.
- `2026-07-07 20:34 WEST`: Fast-forward merged
  `task/T-0015b-registry-ingestion-api` into `main` at commit `37f7b16`.

## Verification Plan

- Focused tests for generated registry ingestion.
- `corepack pnpm typecheck:build`.
- `corepack pnpm docs:check` if public exports/API docs change.
- `corepack pnpm lint`.
- `corepack pnpm format:check`.
- `git diff --check`.
