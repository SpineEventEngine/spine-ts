# T-0017i: Durable Subscription Recovery

Status: complete, pending integration
Started: `2026-07-09`
Branch: `task/T-0017i-durable-subscription-recovery`
Worktree:
`.worktrees/T-0017i-durable-subscription-recovery`
Base commit: `056626c`

## Objective

Recover service subscriptions across `SpineServices` runtime restarts when the
same storage factory is reused, while keeping subscription delivery a read-side
service concern separate from write-side buses and durable inbox delivery.

## Scope

- Production parity/runtime completeness task after `T-0017h`.
- Inspect Spine JVM subscription-service and Stand behavior before
  server-module implementation.
- Add the smallest durable subscription record boundary needed for
  `SubscriptionService.Subscribe`, `Activate`, and `Cancel` recovery.
- Keep active stream delivery process-local: a recovered subscription is
  reattached when the client activates the returned opaque subscription ID.
- Preserve existing state and event subscription semantics, tenant checks,
  duplicate activation behavior, cancellation behavior, and unknown-target
  routing constraints.
- Update docs/API docs and durable logs.

## Out Of Scope

- Client SDK subscription registry.
- Cross-process stream ownership or lease coordination.
- Unknown-target fan-out implementation beyond preserving the existing
  unsupported-target behavior unless the slice can add it safely and narrowly.
- Durable queued update replay, retained stream update history, or backfill.
- Transport-backed subscription worker execution.
- New storage engines or storage-factory methods unless the implementation
  proves the current `RecordStorage` seam is insufficient.
- Application-owned handler materialization, schema-bearing decorators,
  framework envelopes in end-user code, manual end-user transactions, or
  `@Apply`.

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
- Preserve Protobuf contracts, type URLs, generated-code policy, and generated
  registry ownership.
- Server-module implementation requires close inspection of local Spine JVM
  docs and corresponding `core-jvm/server` sources when available before design
  or code changes.
- Prefer simpler JVM-familiar behavior over new abstractions.
- Do not over-engineer the `server` module; start from the corresponding Spine
  JVM concepts and keep the TypeScript slice deliberately smaller when full JVM
  machinery is not needed yet.
- Keep strict read-side/write-side segregation. Query and subscription APIs are
  read-side services, not command/event bus dispatch or inbox delivery.
- End-user code must not use framework `Event` envelopes, manual transactions,
  schema-bearing decorators, `@Apply`, default-route target-ID extraction, or
  application-owned handler materialization.
- Commands handled through the default command route must be rejected by the
  default route before handler invocation when the first-field target ID is
  missing or invalid.
- Native execution is explicitly allowed for `corepack`, `pnpm install`,
  `pnpm --config.verify-deps-before-run=false verify`, and local IPC/loopback
  listener tests.

## Skill Applicability

- Selected workflow skills already read by the orchestrator in this session:
  `executing-plans`, `subagent-driven-development`,
  `verification-before-completion`, `systematic-debugging`, and
  `test-driven-development`.
- Applicable installed skills from the session inventory and expected-skill
  manifest: `using-git-worktrees`, `requesting-code-review`,
  `nodejs-backend-patterns`, `architecture-patterns`,
  `javascript-testing-patterns`, `typescript-advanced-types`,
  `cqrs-implementation`, and `projection-patterns`.
- The task uses workflow, TDD/testing, review, backend lifecycle, and
  TypeScript/API skills as advisory guidance. `BUILD_PROTOCOL.md`,
  `TECHNICAL_SPEC.md`, `CODE_QUALITY.md`, this task ledger, sandbox rules, and
  inspected Spine JVM notes/source govern conflicts.
- Skill inventory sources checked: live session skill list,
  `build-protocol/skills/EXPECTED_SKILLS.md`,
  `/Users/armiol/.agents/skills`, and `/Users/armiol/.agents/.skill-lock.json`.

## JVM Research Inputs

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, especially
  service contracts, `TypeDictionary`, `SubscriptionService`, `Stand`,
  unknown-target fallback, activation, cancellation, and multitenancy.
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`, especially query
  and subscription delivery separation from buses/inbox delivery.
- `spine-jvm-docs/spine-client-api-queries-subscriptions-and-tests.md`,
  especially separate subscribe/activate/cancel calls, opaque subscription IDs,
  and client-side cancellation expectations.
- Direct source lookup for current `core-jvm` `SubscriptionService.java` and
  `Stand.java` was attempted through web URLs and returned cache-miss failures;
  local `/private/tmp` JVM source snapshots do not include these files. Continue
  from the local research notes unless implementation details require another
  source-fetch attempt.

## JVM Observations To Preserve

- `Subscribe(Topic)`, `Activate(Subscription)`, and `Cancel(Subscription)` are
  separate protocol steps.
- Query and subscription services are read-side services over `Stand`, not bus
  dispatch or inbox delivery.
- A returned subscription ID is opaque and must be routed through the
  subscription service for activation and cancellation.
- JVM unknown-target fallback can fan out behind one client-visible
  subscription ID. This TS slice may preserve existing unsupported-target
  behavior if implementing fan-out would be broader than durable recovery, but
  docs must not imply fan-out exists unless it is implemented.
- Node stream implementations must guard stream ownership and avoid duplicate
  activation.

## Acceptance Criteria

- `SubscriptionService.Subscribe` can persist inactive subscription records
  through the configured storage factory.
- A new `SpineServices` instance over the same storage factory can
  activate a previously returned subscription ID and deliver future matching
  state or event updates.
- `Cancel` removes both process-local and durable subscription records.
- Duplicate activation behavior remains deterministic and does not create
  duplicate Stand/EventBus attachments.
- Tenant isolation and topic validation remain authoritative before activation.
- Inactive TTL cleanup removes durable records as well as process-local records.
- Public docs/API docs describe what survives restart and what does not:
  active streams/queued updates are process-local, while inactive subscription
  records are durable in this slice.
- Durable storage contains inactive subscription records only; recovered
  activation consumes the durable row before live attachment.
- Malformed, expired, or inconsistent durable records fail closed by deletion
  and do not remain poisoned for repeated recovery attempts.

## Verification Plan

- Focused durable subscription recovery tests for state and event
  subscriptions.
- Cancellation/restart cleanup tests.
- Duplicate activation and tenant regression tests affected by the storage
  path.
- Service lifecycle tests affected by subscription recovery.
- `pnpm --config.verify-deps-before-run=false format:check`
- `pnpm --config.verify-deps-before-run=false docs:check`
- `pnpm --config.verify-deps-before-run=false verify`
- `git diff --check`
