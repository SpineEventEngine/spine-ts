# T-0065: Delivery Server Lifecycle And Admin

Status: Awaiting mechanical pre-review gate

Branch: `task/T-0065-delivery-server-lifecycle`

Worktree: `.worktrees/T-0065-delivery-server-lifecycle`

Baseline: pushed, integrated, and post-merge-verified `main` at `ad2950e9`

## Objective

Complete the standalone Node lifecycle around the accepted in-memory
`@spine-ts/delivery-server` core: machine-facing Admin snapshot/streaming,
gRPC health, validated configuration, listener startup/shutdown, and signal
handling. Preserve behavioral parity with the frozen upstream
`delivery-server/simple-server` only, using idiomatic TypeScript without
inventing extra facilities.

## Classification

High-risk. This packet adds a public network listener, process signals,
server-stream lifecycle and backpressure, configuration parsing, health-state
transitions, and ordered asynchronous shutdown around concurrent mutable state.

## Behavior-Focused Acceptance Criteria

- Admin snapshot reports current shard and message-count state.
- Admin streaming emits exactly one successful `created` acknowledgment before
  updates and discards changes that occur before that acknowledgment.
- Every subscriber queue is finite. A slow subscriber terminates with one
  stable resource-exhaustion error, and cancellation removes all resources.
- Health `Check` reports empty/all and known services accurately; an unknown
  named service reports `NOT_SERVING`; `Watch` returns `UNIMPLEMENTED`.
- Defaults are port `8484`, inbound message limit `4 MiB`, and processing
  timeout `0` (disabled). A positive integral seconds value enables timeout.
- Explicit options take precedence over environment fallback. Configuration is
  parsed once, and invalid values fail before any bind attempt.
- Startup, shutdown, and installed signal handling are one-shot and
  idempotent. Shutdown orders: mark non-serving, stop mutation admission, close
  Admin streams, then close the listener.
- Bind host and the trusted-network/no-authentication boundary are explicit in
  public documentation and executable examples.
- Port collision, repeated shutdown, signal cleanup, stream races,
  backpressure, cancellation, RPC conformance, and configuration boundaries
  have behavior-first tests that are observed RED before production changes.
- Redis, Hazelcast, persistence, human-facing admin UI/TUI, deployment
  packaging, and live TS/JVM execution remain excluded.

## Verification And Review

Run focused RED/GREEN tests and deterministic type/lint/doc checks during
implementation. Run one full repository verification after review convergence.
All four specialist lanes are required: style/maintainability,
documentation, TypeScript/API, and performance/reliability. Final security is
deferred to T-0067 unless this packet exposes a security-critical blocker.

## Human-Imposed Requirements Ledger

- Implement feature parity, not a blind JVM structural copy; use idiomatic
  TypeScript and do not invent over-engineered abstractions.
- Analyze and implement only the frozen `delivery-server/simple-server` scope.
- The first TypeScript delivery server is in-memory only. Redis and Hazelcast
  modes are excluded until the human reassesses them.
- Human-facing browser administration is excluded; browser/TUI direction is
  deferred to Wave 4.
- Live TS/JVM compatibility execution is deferred to Wave 3. Do not claim it
  from shared descriptors or TS-to-TS tests.
- Node is the only supported runtime in this wave.
- Continue autonomously under the streamlined build protocol, reporting
  feature-level Wave 1 status every 30 minutes and every protocol milestone.
- Push each commit to `origin` immediately after it is created.

## Requirements Splitter Dispatch

- Existing role: requirements splitter.
- Expected profile: `gpt-5.6-sol` / `high` reasoning.
- Dispatch fields: both model and reasoning are explicit; Standard speed.
- Ownership: read-only analysis plus
  `REQUIREMENTS_ANALYSIS.md`; no production or test edits.
- Actual runtime metadata: pending completion; the immutable configured role
  profile will be recorded if runtime self-introspection is unavailable.

### Acceptance

- Implementation is feature-complete and uncommitted. The dispatch explicitly
  supplied the existing implementer role, `gpt-5.6-terra`, and `medium`
  reasoning; the immutable configured role profile matches.
- Runtime self-introspection was unavailable. This limitation and the exact
  RED/GREEN/post-implementation test evidence are recorded in
  `IMPLEMENTATION_REPORT.md` without inventing metadata.

### Acceptance

- Completed with no ambiguity or blocker. The accepted implementation split is
  `REQUIREMENTS_ANALYSIS.md`.
- Dispatch explicitly supplied `gpt-5.6-sol` / `high`; the existing immutable
  requirements-splitter role profile matches. Runtime self-introspection was
  unavailable, which is recorded without inventing metadata.

## Implementation Owner Dispatch

- Existing role: implementer.
- Expected profile: `gpt-5.6-terra` / `medium` reasoning.
- Dispatch fields: both model and reasoning will be explicit; Standard speed.
- Exclusive ownership is the delivery-server production/tests/docs/package
  scope and T-0065 implementation records enumerated in
  `REQUIREMENTS_ANALYSIS.md`; no other production writer overlaps it.
- Actual runtime metadata: pending completion; the immutable configured role
  profile will be recorded if runtime self-introspection is unavailable.
