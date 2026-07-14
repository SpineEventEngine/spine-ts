# T-0038b: Context Transport Composition

Status: Slice 1 reliability rereview assigned

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

## Slice 1 Implementer Handback

- Actual implementer profile: `gpt-5.6-terra` / `medium`; no subagents were
  dispatched or used.
- Canonical skill applicability was performed before implementation. Applied:
  `tdd`, `test-driven-development`, `implement`, `error-handling-patterns`,
  `javascript-testing-patterns`, `nodejs-backend-patterns`, and
  `verification-before-completion`. TDD and its test/mocking/refactoring
  references governed the focused RED/GREEN cycles; JavaScript testing guided
  the real bounded-context plus boundary-transport fixture; error handling and
  Node guidance confirmed existing binding validation/async close ownership;
  verification governed the fresh focused evidence. No new public/API,
  HTTP/backend, custom error, or retry policy is needed.
- Rechecked the accepted JVM evidence named by the parent plan:
  `IntegrationBroker.java`, `BoundedContext.java`, `ServerEnvironment.java`,
  and `Server.java`, plus the local runtime/routing evidence. The accepted
  impact remains one internal context-to-transport composition: context buses
  receive intake, the environment/Server retain delivery and lifecycle
  ownership. The recorded source checkout was not available at its historical
  `/private/tmp/spine-research/core-jvm` location in this worktree session, so
  the accepted plan and local JVM evidence remain the durable source record.
- Added package-internal `ContextTransport` and context route extraction in
  `packages/server/src/runtime/`; neither is exported from the server root.
  It derives one command responder per actual context command type and one
  event subscriber per actual context event type, using the existing transport
  topic/subscription rules and `RuntimeTransportBinding` validation, gate,
  runtime queue, registration cleanup, and handle. Framework callbacks post to
  the owning context endpoints. A single event intake route prevents
  per-receiver duplicate event-bus posts; the existing bus then fans out.
- RED/GREEN evidence: the first focused test failed because
  `context-transport.js` was absent, then passed for accepted command posting.
  The event fan-out test failed with no event registration, then passed after
  restoring one event intake route per accepted type. Additional focused tests
  prove malformed/type-URL-invalid command refusal before bus work, empty
  context zero registrations, and close draining accepted context work without
  closing the supplied transport.
- Slice 1 changes only internal runtime source and its focused test. It does
  not edit `server.ts`, listener/RunningServer lifecycle tests, public docs,
  examples, Protobuf/manifests, generated tracked output, or Git state.
- Fresh focused evidence: context/routing/command-event bus suite passed
  `63/63`; native IPC-backed `runtime-transport.test.ts` passed `13/13` after
  the sandbox denied local socket creation and the required native run was
  approved; generated build typecheck, scoped ESLint, cleanup enforcement,
  exact Prettier, generated-clean, public-root leak scan, and `git diff --check`
  passed.
- Remaining uncertainty and Slice 2 handback: `Server.start()` has not yet
  opened these handles, so server ordering, partial-open/close retry, shared
  transport behavior, and cross-process proof remain strictly Slice 2/3 work.

## Slice 1 Pre-Review Correction

- Coordinator inspection accepted one bounded correction batch before review.
  The original implementer was closed after handback and is resumed with the
  same explicit `gpt-5.6-terra` / `medium` profile; no subagents are allowed.
- Replace direct context-bus sentinel posts in success tests with
  `RuntimeTransportBindingHandle.close()` as the actual accepted-work drain,
  then assert only the transport-originated command/event observations.
- Add malformed event-envelope/type-URL refusal evidence so neither context bus
  can be reached by an invalid accepted-route envelope.
- Scope event fan-out subscriber identity to the owning context using a stable,
  logical-ID-safe, collision-free encoding of the context name. Command
  responder identity remains shared so duplicate command ownership still fails
  deterministically in Slice 2.
- Extend the recording transport to preserve multiple subscribers per topic and
  prove two contexts accepting the same event type obtain distinct descriptors
  and each receive one post. Do not begin server lifecycle work.

## Slice 1 Corrected Implementer Handback

- Resumed existing implementer dispatch and immutable runtime metadata both
  confirm `gpt-5.6-terra` / `medium`; no subagents were dispatched or used.
- Re-applied `receiving-code-review`, `test-driven-development`, `tdd`, and
  `verification-before-completion`, including the TDD testing, mocking,
  refactoring, and anti-pattern references. The correction preserved real
  bounded contexts/buses and kept the recording transport at the adapter
  boundary without adding test-only production access.
- Command/event success tests now close the returned `ContextTransport` handle
  immediately after transport intake and assert only transport-originated
  observations. The close barrier is therefore the proof that accepted binding
  callbacks and context-bus work drain; no direct sentinel bus work remains.
- Added malformed event proof for both a missing message and a mismatched type
  URL. Both reject as `RuntimeTransportEnvelopeError`, the handle remains
  closeable, and the matching `EventBus` dispatcher receives nothing.
- RED: two valid Unicode/punctuation context names accepting one event type
  produced one distinct descriptor instead of two. After the recording
  transport retained every registration and published to all handlers, the
  test remained RED on the same descriptor collision. GREEN: event subscriber
  IDs now include a fixed letter-bearing prefix plus deterministic base64url
  UTF-8 context-name encoding and route ordinal. Both contexts receive the
  event exactly once and descriptor keys differ. `command-worker-1` remains
  intentionally shared for deterministic competing command ownership.
- `RecordingSignalTransport` now stores a set of registrations per routing key,
  publishes to a snapshot of every matching handler, and each idempotent handle
  close removes only its own registration and removes the key only when empty.
- Corrected focused evidence: context/routing/command-event bus suites passed
  `65/65`; native IPC-backed runtime transport passed `13/13`; generated build
  typecheck, scoped ESLint, cleanup enforcement, exact Prettier,
  generated-clean, public-root leak scan, and `git diff --check` passed.
- Scope and uncertainty are unchanged: no lifecycle, root export, public docs,
  example, Protobuf, or generated tracked output changed. `Server.start()`
  ownership, partial failure/retry, shared transport lifecycle, and
  cross-process proof remain Slice 2/3 and were not started.

## Slice 1 Coordinator Verification

- Fresh coordinator runs passed four focused files and `65/65` tests, plus the
  native ZeroMQ runtime-transport regression at `13/13`.
- Generated build typecheck, scoped ESLint, exact Prettier, cleanup enforcement,
  canonical package-script generated-clean, public-root leak scan,
  `git diff --check`, and expected-path status inspection passed. A direct Node
  invocation of the generated-clean script lacked pnpm's plugin `PATH`; the
  canonical `pnpm proto:check-generated` invocation passed.
- Pre-review docs/status lint is clean: all three status mirrors agree; no stale
  active claim, duplicate policy owner, public root leak, public-doc overclaim,
  generated output, or unrelated current file is present. Documentation remains
  N/A for this internal slice; security remains deferred to T-0041.

## Slice 1 Review Assignment

- Immutable implementation endpoint: `b2a6e7e1`.
- Package: `.superpowers/sdd/review-ae8f0f09..b2a6e7e1.diff` from frame commit
  `ae8f0f09`; one commit and 46,562 bytes.
- Assigned relevant existing roles with explicit immutable profiles and no
  subagents: style/maintainability `gpt-5.6-terra` / high; TypeScript/API docs
  `gpt-5.6-terra` / high; performance/reliability `gpt-5.6-terra` / high.
- Documentation remains N/A because the slice changes no public or observable
  documentation. Security remains deferred to T-0041.

## Slice 1 Review Wave Result

- Style/maintainability and TypeScript/API docs returned clean. Actual immutable
  role metadata matched explicit dispatch at `gpt-5.6-terra` / high; both used
  no subagents and were closed.
- Performance/reliability returned two accepted findings at actual immutable
  `gpt-5.6-terra` / high, no subagents, then was closed.
- P1: partial binding open followed by cleanup failure masks the primary
  registration error and loses the only retryable close capability. Preserve
  primary-first failure order and retain an internal, non-root cleanup
  capability that Slice 2 server lifecycle can checkpoint and retry.
- P2: the focused recording responder keeps command intake after handle close.
  Make responder close remove only its registration idempotently and prove
  command and event intake cannot reach retired registrations.
- The same implementer is resumed for this complete bounded batch at explicit
  `gpt-5.6-terra` / medium, no subagents. Public root exports and Slice 2 server
  lifecycle remain unchanged in this fix.

## Slice 1 Reliability Fix Handback

- Existing implementer dispatch and actual immutable runtime metadata both
  remain `gpt-5.6-terra` / `medium`; no subagents were dispatched or used.
  Re-applied `receiving-code-review`, `test-driven-development`, `tdd` with its
  required testing/mocking/refactoring/anti-pattern references, and
  `verification-before-completion`. The accepted architecture and public
  `RuntimeTransportBinding` contract were preserved; no retry timing or server
  lifecycle policy was introduced.
- P1 RED first expected primary-first `AggregateError` diagnostics but received
  only `test command handle close failed`, proving cleanup masked the event
  registration failure. GREEN creates one retryable binding handle before
  cleanup, reports `[registrationError, closeError]` in that order when cleanup
  also fails, and retains the handle in weak package-internal access exposed to
  `ContextTransport` without a root export.
- The strengthened ownership RED then showed a second open resolving before
  cleanup. GREEN makes the fake transport retain the successful command owner:
  an open before cleanup retry fails with the exact duplicate-owner error;
  retrying retained cleanup closes that exact owner successfully; only then
  does a later open register and close normally. This proves ownership release,
  not merely registration call counts.
- P2 RED showed post-close command intake still reaching the retired responder
  and returning `RUNTIME_NOT_ACCEPTING` instead of finding no responder. GREEN
  gives `RecordingSignalTransport.respond()` an idempotent exact-registration
  close. Post-close command and event publication now reject before retired
  handlers run. Closing the first same-key event registration leaves its sibling
  live for one additional event; after sibling close, publication also rejects.
- Changed paths are
  `packages/server/src/runtime/runtime-transport.ts`,
  `packages/server/src/runtime/context-transport.ts`,
  `packages/server/test/runtime/runtime-transport.test.ts`, and
  `packages/server/test/runtime/context-transport.test.ts`, plus the three
  durable T-0038b records. `server.ts`, lifecycle tests, root exports, public
  docs, examples, Protobuf/manifests, generated tracked output, and Slice 2/3
  remain untouched.
- Fresh correction evidence: focused context/routing/command-event bus tests
  passed `65/65`; native ZeroMQ runtime transport passed `14/14`; generated
  build typecheck, scoped ESLint, cleanup enforcement, exact Prettier,
  canonical generated-clean, public-root leak, and diff/status checks passed.
- Remaining uncertainty is intentionally downstream: Slice 2 must consume the
  internal failed-open cleanup checkpoint in real `Server` startup/close retry
  sequencing and prove shared-transport ownership. Slice 3 still owns the real
  cross-process fixture and observable docs. Neither slice was started.

## Slice 1 Fix Coordinator Verification

- Fresh coordinator runs passed four focused context/routing/bus files and
  `65/65` tests, plus the native ZeroMQ runtime-transport file at `14/14`.
- Generated build typecheck, scoped ESLint, exact Prettier, cleanup enforcement,
  canonical generated-clean, public-root leak, expected-path status, and
  `git diff --check` passed.
- Coordinator inspection confirmed primary-first combined diagnostics, retained
  weak internal cleanup ownership, duplicate-open refusal before cleanup,
  successful reopen after cleanup, exact responder removal, sibling event
  preservation, and no root/public/server-lifecycle change.

## Slice 1 Reliability Rereview Assignment

- Corrected endpoint `a69ae867`; package
  `.superpowers/sdd/review-b2a6e7e1..a69ae867.diff` from prior implementation
  endpoint `b2a6e7e1`, three commits and 40,183 bytes.
- Assigned only the affected existing performance/reliability reviewer at
  explicit expected `gpt-5.6-terra` / high, no subagents. Earlier clean style
  and TypeScript/API results remain applicable; documentation is N/A and
  security remains deferred.
