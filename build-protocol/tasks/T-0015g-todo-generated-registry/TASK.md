# T-0015g: To-Do Example Generated Registry Migration

Status: in_progress
Start: `2026-07-08 00:05 WEST`
Baseline commit: `81c325b`
Branch: `task/T-0015g-todo-generated-registry`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0015g-todo-generated-registry`

## Objective

Move the to-do example to the ordinary end-user API shape backed by
framework-owned generated handler registry discovery.

The example must not materialize decorated handlers, call
`defineEntityHandlers()` for decorated methods, return framework `Event`
envelopes from command handlers, create framework event IDs, use `@Apply`, or
manage framework transactions directly.

## Human-Imposed Requirements Ledger

- Handler discovery and materialization are framework responsibilities.
- End-user code uses bare decorators such as `@Assign` and `@Subscribe`, not
  schema-bearing decorators or explicit schema metadata beside each decorator.
- Command handlers return generated domain event messages, singular or array.
- `@Subscribe` handlers return `void`.
- `@Apply` is not supported for new aggregate code; aggregates are moving away
  from event sourcing.
- Framework-internal `Event` envelopes and event IDs are not part of ordinary
  end-user handler code.
- Framework transactions are not started or committed by end-user code.
- Default command routing validates the first declared command field before the
  command reaches the handler unless a repository overrides command routing.
- Generated Protobuf output under `generated/` is ignored and regenerated.
- Keep the implementation small and JVM-familiar. Inspect Spine JVM concepts
  before expanding the API.

## Scope

- Generate and load handler metadata for the to-do example from framework-owned
  registry tooling.
- Remove manual handler metadata assembly from the example repositories.
- Add a small build-time utility or package script only if needed to regenerate
  the example handler registry.
- Wire the example runtime to the generated registry without exposing registry
  materialization in application code.
- Keep the example running through real Connect/gRPC services with in-memory
  storage.
- Update example and framework documentation for the developer workflow.
- Add or update focused tests proving the example uses generated registry
  metadata and keeps the end-user handler surface free of framework internals.

## Out Of Scope

- Rewriting repository storage, bus, delivery, Stand, or gRPC service internals
  beyond what this migration requires.
- Adding `@Apply` compatibility.
- Introducing global service locators, broad facades, or speculative registry
  containers.
- Committing generated registry or Protobuf output.
- Simulating gRPC.

## Acceptance Criteria

- `examples/todo/src/index.ts` does not import or call
  `defineEntityHandlers()` or `materializeDecoratedEntityHandlers()`.
- To-do command handlers return generated domain event messages, not framework
  `Event`.
- To-do aggregate code contains no `@Apply`, app-managed transaction calls, or
  app-created framework event IDs.
- The generated handler registry is produced during the build/test workflow and
  loaded by framework-owned discovery.
- Missing or stale generated registry metadata fails deterministically.
- Example tests cover command handling, read-side projection updates, real
  service access, and the generated-registry wiring.
- Documentation explains how application packages get generated registries and
  how to build/run the to-do example.
- Durable work and review logs are updated.
- Required reviewer lanes run until clean.

## Verification Plan

- Focused example tests.
- Focused generated registry/analyzer/discovery tests when touched.
- `corepack pnpm typecheck:build`.
- `corepack pnpm docs:check`.
- `corepack pnpm lint`.
- `corepack pnpm format:check`.
- `git diff --check`.
