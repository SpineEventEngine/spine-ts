# T-0017e: Command-Producing And Event-Reactor Execution

Status: complete, integrated
Started: `2026-07-09`
Completed: `2026-07-09`
Branch: `task/T-0017e-reactor-commanders`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0017e-reactor-commanders`
Base commit: `0a18a3c`

## Objective

Execute generated `@Command` and `@React` handlers that produce domain
messages while the framework wraps produced messages internally.

## Scope

- Production parity/runtime completeness task.
- Depends on completed generated registry work, command/event buses, and
  `T-0017d` event target semantics.
- Keep implementation small and JVM-familiar.
- Support generated command-producing and event-reactor handler metadata through
  framework-owned materialization.
- Produced command and event domain messages must become framework envelopes
  internally.
- End-user handlers must not return or receive framework `Event` envelopes.
- Do not introduce process-manager runtime execution, durable inbox handoff,
  delivery schedulers, durable subscription recovery, or transport-backed worker
  execution in this slice.

## Human-Imposed Requirements Ledger

- Continue autonomously until all tasks are done or a real blocker appears.
- Keep `human-review-1-jul.md` untouched.
- Use this branch/worktree for this task.
- Spawn one implementation sub-agent for the task.
- Run independent reviewer sub-agents for code style/maintainability,
  documentation, TypeScript/API docs, security, and performance/reliability.
- Feed reviewer comments back to an authoring/fix sub-agent and repeat until
  all lanes are clean.
- Close every participating sub-agent once its role is complete.
- No change may be made without updating the relevant durable log.
- Preserve Protobuf contracts, type URLs, options, and generated-code policy.
- Preserve generated registry contracts and framework-owned handler
  materialization.
- Keep end-user code free of framework `Event` envelopes, manual transactions,
  schema-bearing decorators, `@Apply`, and application-owned handler
  materialization.
- Command handlers that emit events must return at least one domain event
  message, either singular or array/readonly array.
- `@Command` and `@React` handlers that emit commands or events require
  explicit first-parameter and return types so generated registry tooling can
  map messages to schemas.
- `@Subscribe` handlers must return `void`; `@Apply` is not supported.
- Server-module implementation requires close inspection of local Spine JVM
  docs and corresponding `core-jvm/server` sources before design or code
  changes.

## Required Research Before Implementation

- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`
- Relevant local or fetched `core-jvm/server` sources for:
  - `@Command` handler dispatch and model validation.
  - `@React` event reactor dispatch and model validation.
  - Event origin rules and produced event/command wrapping.
  - Post-commit dispatch behavior for emitted signals.
- Current TS surfaces:
  - `packages/server/src/handler/*`
  - `packages/server/src/bus/command-bus.ts`
  - `packages/server/src/bus/event-bus.ts`
  - `packages/server/src/repository/*`
  - `packages/server/src/runtime/*`
  - generated registry package and tests.

## Acceptance Criteria

- Generated command-producing handlers run through framework-owned
  materialization.
- Generated event-reactor handlers run through framework-owned materialization.
- Domain messages returned by those handlers are wrapped into internal command
  or event envelopes by the framework.
- Post-commit dispatch is preserved: produced signals are dispatched only after
  the handler's current transactional work succeeds.
- End-user code remains domain-message oriented and does not construct
  framework `Event` envelopes or call transaction APIs.
- Handler metadata validation rejects missing or unsupported produced-message
  schemas with clear errors.
- Public docs and TypeScript/API docs describe command-producing and
  event-reactor handler behavior without exposing internal envelope details.
- T-0017e logs record JVM research, implementation decisions, verification, and
  all agent participation.

## Verification Plan

- Generated-registry and metadata validation tests.
- Handler execution tests for `@Command` and `@React` metadata.
- Command bus and event bus integration tests covering post-commit dispatch.
- Regression tests proving user handlers return domain messages, not framework
  envelopes.
- `pnpm format:check`
- `pnpm lint`
- `pnpm docs:check`
- `pnpm proto:check-generated`
- `pnpm --config.verify-deps-before-run=false verify`
- `git diff --check`

## Completion Evidence

- All required reviewer lanes completed clean after fix/re-review rounds.
- Full `pnpm --config.verify-deps-before-run=false verify` passed: 53 normal
  test files, 971 normal tests, coverage suite passed with 90% branch coverage,
  TypeDoc/API checks passed with the existing invalid `origin` warning only,
  and generated proto outputs were ignored, untracked, and freshly regenerated.
