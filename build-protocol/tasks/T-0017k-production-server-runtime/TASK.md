# T-0017k: Production Server Runtime Environment

Status: complete and integrated to `main`
Started: `2026-07-09`
Completed: `2026-07-09`
Branch: `task/T-0017k-production-server-runtime`
Worktree:
`.worktrees/T-0017k-production-server-runtime`
Base commit: `310bc6a`
Implementation commit: `50802e0`
Merge commit: `fa5d406`

## Objective

Add a small production-oriented server environment assembly for storage,
transport, delivery, tracing hooks, and server lifecycle ownership while
preserving the existing convenient local `Server` API.

## Scope

- Production parity/runtime completeness task after `T-0017j`.
- Add explicit environment ownership to server assembly.
- Make production mode refuse missing required runtime factories.
- Keep local/test defaults convenient and deterministic.
- Build service routing from built bounded-context metadata once per server
  start.
- Keep shutdown order explicit: stop network intake first, then close contexts
  and resources, then close environment-owned factories when the server owns the
  environment.
- Update package/API/architecture docs and durable logs.

## Out Of Scope

- ZeroMQ endpoint topology and worker process execution; that belongs to
  `T-0017l`.
- Full Java process-wide `ServerEnvironment` singleton behavior.
- Command-log repositories, full system event taxonomy, tracing backends,
  monitors, or debug UI.
- New storage adapters or production persistence implementations.
- Public exposure of raw internal system contexts.
- Any end-user requirement to use framework `Event` envelopes, manual
  transactions, schema-bearing decorators, `@Apply`, or application-owned
  handler materialization.

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
- Server-module implementation requires close inspection of local Spine JVM
  docs and corresponding `core-jvm/server` sources when available before design
  or code changes.
- Prefer simpler JVM-familiar behavior over new abstractions.
- Native execution is explicitly allowed for `corepack`, `pnpm install`,
  `pnpm --config.verify-deps-before-run=false verify`, and local IPC/loopback
  listener tests.

## JVM Research Inputs

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, especially
  `Server`, `ServerEnvironment`, environment/storage wiring, lifecycle and close
  behavior, and suggested TypeScript assembly API.
- `spine-jvm-docs/spine-validation-storage-observability-and-support.md` for
  storage and observability boundaries when docs mention production facilities.
- Current TypeScript `packages/server/src/server/server.ts`,
  `packages/server/src/runtime/runtime.ts`,
  `packages/server/src/runtime/runtime-transport.ts`,
  `packages/server/src/runtime/runtime-routing.ts`, and
  `packages/transport/src/index.ts`.

## JVM Observations To Preserve

- Java `ServerEnvironment` chooses storage, transport, delivery, tracing,
  command scheduling, deployment type, and node ID.
- Tests default to in-memory storage and in-memory transport. Non-test
  environments require configured storage and transport.
- Example applications configure the environment before creating contexts and
  servers.
- `Server.start()` opens the network container. Shutdown stops network intake,
  then closes contexts while continuing through close failures.
- `ServerEnvironment.close()` closes configured tracer, transport, and storage
  factories.
- The TypeScript design should prefer an explicit environment object over a
  broad singleton and should make factory ownership clear.

## Proposed Shape

- Add a small `ServerEnvironment` object under `packages/server/src/server/`.
- Provide local/test defaults through an explicit local environment factory.
- Provide production construction that requires storage and transport inputs.
- Let `Server` accept an environment and close it only when it is owned by the
  server.
- Keep `Server.atPort(0).start()` working for current tests and examples.
- Avoid adding transport-backed worker execution in this task; record that as
  the dependency for `T-0017l`.

## Acceptance Criteria

- Production server assembly rejects missing required factories with a clear
  deterministic error before opening a listener.
- Local/test server assembly still starts with no explicit environment.
- Server shutdown remains idempotent and closes network sessions before
  context/resource/environment close hooks.
- Environment ownership is explicit and tested.
- Service routing is built once when the server starts.
- Public docs describe the new environment boundary and still defer ZeroMQ
  workers, full tracing, command logs, and system event taxonomy.

## Verification Plan

- Focused `packages/server/test/server/server.test.ts`.
- New or updated environment/lifecycle tests.
- `pnpm --config.verify-deps-before-run=false typecheck:build`.
- `pnpm --config.verify-deps-before-run=false format:check`.
- `pnpm --config.verify-deps-before-run=false docs:check`.
- `git diff --check`.
- If local listener verification is blocked by sandboxing, rerun with
  escalation or record the denied operation as a blocker.
