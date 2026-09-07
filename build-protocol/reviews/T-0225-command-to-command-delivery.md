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

## Registry type correction checkpoint

The implementation owner found that statically coupling v3/v4 at the top level
also affects exported nested handler-group and input-record SPI types plus
context-discovery consumers. A partial top-level-only union would leave an
incoherent public contract.

The existing `requirements_splitter` architecture context is therefore assigned
a second read-only, bounded checkpoint to specify the smallest compatible nested
discriminated-union design and migration. Its original explicit
`gpt-5.6-sol`/high dispatch remains active and unchanged; it must not edit files
or spawn subagents. Runtime self-introspection remains unavailable with no
visible fallback.

## Correction and re-review state

The implementation owner corrected the complete accepted batch and the final
cheap preflight passed on `e25fb12ad`: the canonical generated-state task gate
with 17 focused paths completed successfully, followed by full ESLint, cleanup,
TSDoc, formatting, and diff checks. The worktree was clean and the branch matched
the official remote.

All five original concerns were substantively affected, so the same existing
review contexts are assigned bounded re-review over
`e37ec8a1fed84f11e0df07c78846d5607a698ede..e25fb12ad`. Their original explicit
profiles remain unchanged: correctness function, style/maintainability, and
performance/reliability use `gpt-5.6-terra`/high; TypeScript/API docs uses
`gpt-5.6-terra`/high; reader documentation uses `gpt-5.6-luna`/medium. All are
read-only and may not spawn subagents.

## Review convergence

- Correctness/compatibility: clean after empty runtime output was rejected
  before Aggregate and Process Manager persistence; 304 focused tests passed.
- Style/maintainability: clean after domain Command fixtures, discriminated
  registry types, and the package-root metadata export were corrected.
- TypeScript/API documentation: clean after SPI typing, generated writer,
  package exports, decorator TSDoc, registry docs, and API output converged; 322
  focused tests passed.
- Reader documentation: clean after one-or-more output, diagnosed containment,
  close drain, registry compatibility, and the post-commit best-effort crash
  window were documented.
- Performance/reliability: the first re-review found that a later lint edit had
  removed `async` from a Command Bus test callback, preventing that file from
  parsing. Commit `54def610e` restored the callback, reproduced the zero-test RED,
  and passed all 16 Command Bus tests plus 595 tests in the expanded focused
  matrix. The final bounded reliability re-review was clean.

All canonical review concerns now have a clean or justified N/A disposition.
No reviewer edited files or spawned subagents. Runtime self-introspection was
unavailable for every review; explicit dispatch fields, immutable profiles, and
the absence of visible fallback provide the accepted metadata evidence.

## Release disposition

The first `pnpm verify:release` run passed all 288 test files and 4,575 tests but
correctly failed the global branch threshold at 89.96% (13,173 / 14,642).
Behavioral boundary tests then covered closed and invalid internal Command Bus
follow-up access plus three non-authentic readiness shapes. This deterministic
test-only correction did not reopen a specialist concern.

After the bounded preflight passed 645 tests in 21 files, the corrective release
run passed all 288 test files and 4,576 tests. Global coverage passed at 93.29%
statements, 90.00% branches, 92.87% functions, and 94.45% lines. The accepted
branch is ready for human review and remains unmerged.

## Human-requested independent review reset

The human requested a new review that does not inherit implementation memory.
The fixed comparison is
`origin/master@e37ec8a1fed84f11e0df07c78846d5607a698ede...8cef080b21358d6eb9ed488a098fdeabfbd788d7`.
Every reviewer is dispatched with `fork_turns="none"`, must read the repository
instructions, task/spec records, diff, and affected code directly, and remains
read-only. Capacity may split dispatch into parallel groups, but findings are
collected into one complete wave before implementation receives one batch.

Assignments and explicit profiles:

- Specification/correctness review: orchestrator-dispatched senior correctness
  function, `gpt-5.6-terra` / `high`; checks the T-0225 acceptance criteria,
  JVM parity, DDD/Proto correctness, registration, execution, routing,
  transactions, metadata, and tests.
- Standards review: existing `style_maintainability_reviewer`,
  `gpt-5.6-terra` / `high`; checks the milestone diff against `AGENTS.md`,
  `BUILD_PROTOCOL.md`, code-quality rules, and local conventions.
- Performance/reliability review: existing
  `performance_reliability_reviewer`, `gpt-5.6-terra` / `high`; checks queueing,
  ordering, idempotency, failure containment, persistence, shutdown, and bounded
  work.
- TypeScript/API documentation review: existing
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / `high`; checks public and
  serialized contracts, registry compatibility, exports, declarations, and
  runtime/type agreement.
- Reader documentation review: existing `documentation_reviewer`,
  `gpt-5.6-luna` / `medium`; checks changed user workflows, examples,
  limitations, links, and claims against the implementation.

The Desktop execution surface supports these explicit dispatch fields. Runtime
self-introspection will be recorded if exposed; otherwise the immutable role
profile and absence of visible fallback are the acceptance evidence.

## Independent review findings

All five memory-isolated reviewers completed. Their model and reasoning fields
were explicit in dispatch, no visible fallback occurred, and runtime
self-introspection was unavailable. The complete deduplicated correction batch
is:

1. Reject command-input `@Command` transformations on Projections. Registry
   ingestion currently accepts them and command readiness advertises them, but
   repository dispatch has no Projection command execution path, so an accepted
   client Command can be silently dropped.
2. Replace the new Command Bus follow-up tests that pack `ProjectionState` as a
   Command with a domain-correct generated Command fixture.
3. Replace the generated-registry transformation test that uses the
   `spine.core.Command` envelope schema as both input and output. Use distinct
   domain Command messages and an Aggregate or Process Manager owner.
4. Update `build-protocol/RUNTIME_ARCHITECTURE.md`: each Command type has one
   effective receptor, either `@Assign` or command-input `@Command`;
   Event/rejection-input `@Command` remains exclusively on the Event Bus.
5. Rename and complete the task's `Human-Imposed Requirements Ledger`, including
   inherited domain-correct fixture, return-shape, and receptor constraints.
6. Update `docs/api/README.md` from five to six handler metadata roles and name
   command transformation explicitly.
7. Replace the API README's v3-only registry SPI claim with the exact v3-read,
   v4-write contract.
8. Add the Command-input `@Command` workflow to the API README, including the
   optional `CommandContext` and non-empty Command output.
9. Add the detached in-process best-effort crash window and lack of durable
   child retry to the API workflow.
10. Update `build-protocol/DEVELOPER_API.md` from an unqualified version-3
    registry claim to v4 output with v3 legacy read compatibility.
11. Correct `GeneratedRegistryWriter` public TSDoc from version 3 to version 4
    and cover the public documentation assertion where practical.
12. Correct the API README's root-export claim: ingestion/discovery are root
    exports, while versioned generated-registry data contracts remain on
    `@spine-event-engine/server/spi/handler-registry`.

The performance/reliability lane found no defects after independently checking
reentrant follow-up admission, commit ordering, sibling fan-out, promise
containment, close/drain, durable duplicate Inbox handoff, crash-window claims,
tenant/metadata isolation, and bounded retention.

The implementation owner receives this as one correction batch. Correctness,
standards, TypeScript/API docs, and reader docs require bounded re-review after
the corrections; reliability re-review is required only if execution behavior
changes beyond rejecting the unsupported Projection configuration.

## Independent review convergence

The complete correction batch was applied before re-review. All re-review
contexts remained memory-isolated from implementation (`fork_turns="none"`),
read the repository and task records directly, and stayed read-only.

- Correctness/compatibility: clean. Projection transformations are rejected
  before readiness, while Aggregate and Process Manager transformations retain
  their command routing, transaction, and metadata behavior.
- Style/maintainability: clean after the test fixtures were renamed for their
  actual domain Command types and the generated Projection fixture was narrowed
  without an unsafe cast.
- Performance/reliability: clean in the first independent wave; no execution
  correction reopened this concern.
- TypeScript/API documentation: clean after the repository-kind restriction,
  two-argument `CommandContext` arity, v4-write/v3-read compatibility, and
  root-versus-SPI exports were documented.
- Reader documentation: clean after the Aggregate/Process Manager support
  boundary and Projection construction-time rejection were made explicit.
- Security: N/A for the unchanged reason above.

The final bounded preflight passed all static, generated-build, documentation,
package-consumer, and release-readiness checks plus 356 focused tests in six
files. The authoritative `pnpm verify:release` run then passed 288 test files
and 4,578 tests. Coverage passed at 93.29% statements (22,337 / 23,942), 90.01%
branches (13,183 / 14,646), 92.87% functions (5,477 / 5,897), and 94.45% lines
(20,710 / 21,925). No independent finding remains open.
