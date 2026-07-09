# T-0017d: Event Subscription Targets

Status: complete
Started: `2026-07-09`
Branch: `task/T-0017d-event-subscriptions`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0017d-event-subscriptions`
Base commit: `3638e7c`

## Objective

Support event topic subscriptions and `event_updates`, not only entity state
subscriptions.

## Scope

- Production parity/runtime completeness task.
- Depends on completed `T-0017c` subscription lifecycle and matching semantics.
- Keep implementation small and JVM-familiar.
- Do not expose framework `Event` envelopes to end-user application handlers.
- Do not introduce durable subscription recovery, external transport topology,
  delivery schedulers, or process-manager execution in this slice.

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
- Server-module implementation requires close inspection of local Spine JVM
  docs and corresponding `core-jvm/server` sources before design or code
  changes.

## Required Research Before Implementation

- `spine-jvm-docs/spine-client-api-queries-subscriptions-and-tests.md`
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`
- Relevant local `core-jvm/server` sources for `Stand`, event subscription
  targets, `SubscriptionService`, event visibility/exposure rules, and event
  update payload assembly.
- Current TS surfaces:
  - `packages/server/src/services/spine-services.ts`
  - `packages/server/src/bus/event-bus.ts`
  - `packages/core/src/index.ts`
  - generated subscription/event proto imports and focused service tests.

## Acceptance Criteria

- Event topics can subscribe and activate through the subscription service.
- Activated event subscriptions stream `event_updates` for matching event
  types.
- Cancellation and duplicate activation behavior remain consistent with entity
  subscriptions.
- Unsupported or private event targets are rejected deterministically before
  listener attachment.
- Application code still deals in domain event messages, while framework event
  envelopes remain internal service/runtime data.
- Public docs and TypeScript/API docs describe the event subscription boundary.
- T-0017d logs record JVM research, implementation decisions, verification, and
  all agent participation.

## Verification Plan

- Focused event subscription service tests.
- Event bus/routing tests if the implementation touches event dispatch.
- Black-box fixture tests when useful.
- `pnpm format:check`
- `pnpm lint`
- `pnpm docs:check`
- `pnpm proto:check-generated`
- `pnpm --config.verify-deps-before-run=false verify`
- `git diff --check`
