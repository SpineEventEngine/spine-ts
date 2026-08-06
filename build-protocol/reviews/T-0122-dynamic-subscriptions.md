# T-0122 Review Record

Status: Complete review wave; corrections required

## Review Range

- Baseline: `d3aee369`.
- Implementation endpoint: `eb74a2ac`.
- Requirements: `build-protocol/tasks/T-0122-dynamic-subscriptions/TASK.md`.
- Implementation packet: `build-protocol/planning/T-0122_IMPLEMENTATION_PACKET.md`.

## Reviewer Assignments

- Existing style/maintainability reviewer: module depth, naming, ownership,
  simplicity, duplication, and test maintainability. Expected and explicitly
  dispatched `gpt-5.6-terra` / `high`.
- Existing documentation reviewer: beginner and agent reference accuracy,
  lifecycle teaching, limits, and absence of internal task jargon. Expected
  immutable configured role profile `gpt-5.6-luna` / `medium`.
- Existing TypeScript/API docs reviewer: public contracts, exports, TSDoc,
  canonical subscription definition boundary, and intentional v4
  incompatibility. Expected and explicitly dispatched `gpt-5.6-terra` /
  `high`.
- Existing performance/reliability reviewer: generation fencing, per-node
  child ownership, zero-node recovery, cancellation, cleanup retry, bounded
  fan-out, restart, and shutdown. Expected and explicitly dispatched
  `gpt-5.6-terra` / `high`.

Subagents may not spawn subagents. Actual runtime metadata or the immutable
configured-profile limitation will be recorded before accepting results.

## Required Concern Dispositions

- Style/maintainability: changes requested.
- Documentation: one affected-contract TSDoc correction requested; other
  changed README and reference claims are clean.
- TypeScript/API docs: changes requested.
- Performance/reliability: changes requested.
- Dedicated security review: N/A because this task preserves the existing
  authenticated Gateway trust boundary and changes only trusted backend
  membership, subscription persistence, and native stream lifecycle.

## Mechanical Evidence Before Review

At `eb74a2ac`, six focused suites passed 330 tests. Generated typechecking,
scoped auth/server lint including Proto and TSDoc checks, documentation audience
checks, formatting, and `git diff --check` passed.

## Runtime Metadata

- Style/maintainability: configured existing role, explicitly dispatched
  `gpt-5.6-terra` / `high`.
- Documentation: immutable configured existing role, `gpt-5.6-luna` /
  `medium`.
- TypeScript/API docs: configured existing role, explicitly dispatched
  `gpt-5.6-terra` / `high`.
- Performance/reliability: configured existing role, explicitly dispatched
  `gpt-5.6-terra` / `high`.

The review surface exposed no independent runtime self-introspection. Explicit
dispatch fields and immutable configured profiles are the available evidence;
no visible fallback or mismatch occurred.

## Accepted Correction Batch

The complete wave is accepted as one deduplicated batch:

1. Separate the logical subscription coordinator used by
   `SubscriptionGateway` from the per-node native `SubscriptionCreator` seam.
   Do not disguise canonical `PublicSubscriptionWire` bytes as a
   `BackendSubscriptionEnvelope` for compensation or cancellation.
2. Keep top-level Activate pending until downstream abort, explicit Cancel,
   expiry, or Gateway close. Normal child activation setup must not settle the
   durable activation or close the public update relay. Add end-to-end coverage
   proving updates remain deliverable and abort/cancel owns every child.
3. Make Subscribe acknowledge only after every current desired node installed
   its native child. Propagate native creation failures for that generation,
   compensate partial children, retain no logical definition, and reject an
   empty desired membership even when stale clients have not been removed yet.
4. Apply `maxBackendEnvelopeBytes` to every actual ephemeral per-node native
   envelope before retaining it. Compensate an oversized child and fail the
   logical creation; do not document or enforce the limit against disguised
   public definition bytes.
5. Add bounded durable v4 active-definition recovery at Browser Gateway
   startup. Reclaim/rehydrate logical definitions into the fresh shared owner,
   create children for the newly discovered membership, and support immediate
   reconnect without waiting for a stale local lease. Test restart with changed
   membership and no v3 read or migration.
6. Remove write-only child token/incarnation fields or make one consistent
   named fence authoritative. Preserve exact-child object/generation fencing
   without misleading state or unused UUID generation.
7. Correct all affected public TSDoc: canonical definition callbacks and
   binding creation, the four dynamic adapter methods, and native methods that
   still describe removed private-envelope parameters.
8. Add focused regression tests for each correction, rerun the complete
   affected preflight, and update task/work records before re-review.

The unchanged pre-existing `B4` wording is recorded as out-of-scope baseline
debt rather than a T-0122 finding.
