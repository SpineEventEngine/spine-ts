# T-0052: JVM Feature Parity — Wave 1

Status: Planning packet accepted, merged, verified, and pushed; T-0053 integrated, T-0054 next

## Objective

Define an execution-ready, protocol-compliant first wave that brings the
approved Spine JVM behaviors to Spine TS without copying JVM internals or
inventing speculative abstractions. Once the human starts Wave 1, execute its
ordered tasks autonomously through review, verification, merge, and remote
synchronization unless a real protocol blocker occurs.

## Classification

High-risk. Wave 1 changes public TypeScript APIs, generated/serialized
contracts, query semantics, runtime configuration ownership, test APIs,
delivery scheduling and supervision, and distributed gRPC topology. It also
adds multiple packages and replaces the existing public server-environment
composition model.

## Human-Imposed Requirements Ledger

### General parity rule

- There are no real-world Spine TS users, so no deprecation cycle or
  compatibility alias is required for replaced APIs.
- Target behavioral and conceptual JVM feature parity using idiomatic
  TypeScript. Do not reproduce JVM internals blindly and do not over-engineer.
- Node.js is the only supported environment in this wave.
- Freeze the authoritative JVM inputs at:
  - `SpineEventEngine/core-java` commit
    `a408b0d70dafd603efc55b89c8b4b6f3e8c19d3b`;
  - `SpineEventEngine/delivery-server` commit
    `21f2901f393e552208b97166f4eaeb942f9f5172`.
- Perform a final upstream delta audit before Wave 1 closure, accepting only
  relevant changes that do not belong to deferred waves.

### Draft-state API

- Remove `updateDraftState()`.
- Add `update(mutator): State`: mutate the transaction draft and return the
  resulting state.
- Add `tryUpdate(mutator): readonly ConstraintViolation[]`: mutate a scratch
  copy, apply it only when valid, return an empty array on success, return
  violations on validation failure, and propagate unrelated exceptions.

### Client and testing APIs

- Add Node-only `@spine-ts/client` with JVM-equivalent end-user capabilities,
  expressed idiomatically in TypeScript.
- Add end-user-facing `BlackBox` in `@spine-ts/testing` as the direct behavioral
  counterpart of JVM `BlackBox` and keep it test-runner-neutral.
- `BoundedContextFixture` may remain as an internal implementation seam, but it
  must not be positioned as the end-user API.

### Columns and Query DSL

- Implement JVM-parity entity column declarations and Query DSL behavior.
- Wave 1 provides the complete high-level query surface and column guarantees
  for Projections.
- Existing low-level Aggregate and Process Manager ID queries remain available.
  Their high-level client Query/column parity is deferred to Wave 2 because it
  depends on recent state/event history and the resulting repository hierarchy.

### Environment and ServerEnvironment

- Implement JVM-equivalent `Environment` behavior.
- Replace the public explicit-instance `ServerEnvironment.local()` /
  `ServerEnvironment.production()` composition model with a JVM-style singleton:
  `ServerEnvironment.instance()`.
- Configure facilities by JVM-equivalent environment types. Servers and
  contexts obtain facilities from the singleton; there is no public per-server
  environment injection or compatibility alias.
- Provide deterministic reset and test configuration. Internal seams are
  permitted only where required for testability or implementation locality.

### Delivery and simple delivery server

- Implement the externally observable JVM `Delivery` behavior and supported
  extension points, including `DeliveryBuilder`, production scheduler and
  supervisor behavior, and multi-machine transport topology.
- Add public `@spine-ts/delivery-client` for TS applications to connect to a JVM
  or TS simple delivery server.
- Add standalone Node gRPC `@spine-ts/delivery-server`, porting **only** the
  frozen `delivery-server/simple-server` module and using in-memory state only.
- The Wave 1 server includes `InboxService`, `ShardService`, health service,
  stale-session/config behavior, and the simple server's machine-facing
  `AdminService` with shard-status streaming.
- Put shared delivery Protobuf contracts in existing `@spine-ts/proto`; do not
  add a delivery-proto package.
- Prove descriptor compatibility and real TS client-to-TS server gRPC behavior.
  Live TS/JVM bidirectional compatibility execution is deferred to Wave 3, so
  Wave 1 must not claim that evidence.
- Do not reuse `StorageFactory`, MySQL, or Datastore in the first delivery-server
  implementation.

## Explicit Exclusions

- Recent state and recent event history, plus high-level Aggregate and Process
  Manager queries: Wave 2 after a separate Q&A and approved plan.
- Packaging, deployment, multi-instance cloud packaging, and live TS/JVM
  delivery compatibility tests: Wave 3 after a separate Q&A and approved plan.
- Human-facing delivery administration, whether browser UI, TUI, or another
  interface: Wave 4 after a separate Q&A and approved plan.
- Redis and Hazelcast delivery-server storage modes.
- Delivery-server Terraform, Cloud Run launcher, admin-server, admin UI, demo,
  and every upstream module outside `simple-server`.
- Browser/Deno/client environments and speculative compatibility shims.

## Planning Deliverables

1. A frozen-source parity matrix that distinguishes required behavior, public
   API/SPI, Protobuf/wire contracts, deliberate TypeScript adaptations, and
   deferred or inapplicable JVM internals.
2. A dependency-ordered milestone map whose packets are small enough for one
   bounded implementation owner and focused behavioral tests.
3. Behavior-focused acceptance criteria, explicit public seams, ownership and
   lifecycle invariants, concurrency/compatibility risks, and verification
   cadence for every packet.
4. Durable work/review/decision records and an updated project completion
   frontier.

The binding implementation sequence and parity matrix are in
`build-protocol/planning/WAVE_1_JVM_PARITY_PLAN.md`.

## Assignment Gate

- Selected execution surface: Codex Desktop. It supports existing-role child
  dispatch with explicit model and reasoning fields.
- Existing role/function: `requirements_splitter`.
- Bounded scope: inspect the current repository and frozen JVM sources; produce
  the parity matrix, architectural seams, risks, acceptance criteria, and an
  ordered Wave 1 task split. Do not implement production code, edit repository
  files, commit, push, or spawn children.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Dispatch acceptance: both fields must be explicit. Runtime metadata will be
  recorded if exposed; otherwise the immutable role/profile and surface
  limitation will be recorded honestly under the protocol.

## Planning Baseline Evidence

- Branch/worktree: `task/T-0052-jvm-feature-parity-wave-1` /
  `.worktrees/T-0052-jvm-feature-parity-wave-1`, from `main` at `322cf298`.
- Locked dependency installation passed.
- The first generated test attempt was invalid because generated Protobuf
  sources were intentionally absent in the fresh worktree.
- Canonical `pnpm --config.verify-deps-before-run=false test` generated sources
  and, under native permissions, passed 82 test files and 1,901 tests but Vitest
  reported one unhandled canceled Connect operation after the
  project-management load-runner file.
- Immediate isolated rerun of that file passed 1 file / 4 tests with no
  unhandled error. Treat the full-suite observation as a baseline cleanup race
  to be recorded and rechecked at the first implementation verification gate.

## Requirements-Splitter Acceptance Metadata

- Existing role/function: `requirements_splitter`; assignment was limited to
  frozen-source/current-code comparison and planning.
- Expected and explicitly dispatched profile: `gpt-5.6-sol` / `high`; both
  fields were present and match the configured role.
- Runtime self-introspection was unavailable. The explicit dispatch and
  immutable role/profile are the accepted metadata; no runtime model identifier
  is invented and the protocol does not require redispatch for this limitation.
- Both frozen repositories were checked out read-only at their exact requested
  commits. The child did not edit repository files, commit, push, or spawn
  children.
- The returned parity matrix, source-conflict dispositions, recommended seams,
  risks, and T-0053 through T-0067 packets were reconciled into the binding plan.
- No missing human decision was found. Exact frozen shard-release behavior is a
  documented trusted-network default and final security-review gate.

## Planning Acceptance

- The dependency-ordered T-0053 through T-0067 plan completed one full
  four-concern specialist wave, one aggregated correction batch, and focused
  re-review of every substantively affected concern.
- Documentation, TypeScript/API, and performance/reliability re-reviews are
  clean. Style/maintainability confirmed its substantive findings resolved and
  raised only a deterministic digest-provenance ambiguity, corrected by
  recording both plan-only and five-file packet hashes with the reproduction
  command; the reviewed plan did not change.
- No P0-P3 planning finding remains. Implementation is intentionally not
  started until the human explicitly starts Wave 1.
- Focused documentation/process verification passes: Prettier, diff hygiene,
  release-readiness package/link resolution, and cleanup enforcement. No runtime
  or generated source changed, so the protocol does not require a second full
  suite after the recorded planning baseline.
- Planning commit `6d2c4a11` is pushed on the task branch and integrated into
  `main` at `ed63277c`. Post-merge tree equality and the focused gates passed;
  both local/remote task and main refs matched before this record-only closure.
