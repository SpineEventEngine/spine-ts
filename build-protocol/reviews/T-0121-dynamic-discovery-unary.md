# T-0121 Review Record

Status: Specialist review wave complete; corrections required

## Review Range

- Baseline: `fa1ed36f`.
- Implementation endpoint: `5984e087`.
- Human ledger: `build-protocol/tasks/T-0121-dynamic-discovery-unary/TASK.md`.

## Reviewer Assignments

- Existing style/maintainability reviewer: package/module depth, public source
  structure, naming, duplication, and executable simplicity. Expected and
  explicitly dispatched `gpt-5.6-terra` / `high`.
- Existing documentation reviewer: README/reference teaching quality and
  accuracy against current behavior. Expected immutable configured role
  profile `gpt-5.6-luna` / `medium`; the dispatch API does not accept a
  redundant Luna override, so role plus the explicit prompt/profile record is
  the available dispatch evidence.
- Existing TypeScript/API docs reviewer: public contracts, exports, endpoint
  semantics, TSDoc, compatibility, and fixed-subscription boundary. Expected
  and explicitly dispatched `gpt-5.6-terra` / `high`.
- Existing performance/reliability reviewer: latest-snapshot generation
  fencing, bounded starts/disposal, cancellation, failure recovery, shutdown,
  zero-node recovery, and resource lifetime. Expected and explicitly
  dispatched `gpt-5.6-terra` / `high`.

Subagents may not spawn subagents. Actual runtime metadata or the immutable
configured-profile limitation will be recorded before accepting results.

## Required Concern Dispositions

- Style/maintainability: changes requested. The review found missing scheduled
  refresh policy coverage, duplicate-ID leaks, permanently poisoned
  reconciliation after failures, TLS/SNI omissions, uncancellable shutdown,
  incomplete lifecycle tests, and contradictory public guidance.
- Documentation: changes requested. Public documentation exposes internal task
  identifiers and does not yet teach package installation, static replacement,
  complete-snapshot ownership, refresh/cancellation, canonical equality,
  bounded reconciliation, or the soft 32-node expectation.
- TypeScript/API docs: changes requested. TLS validation accepts IP literals
  and rejects valid IDNs; TLS authority is neither part of client equality nor
  forwarded to the Node transport; shutdown cannot abort a stalled factory;
  affected reference material is incomplete.
- Performance/reliability: changes requested. Factory or disposal failure can
  permanently wedge the owner and produce an unhandled rejection; duplicate
  IDs leak clients; stalled starts block shutdown; browser-owned clients are
  not disposable; and waiter storage grows without bound during stalled
  reconciliation.
- Dedicated security review: N/A for this task because it changes trusted
  backend discovery and routing, not external authentication or authorization.

Reviewer assignments and actual runtime metadata will be recorded before and
after dispatch according to the build protocol.

## Accepted Correction Batch

The complete wave is accepted as one deduplicated batch:

1. Add the platform-neutral scheduled refresh abstraction required by the
   plan, with a configurable interval, a ten-second default, injected
   scheduling, cancellation ownership, and deterministic fake-time tests.
2. Canonicalize one complete snapshot before both removal and creation so one
   stable ID owns one descriptor and no duplicate client can leak. Test equal
   and conflicting duplicate descriptors explicitly.
3. Make reconciliation recover after factory and disposal failures, settle all
   callers, avoid unhandled rejections, and allow later snapshots to establish
   a fresh owner. Keep pending state and completion bookkeeping bounded under
   heavy stalled churn.
4. Retain an abort controller for in-flight creation, abort it before joining
   shutdown, make repeated close safe, and prove stalled abort-aware creation
   cannot hold shutdown indefinitely.
5. Normalize valid IDN TLS authorities to ASCII lowercase, reject IPv4 and IPv6
   literals, include TLS authority in descriptor equality, and pass it as the
   Node TLS `servername` in BrowserServer assembly.
6. Give browser-created dynamic clients real owned cleanup where the transport
   supports it; if Connect creates no eagerly opened resource, express that
   fact accurately and keep lifecycle ownership at the closest real resource
   seam rather than documenting a fictitious connection.
7. Add focused direct and server-assembly tests for refresh scheduling,
   duplicates, TLS replacement and SNI use, failure recovery, stalled-start
   cancellation, repeated close, bounded waiters, and static/dynamic assembly.
8. Remove internal task identifiers and contradictory fixed-topology wording
   from public docs. Teach `@spine-event-engine/deployment` imports, initial and
   replacement snapshots, complete/latest ownership, canonicalization,
   bounded reconciliation, cancellation/close responsibilities, and that 32 is
   an expectation rather than a cap. Preserve T-0122's fixed subscription
   boundary.

## Runtime Metadata

- Style/maintainability: configured existing role, `gpt-5.6-terra` / `high`.
- Documentation: immutable configured existing role, `gpt-5.6-luna` /
  `medium`.
- TypeScript/API docs: configured existing role, `gpt-5.6-terra` / `high`.
- Performance/reliability: configured existing role, `gpt-5.6-terra` / `high`.

The review surface exposed no independent runtime self-introspection. The
explicit dispatches and immutable configured profiles are the available
evidence; no visible fallback or mismatch occurred.

## Focused Re-review After First Correction Batch

Range: `7a7d76f4..c8552397`.

The first correction batch resolved bounded latest-only completion, equal
duplicate coalescing, TLS-only replacement, cancellation of every concurrent
start, idempotent close entry, factory-failure recovery, normal Browser
watch/stop, SNI mapping, internal task wording, and the fixed-subscription
boundary. Coordinator preflight passed 131 focused tests, affected typecheck,
TSDoc, Prettier, and diff checks.

The complete focused re-review requested one further consolidated batch:

1. Fence every client start with its reconciliation generation. A successful
   start completing after a sibling failure or newer snapshot must close
   itself and must not repopulate stale membership. Add the parallel
   fail/late-success/newer-empty race test.
2. Own an `Http2SessionManager` for each Browser dynamic transport, pass it to
   Connect, and abort it when the client leaves or the Gateway closes. Test a
   live request/session cleanup path so the start/disposal semantics describe
   real resources rather than wrapper construction.
3. Retain failed client disposals in retryable cleanup state. Removal and final
   close must attempt all cleanup, keep failed references, and let a later
   reconciliation or repeated close retry them without reporting durable
   cleanup prematurely.
4. Contain scheduled-reader failures without unhandled rejections, preserve the
   last delivered snapshot, continue scheduling after transient failure, and
   join an abort-aware in-flight read during close. Test rejection recovery and
   abort-on-close.
5. Make scheduled discovery ownership unambiguous: support independent watches
   correctly or enforce one active consumer before creating another timer/read.
   Document and test the selected simple contract.
6. Reject TLS userinfo, any explicit port (including the default port), query,
   fragment, empty/trailing port syntax, and bracketed IPv6, while preserving
   valid IDN-to-ASCII normalization and rejecting IPv4. Cover every form.
7. Give conflicting duplicate IDs an accurate deterministic contract. Do not
   name or document the operation as rejection while swallowing the error;
   either expose the failure safely or define contained invalid-snapshot
   handling with an observable/reportable policy appropriate before Wave 8
   logging.
8. Make Browser startup and shutdown cleanup phase-safe. A listener/startup,
   subscription-close, or other phase failure must not skip discovery stop,
   dynamic transport cleanup, listener cleanup, or native-server cleanup;
   aggregate failures as necessary and test rollback plus close-phase failure.
9. Correct the remaining public docs: scope the auth fixed-topology statement
   so it no longer denies dynamic unary discovery; describe current workspace
   consumption of the still-private deployment package without claiming npm
   installation; state that the consumer, not the snapshot, performs equality;
   and keep the future registry-package intent clear without implying
   publication now.
10. Move the Node import to the normal import block and keep all affected code,
    tests, documentation, and package metadata mechanically clean.

Re-review metadata matches the original explicit assignments: style,
TypeScript/API, and performance/reliability use the existing
`gpt-5.6-terra` / `high` roles; documentation uses its immutable
`gpt-5.6-luna` / `medium` role. Independent runtime introspection remains
unavailable and no fallback or mismatch was visible.

## Final Narrow Correction Batch

Coordinator preflight at `d127ffa6` passed 143 focused tests, affected
typecheck, TSDoc, Prettier, and diff checks. Final re-review accepted all prior
resource ownership, retry, refresh, conflict containment, topology, and public
wording corrections except these bounded edge cases:

1. Fence every topology mutation after an await. An older snapshot must not
   remove a client after a newer generation appears; add a stale-removal race
   that preserves the newer live client without unnecessary recreation.
2. Settle every start in a failed parallel batch before processing the next
   snapshot, so stale stalled siblings cannot overlap a fresh batch above the
   global start bound. Add fast-fail/stalled-sibling/new-snapshot peak coverage.
3. Validate normalized DNS labels, rejecting empty labels, underscores, and
   leading/trailing hyphens while preserving valid IDN normalization.
4. Make scheduled discovery explicitly single-watch and terminal after close.
   Reject post-close watch, document the contract in TSDoc and the deployment
   reference, and test it.
5. Preserve secondary Browser cleanup failures for non-`Error` primary
   rejection values by normalizing unknown reasons or using an equivalent
   deterministic error contract. Test the non-Error case.
6. Document that dynamic-forwarder close aborts in-flight creation and owns
   current-client cleanup. Move the `node:net` import to the actual import block.

All final reviewers used the same explicit configured profiles and reported the
same independent-runtime-introspection limitation with no visible mismatch.
