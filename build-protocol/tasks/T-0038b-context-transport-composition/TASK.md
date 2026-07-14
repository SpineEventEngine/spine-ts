# T-0038b: Context Transport Composition

Status: Slice 3 acknowledgment fix green; reliability rereview ready

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

## Slice 1 Clean Closure

- Reliability rereviewer returned CLEAN at actual immutable
  `gpt-5.6-terra` / high, no subagents, and was closed. Its focused runtime and
  context-transport run passed `21/21`, including native ZeroMQ IPC.
- Slice 1 is accepted at corrected endpoint `a69ae867`: all relevant lanes are
  clean, documentation is N/A, security is deferred, and coordinator gates are
  clean. No full verify is run until final T-0038b closure.

## Slice 2 Implementation Assignment

- Resume the same existing implementer at explicit `gpt-5.6-terra` / medium,
  no subagents. Own server lifecycle composition and focused lifecycle tests
  only; do not begin Slice 3 cross-process/docs work.
- Open context transport registrations in deterministic built-context order
  after attachment/startup recovery and before listener creation/intake.
- Track every successful handle and any retained failed-open cleanup. A partial
  open failure must preserve primary-first diagnostics, close/retry only owned
  partial registrations, and gate detach/context/resource cleanup until intake
  cleanup succeeds.
- Running and failed-listener close order is network, context transport intake
  close plus accepted-work drain, environment detach/quiescence, then
  contexts/resources/owned environment. Retry only unfinished phases; shared
  caller-owned transport and sibling server routes remain usable.
- Prove listener absence on registration failure, deterministic duplicate
  command responder failure, partial-open cleanup/retry, ingress-close hard
  gate, successful phase non-repetition, shared transport sibling behavior, and
  existing T-0037f lifecycle compatibility. Add no public root symbol or new
  lifecycle policy owner.

## Slice 2 Implementer Handback

- Existing implementer dispatch and actual immutable runtime metadata match at
  `gpt-5.6-terra` / `medium`; no subagents were dispatched or used. Canonical
  applicability/readings completed before production work: `executing-plans`,
  `using-git-worktrees` (confirmed this existing linked worktree), `implement`,
  `test-driven-development`, `tdd` and its testing/mocking/refactoring and
  anti-pattern references, `error-handling-patterns`,
  `javascript-testing-patterns`, `nodejs-backend-patterns`, and
  `verification-before-completion`. User constraints superseded skill defaults
  that would commit, spawn subagents, or perform orchestrator-owned review.
- Added package-internal `ContextTransportGroup` under `src/server/`. It opens
  contexts sequentially with the environment transport, retains every
  successful binding plus `contextTransportAccess.failedOpenCleanup(error)`,
  and delegates retry indexing/error flattening to existing
  `RetryableCloseGroup`. It is not exported from the package root and does not
  own transport, context, storage, delivery, or listener lifecycle.
- `Server.start()` now opens that group after context build and successful
  environment attachment/recovery, before `SpineServices`, HTTP/2 server
  creation, or listener open. Registration failure creates the existing
  failed-start checkpoint, attempts only this server's intake cleanup, and
  hard-gates detach/dependency cleanup behind successful intake close.
  Primary-first diagnostics flatten the registration failure before immediate
  binding cleanup and server retry-cleanup failures in stable order.
- Running and failed-listener cleanup now order network/session close, context
  transport registration close plus accepted-work drain, environment
  detach/quiescence, contexts/resources, then an owned environment's existing
  facility order. Successful network, registration, detach, and dependency
  indexes are not repeated. Caller-owned transport stays open; one shared
  server close removes only its registrations; an owned transport closes once
  through `ServerEnvironment.close()` after contexts/resources.
- Strict TDD evidence: initial ordering RED observed recovery followed directly
  by listener creation with no subscriptions; running-close RED resolved without
  attempting intake close; partial-open RED reported only registration plus the
  first handle-close failure and omitted the server cleanup failure;
  failed-listener RED recorded zero registration closes; duplicate-owner RED
  returned a second `RunningServer`. Each corresponding GREEN proves the
  accepted order, hard gate/retry, retained cleanup-only terminal semantics,
  listener absence, and deterministic duplicate refusal while the original
  server remains connectable.
- Focused behavior also proves accepted transport work blocks detach until its
  callback drains; partial cleanup retries only the failed command handle and
  not the successfully closed prior-context event handle; same-event sibling
  routes survive one server close; the real local transport rejects duplicate
  command ownership; and a fresh server can acquire that route after the owner
  closes.
- Changed paths are `packages/server/src/server/server.ts`, new internal
  `packages/server/src/server/context-transport-group.ts`, focused
  `packages/server/test/server/server-context-transport-lifecycle.test.ts`,
  reused `packages/server/test/server/server-lifecycle-fixture.ts`, and these
  three durable records. Public `Server`/`RunningServer` signatures are
  unchanged; their existing TSDoc received only the required truthful ordering
  correction. No root export/options, external docs, examples, Protobuf,
  generated tracked output, topology/retry policy, or Slice 3 fixture was added.
- Verification evidence: clean pre-change focused baseline `83/83`; final
  focused server lifecycle `70/70`; context/routing/command-event bus `65/65`;
  native ZeroMQ runtime transport `14/14`; generated build typecheck; scoped
  ESLint; cleanup enforcement; exact Prettier; TypeDoc generation; canonical
  generated-clean; root-leak scan; and diff/status checks passed. No full
  `pnpm verify` was run, as reserved for final T-0038b closure.
- Remaining uncertainty is Slice 3 only: no real child-process ZeroMQ proof or
  observable external documentation has been implemented. Security remains
  deferred to T-0041 under the accepted plan.

## Slice 2 Coordinator Verification

- Initial sandboxed lifecycle run was denied loopback listen permission and
  cascaded; the required native rerun passed three files and `70/70` tests.
- Fresh coordinator runs also passed context/routing/bus `65/65`, native runtime
  transport `14/14`, generated build typecheck, scoped ESLint, exact Prettier,
  cleanup, `docs:check` with 205 expected server exports, canonical
  generated-clean, root-leak inspection, expected-path status, and
  `git diff --check`.
- Pre-review lint is clean: status mirrors agree; no stale active claim,
  duplicated lifecycle policy, root/internal leak, future-policy doc claim,
  generated output, or unrelated path is present. The changed public TSDoc is
  observable and makes documentation review relevant for this slice.

## Slice 2 Review Assignment

- Immutable endpoint `d4debde8`; package
  `.superpowers/sdd/review-ebdf959f..d4debde8.diff` from clean Slice 1 closure
  `ebdf959f`, one commit and 67,201 bytes.
- Assigned existing roles with explicit immutable profiles and no subagents:
  style/maintainability `gpt-5.6-terra` / high; documentation
  `gpt-5.6-luna` / medium; TypeScript/API docs `gpt-5.6-terra` / high; and
  performance/reliability `gpt-5.6-terra` / high. Security remains deferred.

## Slice 2 Review Wave Result

- TypeScript/API docs and performance/reliability returned CLEAN at actual
  immutable `gpt-5.6-terra` / high, no subagents, and were closed.
- Style/maintainability returned P2 at actual immutable
  `gpt-5.6-terra` / high: centralize the repeated context-intake, detach,
  rollback, and owned-close failed-start checkpoint sequence so its ordering
  and terminal-state policy have one owner.
- Documentation returned P2 at actual immutable `gpt-5.6-luna` / medium:
  `Server.start()` TSDoc must state deterministic built-context registration
  order and listener absence until all registrations succeed.
- Both finding reviewers used no subagents and were closed. Resume the same
  implementer at explicit `gpt-5.6-terra` / medium, no subagents, for this
  complete batch; retain all accepted behavior and Slice 3 boundary.

## Slice 2 P2 Correction Handback

- Existing implementer actual immutable role metadata matches the explicit
  `gpt-5.6-terra` / `medium` assignment; no subagents were dispatched or used.
  Before editing, the implementer fully read and applied
  `receiving-code-review`, both canonical TDD skills and their required testing,
  mocking, refactoring, and anti-pattern references, and
  `verification-before-completion`. The accepted review findings were verified
  against the committed implementation before changes.
- Refactor safety used the existing three-file native lifecycle gate as the
  pre-edit GREEN baseline (`70/70`). No structure-coupled test was added: those
  tests already exercise registration-start failure, listener-start failure,
  cleanup-only retry, intake and detach hard gates, retry-only-unfinished state,
  primary-first and flattened diagnostics, and empty-aggregate behavior.
- `Server.#advanceFailedStartCleanup()` is now the single internal owner of the
  post-network context-intake close, attachment detach or failed-start rollback,
  owned close-group advance, and terminal cleanup-state update. The three callers
  retain their own network gate where applicable and their existing context,
  listener, or cleanup-only error wording and aggregation. `ContextTransportGroup`
  was not broadened and no second lifecycle owner was introduced.
- Public `Server.start()` TSDoc now states that built contexts register
  sequentially in deterministic input order after recovery, every registration
  must succeed before HTTP server creation or listener open, and registration
  failure opens no listener. `RunningServer`, root exports, and public signatures
  are unchanged.
- Changed implementation scope is only
  `packages/server/src/server/server.ts`, plus these three durable records.
  Verification evidence is recorded after the final checks below. Slice 3,
  external docs, examples, Protobuf contracts, and generated tracked output were
  not changed.
- Remaining uncertainty is unchanged and belongs to Slice 3: real child-process
  ZeroMQ traffic, bounded child-process teardown/timeouts, observable external
  documentation, and final all-slice verification. Security remains deferred to
  T-0041.
- Fresh correction gates passed: native server lifecycle before and after the
  refactor `70/70`; focused context/routing/command-event buses `65/65`; native
  runtime transport `14/14`; generated build typecheck; scoped server ESLint;
  cleanup enforcement; exact changed-file Prettier; `docs:check` with 205
  expected server exports; canonical generated-clean; public root/declaration
  leak scan; `git diff --check`; and expected-path status/diff inspection. No
  full verify was run and no commit was created.

## Slice 2 P2 Coordinator Verification

- Fresh native lifecycle rerun passed three files and `70/70` tests after the
  centralization. Generated build typecheck, scoped ESLint, exact Prettier,
  cleanup, `docs:check` with 205 expected server exports, canonical
  generated-clean, root/status inspection, and `git diff --check` also passed.
- Inspection confirms one private phase-advancement owner, caller-specific
  network/error framing, deterministic-order public TSDoc, and no behavior or
  public-surface expansion.

## Slice 2 P2 Rereview Assignment

- Corrected endpoint `adefe8c8`; package
  `.superpowers/sdd/review-d4debde8..adefe8c8.diff` from prior endpoint
  `d4debde8`, three commits and 25,092 bytes.
- Assigned only affected existing roles: style/maintainability at explicit
  `gpt-5.6-terra` / high and documentation at explicit `gpt-5.6-luna` / medium,
  both no subagents. Prior API/reliability clean results remain applicable.

## Slice 2 Clean Closure

- Style and documentation rereviewers returned CLEAN at matching actual
  immutable profiles (`gpt-5.6-terra` / high and `gpt-5.6-luna` / medium), used
  no subagents, and were closed.
- Slice 2 all-concern disposition is clean at corrected endpoint `adefe8c8`:
  style CLEAN; documentation CLEAN; TypeScript/API CLEAN; reliability CLEAN;
  security deferred. No full verify is run until final child closure.

## Slice 3 Implementation Assignment

- Resume the same existing implementer at explicit `gpt-5.6-terra` / medium,
  no subagents. Own only the native cross-process fixture, truthful observable
  docs, final child gates, and these records.
- Spawn a real Node child using built public package entry points, a separate
  ZeroMQ transport, and a unique private absolute IPC directory. Node IPC is
  limited to readiness after `Server.start()`, bounded observations, errors,
  and shutdown control; generated command/event payload traffic uses ZeroMQ.
- Prove remote command handling, its emitted-event projection/delivery work,
  and exactly one child context-bus post for one inbound event identity. Use
  public framework composition and no `packages/**/src` private imports or
  application callback/materialization seam.
- Bound request/receive near 2 seconds and process/eventual phases near 5
  seconds with sanitized phase diagnostics. Handle pub/sub join through bounded
  repeated publication of one fixed event identity, not production retry policy.
- `finally` must close server/environment/transports, request child shutdown,
  await exit, terminate only a stuck child after grace, remove IPC files, and
  fail on leaked child/listener/socket/files or duplicate observation.
- Update only observable server/package guide/architecture wording needed to
  state implemented same-host command/event execution and limitations. Do not
  edit the to-do example, add topology/supervision/distributed claims, or expose
  internals. Finish with all-slice focused gates and final `pnpm verify`.

## Slice 3 Implementation Handback

- Existing implementer actual immutable role metadata is
  `gpt-5.6-terra` / `medium`, matching the explicit assignment; no subagents
  were dispatched or used. Canonical applicability was recorded before edits.
  The implementer fully read and applied `implement`, `executing-plans`,
  `using-git-worktrees`, both canonical TDD skills and their required testing,
  mocking, refactoring, and anti-pattern references,
  `javascript-testing-patterns`, `nodejs-backend-patterns`,
  `error-handling-patterns`, and `verification-before-completion`.
  `systematic-debugging` was fully read and applied when the final GREEN
  candidate exposed a concrete projection-delivery blocker.
- Strict TDD proceeded in three vertical increments. The first valid RED
  launched the parent fixture and failed readiness because the plain Node child
  module did not exist; GREEN added the `.mjs` child, public package imports,
  `Server.start()`-before-ready handshake, one parent command request, and
  bounded `finally` teardown. The second RED timed out waiting for command
  handling/projection observations; GREEN added a real aggregate command
  handler that emits a generated event plus a persisted projection. The final
  RED timed out waiting for two inbound-event projection observations. A
  diagnostic run showed repeated delivery of the prior command event; the
  public transition validator proved the initially selected
  `RichSetOnceState` fixture always rejects because repeated set-once fields are
  unsupported. Replacing only that audit state with validated
  `SingularSetOnceState` produced the final GREEN (`1/1`). Collection/type
  harness defects (`.mjs` parent exclusion and one missing parent schema binding)
  were corrected and rerun before accepting behavioral RED evidence.
- `server-context-transport-child.mjs` is a real Node child using built public
  entry points from `@spine-ts/server`, `@spine-ts/core`, `@spine-ts/proto`,
  `@spine-ts/storage`, and `@spine-ts/transport/zeromq`, plus the existing local
  descriptor test fixture; it has no `packages/**/src` import and adds no public
  callback/materialization seam. Parent and child create distinct ZeroMQ
  transports over one unique mode-`0700` absolute temporary IPC directory and
  deterministic adapter identity. Generated command/event envelopes cross only
  ZeroMQ. Node IPC carries only bounded readiness, sanitized failure,
  behavior/entity observation, stopped, and shutdown messages.
- The proof observes one transported command accepted and handled by the child,
  its generated event persisted by a real projection and delivered to a second
  projection, and one fixed parent event identity delivered exactly once to
  each projection despite bounded slow-join republication. Request/publish work
  is bounded at two seconds; readiness, observation, and exit phases are bounded
  at five seconds. Cleanup closes the parent transport, requests shutdown,
  closes child `RunningServer`, caller-owned environment, then child transport,
  awaits exit, terminates only after grace, verifies the listener is closed,
  recursively removes the IPC directory, and verifies its absence. Duplicate
  observations, background failures, non-zero exit, forced termination, and
  retained listener/files fail the test.
- Observable wording changed only in `packages/server/README.md`,
  `docs/USER_GUIDE.md`, and `docs/architecture/README.md`. It states current
  deterministic pre-listener context intake, command/event bus and projection
  behavior, close ordering, the native public child proof, and trusted
  same-host-only limitations. No example, root export, public signature,
  production source, Protobuf contract, generated tracked output, remote
  topology, supervision, or retry policy changed.
- Focused native verification passed 12 files and `167/167` tests covering all
  Slice 1/2 server lifecycle, context/runtime/routing/bus regressions, the new
  child proof, and all ZeroMQ adapter tests. Generated build and tooling
  typechecks, scoped ESLint, cleanup enforcement, exact changed-file Prettier,
  `docs:check` with 205 expected server exports, canonical
  `pnpm proto:check-generated`, public-root/declaration/private-import and
  protected-path scans, `git diff --check`, and expected-path status/diff all
  passed. The first final verify attempt correctly failed tooling typecheck on a
  missing third generic in the owned Slice 1 test and lost narrowing in the new
  test; both type-only defects were fixed and the tooling gate reran green.
  Final native `pnpm --config.verify-deps-before-run=false verify` then passed:
  71 files and `1627/1627` tests in both ordinary and coverage runs, 95.37%
  statements, 90.15% branches, 98.13% functions, 95.4% lines, docs/API, proto
  lint, and generated-clean.
- Implementation paths are
  `packages/server/test/server/server-context-transport-cross-process.test.ts`,
  `packages/server/test/server/server-context-transport-child.mjs`, the
  type-only generic correction in
  `packages/server/test/runtime/context-transport.test.ts`, the three observable
  docs above, and these three durable records. No commit was created.
- Remaining uncertainty is intentionally bounded to trusted same-host Node/V8
  IPC and local timing. Remote/multi-host transport, broker topology,
  supervision, production retry policy, deployment hardening, and final
  security review remain out of scope; security evidence carries to T-0041.
  Parent T-0038 closure, review acceptance, merge, and push have not begun.

## Slice 3 Coordinator Pre-Review Correction

- Fresh coordinator native run passed the new child-process proof `1/1`.
- Accepted teardown finding: cleanup removes the IPC directory recursively
  without first proving it contains no retained socket/file entry. Inspect
  entries after transports/child exit, record any count as a leak failure, then
  remove the directory in all cases.
- Accepted setup finding: a failure after `mkdtemp` but before fixture
  construction can bypass test `finally` and leak the parent transport, child,
  or directory. Make fixture creation failure-safe with bounded cleanup and
  primary-first combined diagnostics.
- Resume the same implementer at explicit `gpt-5.6-terra` / medium, no
  subagents. Change only the cross-process harness and these records.

### Correction implementation and native boundary finding

- The existing implementer ran at the immutable assigned profile
  `gpt-5.6-terra` / medium. No subagent was dispatched. Canonical skill
  applicability was rechecked before correction: receiving-code-review and
  strict TDD governed the accepted finding batch; JavaScript testing and error
  handling patterns governed fault injection, bounded cleanup, and
  primary-first diagnostics; systematic debugging governed the unexpected
  native teardown RED; verification-before-completion prevents a clean handback
  while that RED remains.
- `CrossProcessFixture.create()` now owns every resource created after
  `mkdtemp()` until fixture construction succeeds. A setup rejection closes an
  available parent transport, requests bounded child shutdown and escalates to
  termination when necessary, recursively removes the IPC directory, confirms
  `ENOENT`, and rethrows the original setup error first with sanitized cleanup
  failures following it. The setup and normal teardown paths share child-exit
  and directory-removal helpers instead of duplicating the complete close state
  machine.
- Normal teardown now inspects the IPC directory only after the parent
  transport is closed and the child has completed its own server/environment/
  transport shutdown and exited. A retained count is recorded as a cleanup
  failure; recursive removal and the final `ENOENT` check still run.
- Strict TDD evidence: the setup fault-injection test first failed because the
  injected setup error escaped without cleanup aggregation, then passed after
  the ownership boundary was implemented. The retained-entry test first failed
  because the inspection helper did not exist, then passed after implementation
  and proves both leak reporting and unconditional removal. The focused file now
  reports `2/3` passing: both correction tests pass, while the real cross-process
  proof correctly fails with `Cross-process IPC directory retained 2 entries
after child and transports closed.`
- Systematic native diagnosis showed this is not a timing race: a minimal
  `zeromq@6.5.0` publisher bind/close retained its IPC pathname at 0, 10, 100,
  500, and 1000 ms, and explicit `unbind()` also retained the pathname. Current
  `ZeroMqSignalTransport.close()` closes native sockets but does not unlink its
  deterministic bound endpoint files. Therefore the accepted leak assertion
  cannot pass honestly within the committed restriction to change only the
  cross-process harness and records; deleting endpoint files in the fixture
  before inspection would hide the exact leak the finding requires it to
  detect. A coordinator decision is required to permit the smallest transport
  adapter ownership fix or to redefine the retained-endpoint expectation.
- Green non-native gates at this boundary: generated build plus tooling
  typecheck; scoped ESLint; cleanup enforcement; exact Prettier; `docs:check`
  with 205 server exports; and canonical generated-clean. The final full verify
  was intentionally not rerun. Diff/status, private-import, public-root, and
  protected-scope scans passed. Correction-owned paths are the cross-process
  fixture test and these three records only. Slice 3 status is `NEEDS_CONTEXT`;
  no docs, production, Slice 1/2, commit, or parent T-0038 closure work was
  added by this correction.

## Slice 3 Adapter Cleanup Authorization

- Coordinator accepts the native root-cause evidence and keeps the retained
  endpoint criterion unchanged.
- Authorize the smallest production correction in
  `packages/transport/src/zeromq/signal-transport.ts`: track only IPC paths this
  transport successfully binds, close sockets, unlink owned paths on handle or
  transport close, ignore `ENOENT`, attempt all cleanup, and retain failed
  unlink ownership for close retry. Never unlink connect-only subscriber or
  requester paths and add no public API.
- Add focused publisher/replier endpoint cleanup and retry regressions in the
  existing ZeroMQ transport test, then rerun the corrected cross-process proof.
  This scope expansion is coordinator-authorized as the mandatory seam required
  by the accepted no-socket-file-leak criterion.
- Resume the same implementer at explicit `gpt-5.6-terra` / medium, no
  subagents. Docs, server lifecycle, examples, topology, and retry timing policy
  remain unchanged.

## Slice 3 Adapter Cleanup Implementation

- Actual immutable execution metadata remained the existing implementer at
  explicit `gpt-5.6-terra` / medium reasoning. No subagent was dispatched or
  used. Canonical skill applicability was recorded before implementation:
  receiving-code-review validated the authorized owner and scope; TDD plus its
  required test/mocking/refactoring references governed vertical RED/GREEN;
  JavaScript testing patterns governed native Vitest fault injection;
  error-handling patterns governed stable aggregation and retained retry
  ownership; verification-before-completion governed the final evidence. The
  Node backend skill was N/A because this correction changes no server or HTTP
  behavior.
- The authorized production correction is in
  `packages/transport/src/zeromq/signal-transport.ts` with the package-internal,
  non-root filesystem boundary
  `packages/transport/src/zeromq/endpoint-files.ts`. Only successfully bound
  Publisher and Reply paths are owned. Subscriber and Request sockets remain
  connect-only and own no filesystem path. Native socket close is recorded
  before pathname removal; `ENOENT` completes ownership, while another unlink
  failure retains only that pathname for a later close and never closes the
  native socket twice. Concurrent calls share each close attempt. Transport
  close attempts every active handle and publisher in stable insertion order,
  preserving exact single failures and stable aggregate ordering.
- A successful Publisher bind publishes cleanup ownership before any later
  closed-state setup failure. In-flight publisher and responder binds are
  awaited by close, so a close/setup race cannot lose a newly bound pathname.
  Publisher setup reports the original setup error first if immediate cleanup
  also fails. No public export, package export, callback, timing, topology, or
  retry-policy surface was added.
- Strict TDD evidence was observed, not inferred. Publisher cleanup RED left
  `se-p-...sock`; GREEN removed it after transport close. Replier cleanup RED
  left `sc-r-...sock`; GREEN removed it after registration close. The unlink
  retry RED left both owned paths after the first failure instead of attempting
  the publisher; GREEN left only the failed replier path, then removed it on
  retry. Existing connect-only non-ownership was separately characterized
  GREEN. Strengthened native cases cover two stable failures and retry,
  concurrent close promise identity, `ENOENT`, and a publisher bind/close race.
  The focused ZeroMQ file passes `18/18`.
- The corrected child-process proof passes `3/3`; its normal teardown observes
  an empty IPC directory after parent/child transport close and child exit,
  before recursive directory removal. The focused native transport/runtime/
  context/bus/server gate passes 13 files and `182/182` tests.
- Fresh non-full gates pass: generated build and tooling typechecks; scoped
  ESLint after one lint-only unnecessary-cast correction; cleanup enforcement;
  exact changed-file Prettier; `docs:check` with unchanged 17 transport and 205
  server exports; canonical generated-clean; no public-root/internal-helper
  leak; no child private-source import; no package-export, protected-path, or
  `human-review-1-jul.md` change; `git diff --check`; and expected status/diff.
  Full verify remains intentionally deferred until review. No docs, server
  lifecycle, example, Protobuf, topology, retry timing, commit, or parent T-0038
  closure work was added.
- Coordinator acceptance inspected the final ownership/retry state machine and
  reran the two native acceptance files together. ZeroMQ adapter and
  child-process teardown behavior passed `2` files and `21/21` tests, including
  pre-removal directory emptiness. `git diff --check` also passed. Slice 3 is
  accepted as an implementation endpoint and is ready for the complete
  specialist review wave.

## Slice 3 Pre-Review Lint Finding

- The required lightweight status/docs/API scan found no stale status, public
  export leak, internal-helper documentation, or future-policy overclaim. It
  did find that the parent and child process fixtures separately define the
  adapter identity and transport timeout even though those values form one
  cross-process test contract and must agree.
- The same implementer is resumed at its immutable explicit
  `gpt-5.6-terra` / medium profile, with no subagents, to pass the shared values
  through the child environment, validate them at the child boundary, rerun the
  native child-process proof, and update all three durable records. No
  production, public API, documentation, topology, or timing-policy change is
  authorized.

## Slice 3 Pre-Review Lint Correction

- Actual immutable execution metadata remained the existing implementer at
  explicit `gpt-5.6-terra` / medium reasoning. No subagent was dispatched or
  used. Receiving-review, TDD and its required references, JavaScript testing,
  error-handling, and verification-before-completion instructions were fully
  applied to this bounded correction.
- The parent fixture is now the single source for `adapterIdentity` and
  `transportTimeoutMs`. It passes canonical string values through
  `SPINE_T0038B_ADAPTER_IDENTITY` and
  `SPINE_T0038B_TRANSPORT_TIMEOUT_MS` alongside the existing IPC directory.
  The child contains no fallback/default copy. At process entry it requires all
  three values, rejects a non-normalized or syntax-invalid adapter identity,
  and accepts the timeout only as a canonical positive decimal safe integer.
  The effective values and timing remain unchanged.
- Strict TDD evidence is exact. Changing the parent-owned identity and passing
  both variables first produced the expected command request/reply timeout at
  2000 ms because the old child ignored the environment (`1` failed, `2`
  skipped); consuming the required values restored GREEN (`1` passed, `2`
  skipped). A malformed-identity boundary test initially exposed a too-long
  diagnostic fixture path; after correcting that test harness, the accepted
  RED reached child readiness instead of refusing surrounding whitespace (`1`
  failed, `3` skipped), then passed with strict identity validation. The
  timeout RED likewise reached readiness for `2e3` (`1` failed, `4` skipped),
  then passed with canonical decimal parsing.
- Fresh unrestricted native result is one file and `5/5` tests after the
  restricted sandbox refused the fixture's IPC bind with `Operation not
permitted`: same-host command/event
  behavior, both boundary refusals, setup-failure cleanup, and pre-removal IPC
  leak detection. Tooling typecheck, scoped ESLint for both fixtures, and exact
  fixture Prettier pass. Exact record formatting, duplicate/private-path and
  protected-path scans, `git diff --check`, and expected five-path status/diff
  also pass. Correction paths are only
  `packages/server/test/server/server-context-transport-cross-process.test.ts`,
  `packages/server/test/server/server-context-transport-child.mjs`, and these
  three durable records. Endpoint cleanup, docs, production, server lifecycle,
  public API, examples, Protobuf, topology, and unrelated work are preserved;
  no commit was created.
- Coordinator inspection confirmed the child has no fallback copy and validates
  both parent-owned values before transport construction. The independent
  unrestricted native rerun passed the complete child-process file with `5/5`
  tests. The pre-review finding is accepted as resolved.

## Slice 3 Specialist Review Assignment

- Review baseline is clean Slice 2 endpoint `1b19e7a2`; Slice 3 implementation
  endpoint is `b031fe84`. The immutable package is
  `.superpowers/sdd/review-1b19e7a2..b031fe84.diff` (`5` commits, `139514`
  bytes).
- Existing role dispatches are explicit: style/maintainability at
  `gpt-5.6-terra` / high, documentation at `gpt-5.6-luna` / medium,
  TypeScript/API docs at `gpt-5.6-terra` / high, and
  performance/reliability at `gpt-5.6-terra` / high. Each reviewer is
  read-only, bounded to Slice 3, and may not spawn subagents.
- Every prompt requires the canonical skill applicability check and directs
  reviewers to ignore historical or superseded text unless the current task,
  work/review logs, or changed active documentation claims it as current.
  Security remains deferred to T-0041.
- The first documentation response is not accepted despite a CLEAN substantive
  result because it reported actual model/reasoning metadata as unavailable.
  That reviewer is closed and the same role is redispatched at explicit
  `gpt-5.6-luna` / medium with the metadata acceptance requirement restated.

## Slice 3 Specialist Review Findings

- The complete review wave is collected before fixes. TypeScript/API docs is
  CLEAN. Accepted findings are: failed responder bind can leave its `Reply`
  socket unowned; `subscribe()` can resume after transport close and create a
  live connector; command observations lack the fixed-event path's quiet-window
  duplicate check; and three active docs need to scope exactly-once wording to
  this bounded proof rather than a general delivery guarantee.
- Existing reviewers are closed. The same implementer is resumed at immutable
  explicit `gpt-5.6-terra` / medium, no subagents, with all four findings in one
  fix assignment. Required regressions cover failed responder bind cleanup,
  close-vs-subscribe, and delayed duplicate command observations; docs must
  state the proof scope without changing accepted behavior or future policy.

## Slice 3 Specialist Review Fix Handback

- Actual immutable execution metadata is the existing implementer at explicit
  `gpt-5.6-terra` / medium, with no subagents dispatched or used. The accepted
  complete batch was evaluated with `receiving-code-review`; strict `tdd` and
  `test-driven-development` plus test/mocking/refactoring/anti-pattern
  references; `javascript-testing-patterns` including async/timer guidance;
  `error-handling-patterns` including TypeScript async and stable aggregation;
  `systematic-debugging` for unexpected native-test and static-check results;
  and `verification-before-completion`.
- Failed responder setup now binds and closes through a package-internal native
  socket boundary that is absent from `@spine-ts/transport` and
  `@spine-ts/transport/zeromq` exports. A bind rejection closes the newly
  created `Reply` before any ownership handle exists. If native close also
  rejects, diagnostics are `AggregateError([bindFailure, closeFailure])`, with
  the original bind failure first. Corrected RED was one failure with `18`
  skipped because close was called zero times; GREEN was `1/1` with `18`
  skipped. An initial duplicate-bind/prototype-spy attempt was rejected as
  evidence after systematic debugging showed the native duplicate bind was not
  a deterministic failure injector and `Socket.close` is inherited and
  non-configurable.
- Subscriber opens are now tracked before asynchronous IPC-directory
  preparation. Transport close waits for every open to settle; an open that
  resumes after close retires its just-created connector, rejects as closed,
  starts no receive loop, and observes no later sibling publication. RED was
  one failure with `19` skipped because close settled while preparation was
  blocked; GREEN was `1/1` with `19` skipped.
- Command proof now waits the same bounded `200 ms` quiet window used by the
  fixed inbound-event proof after exactly three observations. A child-fixture
  fault injects one duplicate command observation after `100 ms`; RED resolved
  with the first three observations instead of rejecting (`1` failed, `5`
  skipped), and GREEN rejects the delayed fourth (`1/1`, `5` skipped). Generated
  command/event payloads still cross ZeroMQ only; the fault is bounded test
  control observation.
- `docs/USER_GUIDE.md`, `docs/architecture/README.md`, and
  `packages/server/README.md` now describe the fixed event's one-per-projection
  observations only within bounded observation/quiet windows and explicitly
  disclaim a general exactly-once guarantee for durable redelivery, retries,
  process restarts, or remote transport.
- Unrestricted native suites pass: ZeroMQ adapter `20/20`, child-process proof
  `6/6`. Generated build and tooling typechecks, scoped ESLint, cleanup rules,
  exact Prettier, and docs/API checks pass; docs retain `17` transport and `205`
  server exports. Typecheck first exposed an optional-handle callback capture,
  scoped lint required explicit `node:timers`, and cleanup enforcement found one
  overlong diagnostic; each was corrected without behavioral or policy change.
  Canonical generated-clean, root/private/protected scans, exact ten-file record
  formatting, `git diff --check`, and expected ten-path diff/status pass.
- Authorized changed paths are
  `packages/transport/src/zeromq/signal-transport.ts`,
  `packages/transport/test/zeromq/signal-transport.test.ts`, both cross-process
  fixture files, the three active docs, and these three durable records. No
  public API/export, topology, retry policy, example, Protobuf, unrelated file,
  or commit change is included. Remaining uncertainty is specialist re-review
  and coordinator-owned full verification; same-host/local-only and T-0041
  security limitations remain unchanged.
- Coordinator inspected all four corrections and independently reran the two
  native files together. Adapter and child-process behavior passed `2` files
  and `26/26` tests. The complete finding batch is accepted as fixed and ready
  for targeted rereview.

## Slice 3 Targeted Rereview Assignment

- Correction package is
  `.superpowers/sdd/review-b031fe84..85d9fd87.diff` (`4` commits, `56803`
  bytes). Style/maintainability and performance/reliability use the existing
  roles at explicit `gpt-5.6-terra` / high; documentation uses the existing
  role at explicit `gpt-5.6-luna` / medium. All are read-only with no
  subagents. TypeScript/API remains clean and is not repeated.

## Slice 3 Targeted Rereview Findings

- Documentation is CLEAN. Style accepted one P2: move the package-internal
  native socket test seam below the primary public factory declaration.
  Reliability accepted one P2: the delayed-fourth proof can jump from fewer
  than three to four observations and time out while waiting for exact equality.
- The same implementer is resumed at explicit immutable `gpt-5.6-terra` /
  medium, no subagents. It must make duplicate injection deterministic relative
  to the parent entering its quiet window, fail immediately above three, retain
  the existing real transport proof, move the declaration, update all records,
  and rerun the native affected files.

## Slice 3 Targeted Rereview Fix Handback

- Actual immutable execution metadata is the existing implementer at explicit
  `gpt-5.6-terra` / medium; no subagents were dispatched or used. Applied
  receiving-code-review, strict `tdd`/`test-driven-development` and required
  test references, JavaScript async testing, TypeScript async error handling,
  and verification-before-completion.
- Reliability RED replaced the timer option in the regression with
  `injectCommandDuplicateInQuietWindow`; before implementation it was ignored,
  so the focused native test resolved with the original three observations
  instead of rejecting (`1` failed, `5` skipped). GREEN sends one fixed
  control-only Node IPC message only after the parent admits at least three
  observations and verifies exactly three. The child replays its remembered
  command observation without receiving a command/event payload over Node IPC;
  focused GREEN is `1/1` with `5` skipped.
- `observeCommand()` now admits with `>= 3`, immediately rejects any admission
  count above three, and monitors the bounded `200 ms` quiet window in `10 ms`
  increments so a later fourth rejects without a five-second exact-equality
  timeout. The old duplicate-delay environment value, optional parser,
  `node:timers` import, and child `setTimeout()` are removed. Real generated
  command/event envelopes still cross ZeroMQ only.
- Style P2 is a declaration-only move: `createZeroMqTransport` is again the
  first exported declaration at line `50`, followed by package-internal
  `zeroMqSocketAccess` at line `58`. No implementation, root/subpath export, or
  public declaration changed.
- Fresh unrestricted native files pass: ZeroMQ adapter `20/20`, child-process
  proof `6/6`. Generated build/tooling typechecks, scoped ESLint, cleanup rules,
  exact three-file Prettier, obsolete-delay scan, declaration-order/root-leak
  scans, and `git diff --check` pass.
- Changed paths are only `packages/transport/src/zeromq/signal-transport.ts`,
  the two cross-process fixture files, and all three T-0038b records. Accepted
  docs, production semantics, endpoint cleanup, public API, topology/retry
  policy, examples, Protobuf, unrelated files, and Git history are unchanged.
  Remaining uncertainty is coordinator acceptance/full verification plus the
  existing same-host and T-0041 security limitations.
- Coordinator inspection confirmed immediate over-count rejection and
  parent-triggered control only after exact-three admission. The independent
  unrestricted native rerun passed both affected files with `26/26` tests.
  Both P2s are accepted as fixed; style and reliability require final targeted
  rereview.
- Final correction package is
  `.superpowers/sdd/review-85d9fd87..e354cf10.diff` (`3` commits, `34180`
  bytes). Existing style and reliability roles are dispatched read-only at
  explicit `gpt-5.6-terra` / high with no subagents.

## Slice 3 Final Rereview Finding

- Both final reviewers independently accepted declaration order and reported
  one deduplicated P2: `child.send()` confirms submission, not child processing,
  so the duplicate control can be applied after the quiet deadline and the
  regression can resolve with three observations.
- The same implementer is resumed at explicit `gpt-5.6-terra` / medium, no
  subagents, to add a narrowly validated child-processed acknowledgment or
  observation barrier. The parent must fail if application is not observed
  within the bounded quiet window and must still reject the fourth observation.

## Slice 3 Final Rereview Acknowledgment Fix Handback

- `2026-07-14`: Actual immutable execution metadata remained the existing
  implementer at explicit `gpt-5.6-terra` / medium; no subagents were
  dispatched or used. Receiving-code-review, strict TDD and its required
  references, JavaScript async testing, error-handling, and
  verification-before-completion instructions were applied.
- Focused native RED added the parent application-barrier requirement while
  leaving the child unchanged. The child submitted the fourth observation but
  no acknowledgment, so the regression failed with `1` failed and `5` skipped:
  expected the exact-four rejection but received `Cross-process command
duplicate control was not applied within the bounded quiet window.` This
  proves ignored or too-late control application cannot satisfy the test.
- GREEN makes the child await submission of its remembered, payload-free
  duplicate observation before sending the exact one-key
  `duplicate-command-observation-applied` acknowledgment. The parent validates
  that control shape, requires it before the existing `200 ms` quiet deadline,
  then checks the observation count and rejects the fourth. Node IPC remains
  control-only; command/event envelopes still cross ZeroMQ. Focused native
  GREEN is `1` passed with `5` skipped; the complete native file is `6/6`.
- Tooling typecheck, scoped two-file ESLint, exact fixture Prettier, cleanup
  enforcement, and child syntax checks pass. Final exact five-file formatting,
  protected-scope/root/private scans, `git diff --check`, and status/diff checks
  pass. Changed paths are only both cross-process fixture files and these three
  records. Transport production, accepted docs, public API, topology/retry
  policy, examples, Protobuf, unrelated work, and Git history are unchanged.
- Slice 3 final-rereview acknowledgment P2 is fixed and ready for coordinator
  handback. Remaining uncertainty is coordinator acceptance and the
  coordinator-owned final verification; same-host/local-only and T-0041
  security limitations are unchanged. Slice 3 scope was not expanded.
- Coordinator inspected the ordered child observation/acknowledgment flow and
  independently reran the unrestricted native child-process file. All `6/6`
  tests passed. The P2 is accepted as fixed and ready for reliability-only
  rereview.
