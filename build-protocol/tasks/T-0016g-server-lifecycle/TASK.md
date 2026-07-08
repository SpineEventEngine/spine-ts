# T-0016g: Server Lifecycle And Environment

Status: in progress
Start: `2026-07-08T15:11:00Z`
Baseline commit: `655a4d6`
Branch: `task/T-0016g-server-lifecycle`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0016g-server-lifecycle`

## Objective

Add the first small framework-owned server lifecycle owner for real
gRPC-compatible Spine services. The owner should replace ad-hoc listener
startup/close code in tests and the to-do example, close network intake before
framework resources, and keep context, runtime, storage, delivery, and transport
ownership explicit.

This task must not build a broad JVM-style singleton environment or process
supervisor. It should be a narrow, OOP-style Node server API that composes the
already implemented bounded contexts and `SpineServices`.

## Requirements

- Provide a small public server API that can start real Connect/gRPC-compatible
  services over Node HTTP/2 and close them deterministically.
- Default listener binding must be local-only (`127.0.0.1`). Wider host binding
  must be explicit and documented.
- Shutdown must stop external network intake first, close active sessions, then
  close context/runtime-owned resources in a deterministic order.
- Ownership of closeable resources must be explicit. A server may own contexts
  it is given for application assembly, but it must not silently close external
  transport/storage factories it did not create.
- The public API must not expose ZeroMQ, socket details, worker supervision, or a
  process-wide singleton environment.
- Keep the implementation simple and JVM-familiar. Prefer names such as
  `Server`, `ServerOptions`, and `RunningServer` over long TypeScript-specific
  names.
- Reuse the existing `SpineServices` route registrar directly. Do not create a
  facade layer unless it removes real caller complexity.
- Replace duplicated ad-hoc HTTP/2 server lifecycle helpers in the to-do example
  and relevant service tests with the framework-owned server API.
- Document native execution expectations for listener-based verification:
  managed sandbox runs may reject local loopback/IPC listeners with `EPERM`, so
  full verification must be rerun natively when needed.
- Update architecture docs, developer/API docs, package docs, user guides, task
  logs, and review logs.

## Spine JVM Inspection

Local JVM research docs inspected before implementation:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`
- `spine-jvm-docs/spine-validation-storage-observability-and-support.md`
- `spine-jvm-docs/spine-client-api-queries-subscriptions-and-tests.md`

Implementation impact:

- JVM `Server.start()` starts the gRPC container and installs shutdown handling.
  JVM `Server.shutdown()` stops externally visible transport first, then closes
  every context while logging/continuing on context-close failures.
- JVM `BoundedContext.close()` closes command bus, event bus, integration
  broker, stand, import bus, and repositories in order. Spine TS currently has
  fewer parts, so this task should close the parts that exist instead of
  inventing the missing ones.
- JVM `ServerEnvironment` owns process-wide storage and transport factories, but
  the TS implementation should not introduce a singleton environment in this
  task. Use an explicit server owner and keep factory ownership separate.
- JVM tests often rely on in-memory storage/transport defaults. The TS first
  server API may keep in-memory storage through `BoundedContextBuilder` defaults
  and should not add persistence-specific options.

Direct raw GitHub source inspection may be unavailable in this managed session.
When that happens, the local JVM research docs remain the recorded source for
this slice.

## Likely Files

- `packages/server/src/server`
- `packages/server/src/services/spine-services.ts`
- `packages/server/src/context/bounded-context.ts`
- `packages/server/test/server`
- `packages/server/test/services/spine-services.test.ts`
- `examples/todo/src/index.ts`
- `examples/todo/src/index.test.ts`
- `packages/server/src/index.ts`
- `packages/server/README.md`
- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`

## Acceptance Criteria

- Public code can start a real local Spine server with:
  `await Server.atPort(port).add(context).start()` or an equally small
  JVM-familiar shape.
- The returned running server exposes `host`, `port`, `baseUrl`, and an
  idempotent `close()` method.
- Default host is `127.0.0.1`; examples and docs do not bind broadly unless the
  caller opts in.
- Close order is deterministic and covered by tests: stop request intake, close
  active HTTP/2 sessions, then close owned bounded contexts/resources.
- Context close is idempotent or safely handled so repeated server close does
  not duplicate cleanup.
- If one owned context/resource close fails, the server still attempts remaining
  closes and reports a useful aggregate failure.
- The to-do example uses the framework-owned server lifecycle API and does not
  duplicate HTTP/2 lifecycle helpers.
- Focused tests cover start/close, default local binding, explicit host/port,
  context close ordering/failure continuation, and example start/stop behavior.
- Public docs and TypeDoc/API docs describe lifecycle ownership, local binding
  defaults, shutdown order, and native verification expectations.
- Required review lanes are clean: code style/maintainability, documentation,
  TypeScript/API docs, security, and performance/reliability.
- Native `pnpm --config.verify-deps-before-run=false verify` passes, with any
  sandbox-only loopback/IPC limitations recorded.

## Review Plan

After the implementation sub-agent reports completion, run five separate
reviewer sub-agents:

- code style/maintainability;
- documentation completeness;
- TypeScript/API docs;
- security;
- performance/reliability.

Feed every finding back to an implementation/fix sub-agent and repeat review
rounds until all lanes are clean. Close every participating sub-agent after its
result is recorded.
