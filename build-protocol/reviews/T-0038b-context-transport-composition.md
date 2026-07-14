# T-0038b Review Log

Status: Slice 2 coordinator-verified; review endpoint pending

## Scope

- Baseline: `1a682b0c`.
- Review each slice against its immutable package, not accumulated unrelated
  history. Superseded historical text is non-actionable unless current records
  or changed active docs claim it.

## Slice 1 Concern Plan

- Style/maintainability: pending; one deep internal adapter, no duplicate
  routing/runtime/lifecycle policy.
- Documentation: N/A unless public or observable docs change in Slice 1.
- TypeScript/API docs: pending; no public root/declaration/internal leak.
- Performance/reliability: pending; command once, event once, refusal-before-bus,
  handle drain/close, and empty context behavior.
- Security: deferred to T-0041.

## Planned Profiles

- Implementer: explicit `gpt-5.6-terra` / medium.
- Documentation when relevant: `gpt-5.6-luna` / medium.
- Style/API/reliability: `gpt-5.6-terra` / high.
- All no subagents; immutable runtime metadata required.

## Slice 1 Implementer Pre-Review Evidence

- Existing implementer completed the slice at actual `gpt-5.6-terra` /
  `medium`; no subagents were dispatched or used. Canonical skill applicability
  and all required implementation/TDD/testing/error-handling/verification
  readings were completed and are recorded in the task/work logs.
- JVM guardrail recheck retained the accepted `IntegrationBroker`/
  `BoundedContext`/`ServerEnvironment`/`Server` ownership model: this is one
  internal bus-intake composition, not a broker or lifecycle redesign. The
  historical raw source checkout was unavailable, so accepted plan/local JVM
  notes are the exact durable evidence and this limitation remains visible to
  reviewers.
- Diff scope is internal `ContextTransport`, shared runtime-routing route
  extraction, its focused test, and these records. Root exports, public docs,
  server lifecycle, transport ownership, delivery, generated output, examples,
  and Protobuf are unchanged.
- Pre-review mechanical evidence is clean: focused context/routing/bus tests
  `63/63`; native runtime-transport ZeroMQ regression `13/13`; generated build
  typecheck; scoped ESLint; cleanup-rule scan; exact Prettier; generated-clean;
  root/internal-leak scan; and `git diff --check`.
- Required review dispositions remain pending the orchestrator's relevant
  reviewer wave: style/maintainability (deep small adapter/no duplicate policy),
  TypeScript/API docs (no root leak or public callback change), and
  performance/reliability (one command/event post, validation-before-bus,
  non-owning drain/close). Documentation is N/A for Slice 1 because no public
  or observable documentation changed; security remains deferred to T-0041.
- Slice 2 handback: only registration/intake composition is ready. Server
  startup/close order, partial lifecycle failures/retries, shared transport,
  and real child-process proof are unimplemented and must not be inferred from
  this slice.

## Slice 1 Coordinator Pre-Review Findings

- Accepted before reviewer dispatch: command/event success tests must use the
  binding handle's close barrier instead of direct context-bus sentinel work.
- Accepted before reviewer dispatch: add invalid event-envelope/type-URL
  refusal, matching the command refusal boundary.
- Accepted before reviewer dispatch: event subscription identity must be
  context-scoped and logical-ID-safe so same-event contexts retain independent
  fan-out descriptors; command responders remain intentionally competing and
  are not context-scoped.
- Accepted before reviewer dispatch: the recording transport must retain all
  handlers for one topic and prove two contexts each receive once.
- The same implementer context is resumed for this complete bounded batch at
  explicit `gpt-5.6-terra` / `medium`, with no subagents. Reviewer dispatch
  remains pending corrected coordinator verification and an immutable commit.

## Slice 1 Corrected Pre-Review Evidence

- Existing implementer actual immutable metadata matched explicit dispatch at
  `gpt-5.6-terra` / `medium`; no subagents. Receiving-review, TDD and required
  references, and verification skills were re-applied for the correction.
- Resolved success-test drain finding: command/event assertions now follow
  handle close and include only transport-originated observations.
- Resolved event-refusal finding: missing-message and wrong-type-URL events
  reject before any matching event dispatcher observes work.
- Resolved identity/fan-out finding through a staged RED/GREEN: the recording
  adapter first retained all same-key subscriptions and published to all; the
  test still failed because descriptors collided. Context-scoped,
  logical-ID-safe deterministic base64url event worker IDs then yielded two
  descriptor keys and one observation in each context. Shared command worker
  identity remains unchanged by design.
- Recording registration close is per-handle and idempotent, preserving active
  sibling registrations under the same routing key.
- Fresh pre-review gates: focused context/routing/bus tests `65/65`; native
  runtime-transport `13/13`; generated build typecheck; scoped ESLint; cleanup;
  exact Prettier; generated-clean; no root export; and clean diff check.
- Canonical reviewer dispositions remain pending. Documentation stays N/A for
  Slice 1 because no public/observable docs changed; security remains deferred
  to T-0041. Lifecycle/retry/cross-process concerns remain explicitly outside
  this corrected Slice 1 package.

## Slice 1 Corrected Pre-Review Gate

- Coordinator accepted the resumed implementer result at actual immutable
  `gpt-5.6-terra` / `medium`; the implementer was closed and used no subagents.
- Fresh focused evidence passed: four files and `65/65` tests; native ZeroMQ
  runtime transport `13/13`; build typecheck; scoped ESLint; exact Prettier;
  cleanup; canonical package-script generated-clean; root leak; status; and
  diff checks.
- Docs/status lint is clean. Style, TypeScript/API docs, and reliability remain
  relevant and pending an immutable review package. Documentation is N/A
  because no observable/public documentation changed. Security is deferred to
  T-0041.

## Slice 1 Reviewer Dispatch

- Endpoint: `b2a6e7e1`; baseline/frame: `ae8f0f09`; package:
  `.superpowers/sdd/review-ae8f0f09..b2a6e7e1.diff` (one commit, 46,562 bytes).
- Style/maintainability: assigned existing role, explicit expected
  `gpt-5.6-terra` / `high`, no subagents.
- TypeScript/API docs: assigned existing role, explicit expected
  `gpt-5.6-terra` / `high`, no subagents.
- Performance/reliability: assigned existing role, explicit expected
  `gpt-5.6-terra` / `high`, no subagents.
- Prompts are bounded to Slice 1 and must ignore superseded historical text
  unless current records or changed active docs claim it. Documentation is N/A;
  security is deferred to T-0041.

## Slice 1 Reviewer Results

- Style/maintainability: CLEAN. Reviewer
  `019f5e8a-a99c-7401-971c-bca6b26c4c38`; actual immutable
  `gpt-5.6-terra` / high; no subagents; closed.
- TypeScript/API docs: CLEAN. Reviewer
  `019f5e8a-ad5f-70c1-80fc-74e45251dd98`; actual immutable
  `gpt-5.6-terra` / high; no subagents; closed. Internal composition remains
  outside package root and Node `Buffer` matches server runtime typings.
- Performance/reliability: two accepted findings. Reviewer
  `019f5e8a-affc-7c93-a658-e961038fed1a`; actual immutable
  `gpt-5.6-terra` / high; no subagents; closed.
- P1: partial open plus close failure loses retry ownership and masks the
  registration failure. Required fix: primary-first combined failure and an
  internal retained cleanup capability that can be retried without public API
  leakage; regression must prove later cleanup and re-open.
- P2: recording command responder close is a no-op. Required fix: per-handle
  idempotent removal and post-close command/event refusal evidence.
- Documentation: N/A, unchanged internal-only behavior. Security: deferred to
  T-0041. Existing implementer fix dispatch is explicit
  `gpt-5.6-terra` / medium, no subagents.

## Slice 1 Reliability Fix Evidence

- Existing implementer actual immutable metadata matches the explicit
  `gpt-5.6-terra` / `medium` fix dispatch; no subagents. Receiving-review, strict
  TDD plus required references, and verification-before-completion were applied.
- P1 is resolved in the implementation package: failed open plus failed cleanup
  produces an `AggregateError` whose first entry is the event-registration
  failure and second entry is the command-handle close failure. Weak internal
  runtime access retains the exact retryable handle, and package-internal
  context access delegates to it without any root export or public lifecycle
  contract.
- P1 ownership evidence is behavioral. The fake command registration remains
  owned after close rejects, so a second open before cleanup retry fails with an
  exact duplicate-owner error. Retrying retained cleanup releases that owner;
  only afterward does a later open succeed. This supplements, and does not rely
  on, call-count assertions.
- P2 is resolved in the focused adapter: responder close is per-registration
  and idempotent. Post-close command request and event publish cannot find
  retired registrations. Closing one of two same-key event registrations does
  not retire the sibling, which receives one subsequent event before its own
  close.
- TDD evidence: initial P1 RED received only the cleanup failure; strengthened
  ownership RED allowed the pre-cleanup reopen; P2 RED routed a request through
  the retired responder and returned `RUNTIME_NOT_ACCEPTING`. Each focused case
  is GREEN with the corrected implementation.
- Fresh mechanical evidence: focused context/routing/command-event bus tests
  `65/65`; native ZeroMQ runtime transport `14/14`; generated build typecheck;
  scoped ESLint; cleanup; exact Prettier; canonical generated-clean; no root
  leak; clean diff/status checks.
- Scope remains Slice 1 internal-only. Documentation stays N/A and security
  stays deferred to T-0041. Server lifecycle consumption of the retained
  checkpoint and shared-transport retry behavior remain Slice 2 review work;
  cross-process proof remains Slice 3.

## Slice 1 Fix Coordinator Gate

- Existing implementer result was accepted at actual immutable
  `gpt-5.6-terra` / medium; no subagents; implementer closed.
- Fresh coordinator verification passed `65/65` focused context/routing/bus and
  `14/14` native runtime-transport tests, build typecheck, scoped ESLint, exact
  Prettier, cleanup, canonical generated-clean, root leak, status, and diff.
- Only performance/reliability requires re-review because the fix changes
  failure retention, cleanup retry, and registration-close behavior. Prior
  style and TypeScript/API clean results remain applicable; documentation stays
  N/A and security remains deferred.

## Slice 1 Reliability Rereview Dispatch

- Baseline `b2a6e7e1`; corrected endpoint `a69ae867`; package
  `.superpowers/sdd/review-b2a6e7e1..a69ae867.diff` (three commits, 40,183
  bytes).
- Existing performance/reliability reviewer assigned at explicit expected
  `gpt-5.6-terra` / high, no subagents. Scope is resolution of P1/P2 and any
  concrete regression introduced by those fixes; historical superseded text is
  ignored unless current records claim it.

## Slice 1 Reliability Rereview Result

- CLEAN. Reviewer `019f5e9a-7dca-7e80-ad6c-4f83479d43d2`; actual immutable
  `gpt-5.6-terra` / high; no subagents; closed.
- Reviewer confirmed P1/P2 retry ownership and registration cleanup semantics,
  no root API leak, and no concrete reliability regression. Focused
  runtime/context transport evidence passed `21/21`, including native ZeroMQ.
- Slice 1 all-concern disposition: style CLEAN; documentation N/A; TypeScript/API
  CLEAN; performance/reliability CLEAN; security deferred to T-0041.

## Slice 2 Concern Plan

- Style/maintainability: relevant for keeping retry checkpoints inside existing
  server lifecycle ownership and avoiding duplicate close policy.
- Documentation: N/A unless public/observable lifecycle wording changes.
- TypeScript/API docs: relevant for no root/options/declaration leakage.
- Performance/reliability: relevant for open/close ordering, partial failure,
  idempotent retry, shared transport, sibling routes, and accepted-work drain.
- Security: deferred to T-0041. Implementer assignment is explicit
  `gpt-5.6-terra` / medium, no subagents.

## Slice 2 Implementer Pre-Review Evidence

- Existing implementer actual immutable metadata matches explicit dispatch at
  `gpt-5.6-terra` / `medium`; no subagents were dispatched or used. Canonical
  implementation/worktree/TDD references, JavaScript testing, error handling,
  Node lifecycle, and verification skills were read and applied. No commit or
  implementer-owned review was performed.
- Scope is one internal `ContextTransportGroup`, existing `Server` lifecycle
  integration, the reused T-0037f fixture, one focused lifecycle file, minimal
  truthful `Server`/`RunningServer` TSDoc ordering correction, and these records.
  Root exports/options, external docs/examples, Protobuf, generated tracked
  output, topology/retry policy, and Slice 3 remain unchanged.
- Startup evidence: attachment/recovery completes before contexts open in input
  order; every registration completes before HTTP server creation/listening.
  Registration or duplicate-responder failure creates no listener. The failure
  checkpoint retains successful handles and exact Slice 1 failed-open cleanup.
- Failure evidence: initial partial-open rejection flattens stable diagnostics
  with registration first, then binding close, then server cleanup close. An
  unresolved intake close is a hard gate before detach and all dependencies.
  Cleanup-only `start()` retries only failed registration indexes, then advances
  existing detach/close checkpoints once and preserves established terminal
  failed-start semantics.
- Running/listener evidence: network/session close precedes intake close and is
  not repeated; intake close drains accepted callback work and precedes delivery
  detach; detach precedes contexts/resources; an owned environment closes its
  transport only in its existing facility phase. Failed listener cleanup uses
  the same network/intake/detach/dependency order.
- Shared/duplicate evidence: closing one caller-environment server removes only
  its same-event subscription and leaves sibling traffic/listener operational;
  supplied transport is not closed. The real local transport deterministically
  rejects duplicate command ownership, the failed server has no listener and
  cleans only its attempt, the existing server remains connectable, and route
  ownership becomes available after that server closes.
- TDD RED evidence is behavior-specific: listener followed recovery without
  subscriptions; running close skipped registration close; partial-open error
  omitted the second cleanup failure; listener-failure cleanup recorded no
  registration close; duplicate ownership returned another running listener.
  All are GREEN in the focused lifecycle package.
- Mechanical evidence is clean: baseline `83/83`; final server lifecycle
  `70/70`; context/routing/command-event bus `65/65`; native ZeroMQ runtime
  transport `14/14`; generated build typecheck; scoped ESLint; cleanup; exact
  Prettier; TypeDoc; canonical generated-clean; no root leak; and clean
  diff/status checks. Documentation concern is limited to review of the
  required TSDoc correction; security remains deferred to T-0041.
- Remaining review uncertainty is Slice 3 separation only: this package does
  not claim real cross-process proof or final observable external docs.

## Slice 2 Coordinator Pre-Review Gate

- Existing implementer result accepted at actual immutable
  `gpt-5.6-terra` / medium; no subagents; implementer closed.
- Fresh coordinator verification passed native server lifecycle `70/70`,
  context/routing/bus `65/65`, native runtime transport `14/14`, build
  typecheck, scoped ESLint, exact Prettier, cleanup, docs/API check with 205
  server exports, canonical generated-clean, root leak, status, and diff.
- Docs/status lint is clean. Style, documentation, TypeScript/API docs, and
  performance/reliability are all relevant because server lifecycle code,
  public lifecycle TSDoc, and failure/retry behavior changed. Security remains
  deferred to T-0041.
