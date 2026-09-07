# T-0225 Command-to-Command Delivery Review

## Architecture checkpoint

The first GREEN attempt exposed same-runtime Command Bus reentrancy when a
command-input `@Command` handler posts its transformed Command after committing
the current Entity transaction.

The existing `requirements_splitter` role is assigned a read-only architecture
checkpoint covering the smallest compatible follow-up enqueue seam, transaction
ordering, failure behavior, Inbox/retry semantics, causal metadata, and JVM
command-substitution parity. Expected model `gpt-5.6-sol` and expected reasoning
`high` are explicit in the dispatch. The role must not edit files or spawn
subagents.

The checkpoint accepted the existing package-owned path:
`runtimeAccess.enqueueFollowUp()` through
`commandBusAccess.postInternalFollowUp()`. Child envelopes are derived and
packed inside the Entity transaction, Entity state commits, and the returned
detached Inbox callback enqueues the children. The active Command Bus item must
not await a same-runtime child.

The callback must invoke child posts in declaration order, collect every
completion, then await them together. Sequential await would stop sibling
admission after the first failure; discarded promises would create unhandled
rejections. Existing Inbox containment and diagnostics remain authoritative.

The checkpoint also established these mandatory corrections:

- Command substitution produces one or more Commands. JVM
  `CommandSubstituter.fromEmpty()` and the current TS analyzer both reject zero
  output, so task acceptance criterion 4 must be corrected rather than widening
  the public contract.
- A serialized `command-transformation` kind cannot be added under registry
  version 3. The format must advance atomically or avoid a serialized-shape
  change.
- Public assignment lookup must not silently change meaning; transformation
  lookup needs a clearly named receptor seam or a preserved assignment-only API.
- Remove heuristic or unused event-input classification.
- Prove duplicate/mixed receptors, event/rejection regression, true public
  client posting, ordered fan-out, failure observation, metadata lineage,
  immediate close/drain, and durable source-row retry behavior.
- The post-commit in-process callback is best-effort, not an atomic outbox. T-0225
  must not claim durable exactly-once delivery across a process crash between
  commit and enqueue.

Runtime self-introspection will be recorded when exposed. Otherwise, the
immutable configured role/profile and explicit dispatch fields are the accepted
metadata evidence.

## Implementation continuity

The original implementation owner completed and pushed the runtime, reference,
Aggregate, and rollback increments, then exhausted its execution window while
scoping the remaining metadata fixture. It left no uncommitted production or
test changes.

A replacement existing `implementer` role owns the remaining focused tests,
corrections, documentation reconciliation, and implementation records. Expected
model `gpt-5.6-terra` and expected reasoning `medium` are explicit in the
dispatch. The replacement must not spawn subagents. The original owner is idle,
so production ownership does not overlap.

## Canonical review dispositions

- Correctness/compatibility: pending after mechanical convergence.
- Style/maintainability: pending after mechanical convergence.
- TypeScript/API documentation: pending after mechanical convergence.
- Performance/reliability: pending after mechanical convergence.
- Reader documentation: pending after mechanical convergence.
- Security: N/A as a separate lane because this correction adds no credential,
  authorization, or external trust boundary. Remote rejection behavior remains
  a correctness concern.

## Mechanical preflight assignment

The orchestrator-dispatched verification function will run the cheap static
gates, focused handler/repository/black-box suites, and source-scoped coverage
before specialist review. Expected model `gpt-5.6-luna` and expected reasoning
`medium` are explicit because selecting valid changed-source coverage from the
shared server module requires classification judgment. The function is
read-only, must not spawn subagents, and may not edit or commit files.

The preflight function completed with its explicit Luna/medium dispatch. Runtime
self-introspection was not exposed and no visible fallback occurred. Focused
behavior tests passed 435/435, but the preflight is not accepted yet:

- TypeScript compilation found nine readiness fixtures missing
  `commandTransformations` and two unsafe test dereferences.
- Formatting failed for eight files; ESLint reported nine errors; cleanup naming
  rejected `internalCommandFollowUpPosters`; TSDoc found incomplete public
  comments in handler metadata.
- Copyright, documentation audience, API docs, Proto lint/generated cleanliness,
  logging containment, production dependencies, and release readiness passed.
- Source-scoped coverage is above 90% for the registry writer, generated registry,
  handler metadata, and readiness metadata. Command Bus branch coverage,
  command readiness, repository, signal metadata, bounded-context wiring, and
  decorator coverage still need valid changed-line evidence or additional tests.

Proto generation changed six tracked random generation IDs under the orders,
projects, and todo examples. These are setup artifacts, not accepted task
changes, and must be restored before the corrected preflight.

## Corrected preflight

After correction, the canonical generated-state task preflight passed every
static, documentation, generated-output, and release-readiness gate. The
expanded focused run passed 574 tests with zero failures. Source-scoped evidence
covered the new transformation helpers and branches; the complete release gate
remains responsible for the repository-wide 90% threshold because shared
`repository.ts` and bounded-context files contain substantial unrelated runtime
code.

## Specialist review wave assignments

All reviews are read-only over
`origin/master@e37ec8a1fed84f11e0df07c78846d5607a698ede..bd0e66549b285207bd187193eac381b122809ed4`.
Reviewers must not edit files or spawn subagents. Actual runtime metadata will be
recorded if exposed; otherwise explicit dispatch fields and immutable role
profiles are the acceptance evidence.

- Correctness/compatibility verification function: command registration,
  execution, routing, JVM parity, registry v3/v4 compatibility, and behavior
  tests; model explicitly `gpt-5.6-terra`, reasoning explicitly `high`.
- Existing `style_maintainability_reviewer`: changed runtime, generator, and
  tests; immutable configured `gpt-5.6-terra`, reasoning `high`.
- Existing `performance_reliability_reviewer`: queueing, transaction boundary,
  failure observation, drain, retry, and bounded-resource behavior; immutable
  configured `gpt-5.6-terra`, reasoning `high`.
- Existing `typescript_api_docs_reviewer`: public decorator/metadata contracts,
  serialized registry version, declarations, and compatibility; immutable
  configured `gpt-5.6-terra`, reasoning `high`.
- Existing `documentation_reviewer`: reader-facing REFERENCE and architecture
  claims, especially best-effort post-commit semantics; immutable configured
  `gpt-5.6-luna`, reasoning `medium`.

The first documentation dispatch omitted the explicit tool fields despite
naming them in its prompt. It was interrupted before acceptance and replaced by
a fresh `documentation_reviewer` dispatch with explicit `gpt-5.6-luna` and
`medium` fields. No result from the invalid dispatch was used.

## Complete review wave findings

All five valid reviews completed. Runtime self-introspection was unavailable;
the explicit dispatches, immutable profiles, and absence of visible fallback are
the accepted metadata evidence. The complete accepted correction batch is:

1. Reject an empty normalized runtime transformation result before Aggregate or
   Process Manager persistence. Registry-declared emitted schemas do not prove
   that a handler's returned array is non-empty.
2. Replace the repository-routing test's cloned Entity-state descriptor with
   distinct domain-correct Command input and output messages.
3. Model generated registry v3/v4 as a version-discriminated TypeScript union so
   a v3 registry cannot type-check with a v4-only transformation record; retain
   runtime compatibility tests.
4. Export `CommandTransformationHandlerMetadata` from the supported server
   package root and cover the export.
5. Update public decorator TSDoc and the SPI reference's stale version-3 claim.
6. Preserve post-commit failure containment but report transformed-child failure
   through an existing bounded diagnostic/logging seam with useful source/child
   identity. Do not leave a silent catch, claim source-command failure
   propagation, or add an atomic-outbox promise.
7. Add direct Aggregate multi-child proof for FIFO sibling admission, rejection
   observation/diagnosis, committed source state, and immediate-close drain.
8. Correct reader/reference and work-log claims: transformation output is
   non-empty; accepted follow-ups drain on close; detached enqueue is in-process
   best-effort and can be lost in the commit-to-enqueue crash window; it is not
   atomic outbox or durable exactly-once delivery.

No separate security finding was raised. The task adds no new authentication,
authorization, credential, or external trust boundary; remote-input rejection
remains covered by correctness and public-service tests.
