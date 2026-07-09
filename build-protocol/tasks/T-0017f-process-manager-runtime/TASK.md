# T-0017f: ProcessManager Runtime Execution

Status: complete, integrated
Started: `2026-07-09`
Branch: `task/T-0017f-process-manager-runtime`
Worktree:
`.worktrees/T-0017f-process-manager-runtime`
Base commit: `52e287f`

## Objective

Execute process managers as durable state machines over command and event
endpoints, while reusing the existing repository, transaction, bus, and handler
machinery.

## Scope

- Production parity/runtime completeness task after `T-0017e`.
- Add process-manager command and event execution to the current local runtime.
- Route process-manager commands by the default first command field.
- Route process-manager events by the default first event message field.
- Load or create process-manager instances on demand.
- Mutate and store process-manager state in the `Stand` entity-record path.
- Allow generated `@Assign`, `@Command`, and `@React` handlers to produce
  domain messages; the framework wraps them internally.
- Preserve post-commit dispatch for produced commands/events.
- Keep tenant-aware isolation aligned with command/event context handling.

## Out Of Scope

- Durable inbox handoff, delivery scheduler loops, retry workers, and durable
  subscription recovery.
- New process-manager-specific storage abstractions.
- Public process-manager query client injection.
- Application-owned handler materialization.
- Schema-bearing public decorators, framework `Event` envelopes in end-user
  code, manual end-user transactions, or `@Apply`.

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

## JVM Research Inputs

- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`
- `spine-jvm-docs/spine-entities-repositories-and-state.md`
- Downloaded research files under `/private/tmp/spine-jvm-procman/`:
  - `ProcessManagerRepository.java`
  - `ProcessManager.java`
  - `PmCommandEndpoint.java`
  - `PmEventEndpoint.java`
- `PmTransaction.java` fetch returned a GitHub HTTP 429 page. Use the local JVM
  docs' `PmTransaction` summary and the endpoint/repository sources rather than
  inventing a separate TS transaction abstraction.

## JVM Observations To Preserve

- `ProcessManagerRepository` registers command and event endpoints.
- It requires at least one command handler, event reactor, rejection reactor, or
  commanding method.
- Its command routing default reads the first command field.
- Its event routing default reads the first event message field.
- Process managers are created on demand when routed to an ID without a stored
  record.
- Process-manager updates are stored as entity records and may have columns.
- Produced commands/events are emitted after successful handling, not by
  application code constructing framework envelopes.

## Acceptance Criteria

- Process-manager repositories participate in command bus and event bus routing.
- Generated process-manager command handlers mutate and store state.
- Generated process-manager event reactors mutate and store state.
- Process-manager command handlers can emit events, and event reactors can emit
  commands/events through framework-owned wrapping.
- Produced signals dispatch only after the process-manager transaction commits.
- Default command/event routing rejects missing target IDs before handler code
  runs, unless custom routing is explicitly introduced in a later task.
- Tenant-specific process-manager state does not leak across tenants.
- Public docs/API docs describe the supported process-manager runtime behavior
  and the deferred durable inbox boundary.

## Verification Plan

- Focused process-manager repository routing and execution tests.
- Regression tests proving handlers return domain messages, not framework
  envelopes.
- Tests for default first-field routing and missing-ID rejection.
- Tests for tenant-aware storage isolation.
- Focused command/event emission tests.
- `pnpm --config.verify-deps-before-run=false format:check`
- `pnpm --config.verify-deps-before-run=false lint`
- `pnpm --config.verify-deps-before-run=false docs:check`
- `pnpm --config.verify-deps-before-run=false proto:check-generated`
- `pnpm --config.verify-deps-before-run=false verify`
- `git diff --check`
