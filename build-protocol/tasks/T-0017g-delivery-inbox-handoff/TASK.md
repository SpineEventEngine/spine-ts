# T-0017g: Delivery Inbox Handoff Integration

Status: complete, integrated
Started: `2026-07-09`
Branch: `task/T-0017g-delivery-inbox-handoff`
Worktree:
`.worktrees/T-0017g-delivery-inbox-handoff`
Base commit: `5a60517`

## Objective

Connect command and event routing to durable `Inbox` handoff where this slice
opts into endpoint delivery, while preserving the existing local direct path for
runtime behavior that is not yet handed to delivery.

## Scope

- Production parity/runtime completeness task after `T-0017f`.
- Inspect Spine JVM delivery, inbox, dispatching, repository endpoint, and
  deduplication behavior before server-module implementation.
- Add the smallest TypeScript runtime handoff needed to write routed endpoint
  messages to durable inbox records.
- Keep `InboxStorage` dedup guards authoritative.
- Preserve framework-owned signal wrapping and post-commit behavior.
- Keep existing direct local routes available unless this task explicitly moves
  a path behind inbox handoff.
- Add focused handoff tests and update public docs for the supported boundary.

## Out Of Scope

- Scheduler loops, retry policies, catch-up loops, and worker supervision.
- Production ZeroMQ worker execution.
- Durable subscription recovery.
- New storage engines.
- New public end-user handler APIs.
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
  docs and corresponding `core-jvm/server` sources before design or code
  changes.
- Prefer simpler JVM-familiar behavior over new abstractions.
- End-user code must not use framework `Event` envelopes, manual transactions,
  schema-bearing decorators, `@Apply`, default-route target-ID extraction, or
  application-owned handler materialization.
- Commands handled through the default command route must be rejected by the
  default route before handler invocation when the first-field target ID is
  missing or invalid.

## Skill Applicability

- Selected workflow skills read by the orchestrator: `executing-plans`,
  `subagent-driven-development`, `using-git-worktrees`, and
  `verification-before-completion`.
- Selected implementation/review guidance read before the implementation
  sub-agent was spawned: `test-driven-development`,
  `javascript-testing-patterns`, and `code-review-excellence`.
- Available relevant installed skills from the session inventory and local
  skill scan: `requesting-code-review`, `systematic-debugging`,
  `event-store-design`, `projection-patterns`, `cqrs-implementation`,
  `nodejs-backend-patterns`, and `architecture-patterns`.
- The task uses the workflow skills as binding process guidance and passes
  TDD/testing/review/debugging guidance to sub-agents. Domain skills are
  advisory only; `BUILD_PROTOCOL.md`, `TECHNICAL_SPEC.md`,
  `CODE_QUALITY.md`, and inspected Spine JVM source govern conflicts.
- Skill inventory sources checked: live session skill list,
  `find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`, and
  `~/.agents/.skill-lock.json`.

## JVM Research Inputs

- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`, especially
  repository dispatch to inbox, inbox message schema, delivery,
  deduplication, and direct/local delivery modes.
- Current Spine JVM delivery sources fetched into `/private/tmp`:
  - `/private/tmp/spine-jvm-delivery/Delivery.java`
  - `/private/tmp/spine-jvm-delivery/Inbox.java`
  - `/private/tmp/spine-jvm-delivery/InboxOfCommands.java`
- Fetching `InboxOfEvents.java` and `TargetDelivery.java` returned GitHub HTTP
  429; use the local research notes for those adjacent roles.

## JVM Observations To Preserve

- Repositories normally route signals and write inbox messages instead of
  invoking endpoint handlers directly.
- `Inbox.send(command).toHandler(id)` stores command work with the
  `HANDLE_COMMAND` label.
- `Inbox.send(event).toReactor(id)`, `toSubscriber(id)`, `toImporter(id)`, and
  `toCatchUp(id)` store event work with distinct labels.
- `Delivery.local()` keeps inbox storage and shard delivery while draining
  synchronously for local/development environments.
- `Delivery.direct()` is the explicit unsafe bypass that skips inbox storage
  and sharding.
- Delivery deduplication is per original signal plus target inbox, not per
  generated inbox record UUID alone.

## Acceptance Criteria

- A routed command or event path selected by this task writes a durable inbox
  record before endpoint delivery.
- `InboxStorage` remains the authority for deduplication and duplicate
  handling.
- Direct local paths do not bypass durability for paths moved behind inbox
  handoff.
- The implementation keeps a small public API and does not expose delivery
  internals to ordinary end-user code.
- Tenant isolation and signal type URLs are preserved through the handoff.
- Handoff failures are observable without pretending a message was delivered.
- Public docs/API docs describe the supported handoff and the deferred
  scheduler/retry/worker boundary.

## Verification Plan

- Focused inbox handoff tests.
- Delivery and bus regression tests affected by the handoff path.
- End-user API audit over changed examples/docs.
- `pnpm --config.verify-deps-before-run=false format:check`
- `pnpm --config.verify-deps-before-run=false lint`
- `pnpm --config.verify-deps-before-run=false docs:check`
- `pnpm --config.verify-deps-before-run=false proto:check-generated`
- `pnpm --config.verify-deps-before-run=false verify`
- `git diff --check`
