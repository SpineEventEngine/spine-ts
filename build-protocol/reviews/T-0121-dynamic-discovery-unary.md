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
