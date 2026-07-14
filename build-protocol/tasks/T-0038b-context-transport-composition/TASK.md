# T-0038b: Context Transport Composition

Status: Slice 1 framed; implementation assigned

Started: `2026-07-14T02:27:17Z`

Baseline commit: `1a682b0c`

Branch: `task/T-0038b-context-transport-composition`

Worktree: `.worktrees/T-0038b-context-transport-composition`

Parent: T-0038 accepted audit; accepted plan commit `9addd3b0`.

Dependency: T-0038a complete, merged, post-merge verified, and pushed.

This `Status` header is canonical for T-0038b. Work/review mirrors must agree.

## Objective

Make `Server`-assembled bounded contexts use `ServerEnvironment.transport` for
framework-owned same-host command/event intake that reaches existing context
buses and environment-owned delivery, with real cross-process proof and no
application callbacks or private imports.

## Human-Imposed Requirements Ledger

- Continue autonomously until this child is integrated or a real blocker occurs.
- Keep review packages small by implementing and reviewing the three accepted
  slices separately on this branch; one Terra Medium author retains context.
- Add no public root symbol. Public composition remains `Server`, added
  `BoundedContext`, and `ServerEnvironment.transport`.
- Reuse existing routing/topic rules, `RuntimeTransportBinding` validation and
  queueing, context command/event buses, environment attachment/delivery, and
  server lifecycle. Do not create a second runtime, broker, callback registry,
  delivery owner, or lifecycle abstraction.
- Accepted commands post once to the owning context `CommandBus`; accepted
  events post exactly once to one owning context `EventBus`, regardless of how
  many handlers/routes subscribe to that event type. The existing bus owns
  storage, fan-out, inbox writes, and delivery.
- `ServerEnvironment` remains the sole delivery generation/readiness owner.
  Context transport handles own registrations/intake work only and never close
  the shared transport, storage, context, or delivery facilities.
- Startup order: build contexts/resources; attach and finish recovery; open
  context transport registrations in deterministic context order; then listen.
- Close order: network intake/sessions; context transport intake/accepted-work
  drain; environment detach/delivery quiescence; contexts/resources; owned
  environment facilities.
- Partial open and close failures are retryable without duplicating successful
  registrations/phases. An unproven ingress close retains endpoint dependencies
  and prevents detach/teardown. Shared caller-owned transport and sibling routes
  remain usable; owned transport closes only with owned environment facilities.
- Duplicate command responder ownership fails startup deterministically and
  cleans only the failed server's partial ownership. Add no topology policy.
- Real child-process evidence must route generated command/event payload traffic
  through ZeroMQ only; Node process IPC is limited to readiness, bounded
  observations, and shutdown control. All waits and teardown are bounded.
- Preserve local/same-host scope. Exclude supervision, endpoint policy,
  distributed/multi-host transport, query/subscription/system/catch-up/import
  routing, retry timing policy, new Protobuf, public internals, and example edits.
- Preserve end-user API prohibitions and generated-output policy.
- For server work, the accepted plan records Spine JVM `IntegrationBroker`,
  `BoundedContext`, `ServerEnvironment`, and `Server` evidence. The smallest
  familiar concept is package-internal context-to-transport composition owned
  by existing server lifecycle; no public broker.
- Run focused inner checks and only relevant reviewers per slice. Full
  `pnpm verify` is reserved for clean final child acceptance and post-merge.
- No per-task security reviewer; carry private IPC directory, untrusted envelope,
  timeout, and process-cleanup evidence to T-0041.
- Explicit child model/reasoning and immutable runtime metadata are mandatory;
  subagents must not spawn subagents.
- Never read, modify, stage, or delete `human-review-1-jul.md`.

## Accepted Architecture Evidence

- JVM `BoundedContext` owns an internal `IntegrationBroker`; the broker obtains
  transport from `ServerEnvironment` and feeds external events into the context
  event bus. JVM `Server` keeps network lifecycle outside that broker.
- TypeScript already has adapter-neutral `SignalTransport`, routing plans,
  envelope validation, `RuntimeTransportBinding`, bounded-context buses,
  environment delivery attachment, and server startup/close retry machinery.
- The missing concept is one package-internal context transport composition
  carried by existing server lifecycle, not a new public subsystem.

## Slice 1: Internal Context Transport

### Outcome

Create the smallest package-internal adapter/access path that derives actual
accepted command/event transport routes from a built context and opens existing
transport binding machinery with framework callbacks into that context's buses.

### TDD Acceptance

- RED proves a built context currently has no framework-owned transport intake.
- Accepted command route posts exactly once to the owning `CommandBus`.
- Accepted event type posts exactly once to the owning `EventBus` even when the
  routing metadata contains multiple handler receiver routes for that type.
- Envelope/type-URL refusal occurs before either bus.
- Empty contexts open no registrations.
- No application callback registry/materialization or public symbol is added.
- Handle close stops registrations and drains accepted callback work without
  closing the supplied transport/context/delivery.

### Initial Ownership

- Package-internal context/runtime access and focused tests only, plus these
  records. No `Server.start()` lifecycle edit or public docs in Slice 1.
- Existing implementer: explicit `gpt-5.6-terra` / medium, no subagents.

### Focused Gates

- New focused context-transport test plus existing runtime transport/routing and
  command/event bus tests touched by the implementation.
- Generated build typecheck, scoped ESLint, cleanup/public-leak scans, exact
  Prettier, generated-clean, status/diff checks.
- Relevant style, TypeScript/API docs, and reliability review. Documentation is
  N/A unless observable/public docs change.

## Slice 2: Server Lifecycle Ownership

### Outcome

Carry context transport handles through `Server.start()` and
`RunningServer.close()` with the accepted startup/close/failure ordering.

### Required Evidence

- Registrations ready before listener; listener absent on open failure.
- Partial-open cleanup/retry; ingress close hard gate before detach; accepted
  callback drain before delivery quiescence.
- Shared caller-owned transport/sibling route reuse; owned environment transport
  closes only at established facility phase.
- Duplicate responder failure cleanup; idempotent/retryable close; completed
  phases not duplicated. Reuse T-0037f lifecycle fixture.

## Slice 3: Cross-Process Proof And Docs

### Outcome

Add one test-only child worker using real ZeroMQ and public composition; prove
command handling, emitted-event delivery/projection work, and one-post inbound
event behavior in the other process. Close with truthful observable docs.

### Fixture Rules

- Unique private absolute IPC directory and deterministic test adapter identity.
- Separate parent/child transports; readiness only after `Server.start()`.
- Bound transport requests near 2 seconds and process/eventual phases near 5
  seconds with phase-specific sanitized diagnostics.
- Pub/sub join uses bounded repeated publication of one fixed event identity;
  production code gains no sleep/retry policy.
- `finally` closes running server/environment/transport, awaits child exit,
  terminates only a stuck test child after grace, and removes IPC files.
- Fail on leaked child/listener/socket/files, duplicate observations, or timeout.

### Final Docs And Gates

- Public TSDoc and server/guide/architecture docs only where needed for
  observable same-host command/event execution and limitations. No example edit.
- Focused runtime/lifecycle/transport/native child-process suites, generated
  build, lint, cleanup, docs/API, format/diff, all relevant review concerns,
  then full verify.

## Skill Applicability Check

- Session inventory, expected-skill manifest, readable user skill entrypoints,
  and installed lock are available. Accepted Sol High plan completed the
  architecture/JVM guardrail and is not repeated.
- Implementer must perform its canonical check and read
  `test-driven-development` plus required references, `implement`,
  `nodejs-backend-patterns`, `error-handling-patterns`,
  `javascript-testing-patterns`, and `verification-before-completion` as each
  becomes applicable. Worktree/review workflow remains orchestrator-owned.

## Immediate Assignment

Implement Slice 1 only. Do not begin server lifecycle or cross-process/docs
work until Slice 1 focused verification and relevant review are clean.
