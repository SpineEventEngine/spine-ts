# T-0017h: Delivery Scheduler, Retry, And Catch-Up Loops

Status: in progress
Started: `2026-07-09`
Branch: `task/T-0017h-delivery-scheduler-retry`
Worktree:
`.worktrees/T-0017h-delivery-scheduler-retry`
Base commit: `35134c3`

## Objective

Add a small framework-owned delivery loop around the existing durable
`Delivery.drain()` boundary so pending inbox rows can be retried and drained
until a shard becomes idle, without importing the full Spine JVM conveyor and
station model into this early TypeScript runtime.

## Scope

- Production parity/runtime completeness task after `T-0017g`.
- Inspect Spine JVM delivery, shard leasing, retry, catch-up, monitor, and
  local delivery behavior before server-module implementation.
- Add the smallest TypeScript delivery loop needed to repeat `Delivery.drain()`
  for one shard with bounded idle/failure behavior and clean shutdown.
- Keep retry semantics durable by leaving failed rows `TO_DELIVER`; do not add
  a separate attempt-history store in this task.
- Preserve the existing process-manager handoff and direct local paths unless
  this task explicitly routes them through the new loop.
- Update public docs and API docs so the implemented delivery lifecycle and
  deferred production pieces are clear.

## Out Of Scope

- Full JVM conveyor/station pipeline.
- Separate catch-up storage, catch-up inbox rows, or projection catch-up
  lifecycle persistence.
- Production ZeroMQ worker execution or cross-process supervision.
- Retained per-attempt failure history.
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
- Do not over-engineer the `server` module; start from the corresponding Spine
  JVM concepts and keep the TypeScript slice deliberately smaller when full JVM
  machinery is not needed yet.
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
  `javascript-testing-patterns`, and `typescript-advanced-types`.
- The task uses workflow, TDD/testing, review, and backend lifecycle skills as
  advisory guidance. `BUILD_PROTOCOL.md`, `TECHNICAL_SPEC.md`,
  `CODE_QUALITY.md`, this task ledger, sandbox rules, and inspected Spine JVM
  source govern conflicts.
- Skill inventory sources checked: live session skill list,
  `build-protocol/skills/EXPECTED_SKILLS.md`, and planned bounded local scans
  of `~/.agents/skills` and `~/.agents/.skill-lock.json` before implementation
  sub-agent work.

## JVM Research Inputs

- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`, especially
  delivery, shard registry, delivery run, failures/retries, and direct/local
  delivery modes.
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, especially
  server environment delivery and storage factory ownership.
- Current local Spine JVM delivery source snapshots:
  - `/private/tmp/spine-jvm-delivery/Delivery.java`
  - `/private/tmp/spine-jvm-delivery/Inbox.java`
  - `/private/tmp/spine-jvm-delivery/InboxOfCommands.java`
- If additional source fetches are blocked by network or rate limits, record
  the exact failure and continue with the local source snapshots plus research
  notes.

## JVM Observations To Preserve

- `Delivery.deliverMessagesFrom(shard)` picks up one shard, reads pages, runs
  delivery stages, releases the shard, and can repeat for messages appended to
  the same shard during delivery.
- Only one node may own a shard at a time through `ShardedWorkRegistry`.
- Failed endpoint reception is monitor/retry driven in JVM; a repeat callback
  can retry without losing durable inbox state.
- Local delivery still goes through inbox storage and shard locking; direct
  delivery is the explicit unsafe bypass.
- Catch-up is conceptually part of delivery but has its own storage/lifecycle;
  this task must not fake durable catch-up storage.

## Acceptance Criteria

- A framework-owned delivery loop can repeatedly drain one shard until it
  becomes idle, hits a configured failure bound, or is stopped.
- Failed messages remain pending for later retry through the existing durable
  inbox status behavior.
- A skipped shard claim is reported without invoking endpoints.
- The loop shuts down cleanly and does not start a new drain after stop.
- Catch-up coordination is represented only by honest hooks or documentation
  for the current `BoundedContext.catchUpReadSide()` path; no fake durable
  catch-up storage is introduced.
- The API remains small and ordinary end-user code does not see delivery
  internals.
- Public docs/API docs describe the supported loop, retry behavior, shutdown
  semantics, and deferred production pieces.

## Verification Plan

- Focused scheduler/retry/shutdown tests for the delivery loop.
- Regression tests for existing `Delivery.drain()` and process-manager handoff
  behavior when touched.
- End-user API audit over changed examples/docs.
- `pnpm --config.verify-deps-before-run=false format:check`
- `pnpm --config.verify-deps-before-run=false lint`
- `pnpm --config.verify-deps-before-run=false docs:check`
- `pnpm --config.verify-deps-before-run=false proto:check-generated`
- `pnpm --config.verify-deps-before-run=false verify`
- `git diff --check`
