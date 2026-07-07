# T-0015f: Two-Argument Handler Invocation

Status: completed
Start: `2026-07-08 00:29 WEST`
End: `2026-07-08 02:10 WEST`
Baseline commit: `1a59541`
Task log path: `build-protocol/tasks/T-0015f-two-arg-handlers/TASK.md`
Branch: `task/T-0015f-two-arg-handlers`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0015f-two-arg-handlers`
Requirements splitter: `019f3dce-6067-7190-919d-cf6a62eebfa7`; completed
and closed during T-0015a setup.
Authoring sub-agent: `019f3eb0-36e2-7171-8174-10b578c692ec`; completed and closed
Reviewer status: all required lanes clean after two rounds plus focused style/log recheck
Implementation commit: `54c9f1e`
Final branch HEAD: `54c9f1e`
Integrated to main: Pending

## Objective

Invoke generated-registry handlers according to their recorded public arity:
`handler(signal)` or `handler(signal, context)`.

T-0015f should preserve generated handler `parameterCount` in canonical handler
metadata and pass the generated Protobuf context from the incoming framework
envelope when the handler declared two parameters. The slice must stay focused
on invocation behavior and must not migrate the to-do example, add broad
runtime routing, revive event sourcing, or add `@Apply` support.

## Human-Imposed Requirements Ledger

- `handler(signal)` and `handler(signal, context)` must be available for
  `@Assign`, `@Command`, `@React`, and `@Subscribe`.
- The second parameter is a generated context message from the incoming signal
  envelope, such as `CommandContext` or `EventContext`, not a TypeScript-only
  helper type.
- `@Apply` must not get two-argument support.
- Ordinary handler return values remain generated domain messages, not
  framework `Command` or `Event` envelopes.
- Handler discovery/materialization remains framework-owned.
- Keep the API small and JVM-familiar; do not add broad facades, global
  registries, or speculative runtime concepts.

## Scope

- Carry generated handler arity into canonical handler metadata.
- Keep explicit/schema-bearing legacy registrations one-argument by default.
- Invoke command assignees with `CommandContext` when their metadata declares
  two parameters.
- Invoke event subscribers with `EventContext` when their metadata declares two
  parameters.
- Preserve current one-argument behavior for existing handlers.
- Add focused tests for one- and two-argument invocation paths.

## Out Of Scope

- To-do example migration.
- Runtime execution of handler categories that are not executed by the current
  repository runtime.
- New generated registry writer or analyzer behavior unless needed to preserve
  existing `parameterCount` data.
- `@Apply` two-argument support.
- Event-sourced aggregate behavior.
- gRPC, Stand, delivery, transport, or broader runtime redesign.

## Acceptance Criteria

- Generated registry ingestion preserves `parameterCount` in canonical metadata.
- Runtime invocation passes exactly one argument for one-argument handlers and
  exactly two arguments for generated two-argument handlers.
- Command assignees receive the command message and generated `CommandContext`.
- Event subscribers receive the event message and generated `EventContext`.
- Existing explicit handler metadata and legacy decorator materialization remain
  one-argument compatible.
- Technical/API docs and package README document the invocation rule.
- Durable work and review logs are updated.
- Required reviewer lanes run until clean.

## Verification Plan

- Focused repository/runtime tests for two-argument command and event handlers.
- Focused generated registry ingestion/API tests.
- `corepack pnpm typecheck:build`.
- `corepack pnpm docs:check`.
- `corepack pnpm lint`.
- `corepack pnpm format:check`.
- `git diff --check`.
