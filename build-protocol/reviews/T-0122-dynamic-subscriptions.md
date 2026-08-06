# T-0122 Review Record

Status: Correction batch implemented; targeted re-review pending

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

## Focused Re-review

Range: `af4225e0..00b70013`.

- Style/maintainability: prior fabricated-envelope and unused-token findings
  are resolved. One P2 requests a single private named type for logical
  definition state instead of repeated partial anonymous structures.
- Documentation: prior canonical-definition wording is resolved. One P2
  requests that `maxBackendEnvelopeBytes` describe all per-node native
  envelopes, not recovery only.
- TypeScript/API docs: real per-node envelope enforcement is resolved. Three
  P1 findings remain around post-create compensation, retry-safe recovery, and
  the intentional public coordinator contract break; one P2 requests the
  remaining coordinator method TSDoc.
- Performance/reliability: activation lifetime and bounded cleanup are
  resolved. Three overlapping P1 findings remain around post-create
  compensation, live-lease recovery, retry-safe rehydration, and ordered
  startup rollback.

Focused reviewers retained their original explicit configured profiles. The
surface still exposes no independent runtime self-introspection and no profile
mismatch was visible. Targeted verification passed 316 tests.

## Final Narrow Correction Batch

1. Compensate through the logical coordinator after every failure that follows
   successful native creation, including expiry discovered after creation and
   durable binding persistence failure. Dispose every installed child and
   remove the unbound logical definition. Replace the test that currently
   expects no compensation with integration coverage through the dynamic
   coordinator.
2. Make durable recovery respect active leases. A second Gateway must not
   reclaim a definition while its current owner lease is live. Graceful
   shutdown durably relinquishes only this instance's owned active leases so a
   replacement Gateway can recover immediately; crash recovery waits for lease
   expiry.
3. Make recovery claim and rehydration retry-safe. Concurrent recovery obtains
   one fenced claim; failed native rehydration restores a state visible to the
   next recovery, while successful rehydration commits the inactive definition
   used by immediate client Activate. Test failure, restart, changed
   membership, and immediate activation.
4. Make Browser startup rollback ordered and phase-safe. Attempt every relevant
   cleanup phase and aggregate primary recovery plus rollback failures instead
   of suppressing cleanup errors or running dependent phases concurrently.
5. Record and document the intentional public TypeScript replacement of
   `SubscriptionGateway`'s native creator input with the logical
   `SubscriptionCoordinator`. No compatibility adapter or deprecation cycle is
   required because the repository has no deployed users.
6. Introduce one private named logical-definition state type in the dynamic
   owner and use it consistently across helpers.
7. Correct `maxBackendEnvelopeBytes` wording and add semantic TSDoc for every
   public dynamic coordinator method and affected native method.
8. Run focused regression tests and the complete affected preflight, update
   records, and request acceptance re-review only for these affected concerns.

## Correction Implementation Evidence

- The complete accepted batch is implemented through `e5c05ba7`. Public
  Gateway coordination receives logical definitions only; native envelopes are
  created, bounded, and compensated per application node.
- Activation remains open while updates flow and terminates only when its
  admitted lifecycle signal ends. Cancel aborts and disposes active children.
- Durable v4 recovery is bounded, rehydrates current membership, permits
  immediate reconnect, and rolls Browser startup resources back on failure.
- Focused correction preflight passed 7 suites / 371 tests, generated
  typechecking, scoped lint/TSDoc, documentation audience checks, and diff
  validation. The next action is targeted re-review, then release verification.
