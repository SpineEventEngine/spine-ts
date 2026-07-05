# T-0012.11d: Validation And Immediate Refusal Outcomes

Status: round-17 documentation/status fixes verified; ready for follow-up review
Branch: `task/T-0012-11d-validation-refusal`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11d-validation-refusal`
Baseline commit: `c13b19c`

## Goal

Wire existing validation and immediate refusal behavior into command execution
so the to-do example can demonstrate invalid input and a business refusal
without adding a large result protocol.

## Scope

- Validate command payload messages with the existing
  `@spine-event-engine/validation-ts` facade before durable write-side work.
- Surface one immediate aggregate-command refusal path through the public
  `CommandService.Post` `Ack` error status while preserving stable
  client-visible error information.
- Keep existing entity transition validation, including `(set_once)`, enforced
  at the transaction/runtime boundary used by aggregate command execution.
- Keep the implementation narrow. Do not add a broad refusal hierarchy, result
  stream, broker protocol, or speculative delivery integration.

## Expected Write Scope

- `packages/server/src/repository/**`
- `packages/server/src/services/**`
- `packages/server/src/entity/**`
- `packages/server/test/**`
- `docs/**` and `packages/server/README.md` if public behavior changes
- this task's durable logs and the parent `T-0012.11` logs
- `packages/core/src/**` and `packages/core/test/**` only if a missing
  validation seam is proven

## Evidence To Inspect

- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- `build-protocol/DEVELOPER_API.md`
- `packages/core/src/index.ts`
- `packages/server/src/services/spine-services.ts`
- `packages/server/src/repository/repository.ts`
- `packages/server/src/entity/entity-transaction.ts`
- relevant JVM docs under `spine-jvm-docs`, especially command dispatch,
  validation, and rejection/refusal semantics

## Acceptance Criteria

- Invalid command payloads are rejected before aggregate load, event append,
  snapshot write, or event dispatch.
- A command handler can immediately refuse a command, and `CommandService.Post`
  returns a non-ok `Ack` with stable client-visible error information rather
  than the generic `COMMAND_POST_ERROR`.
- State-transition validation failures during aggregate command execution do not
  write invalid snapshots/events and are observable as stable command errors.
- Tests cover invalid payload validation, immediate refusal acknowledgements,
  and transition validation during command execution.
- Required verification passes: focused tests, `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `pnpm docs:check`, `git diff --check`, and
  `pnpm test:coverage`.
