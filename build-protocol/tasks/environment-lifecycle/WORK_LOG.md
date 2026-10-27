# Environment lifecycle work state

## Current checkpoint

Started 2026-10-27 from freshly fetched official master
`ff6c8669537a016c47f012150306500d3b52b5d1`. Branch `environment-lifecycle` is in
`/Users/armiol/.codex/worktrees/environment-lifecycle/spine-ts`.
Checkpoints `c0c312b57`, `6ccfc3efc` and `f8a663cbe` were pushed to official
`origin/environment-lifecycle`. They contain initial repository and EventStore
retention, safe closure, repository query/history retention and the accepted
task specification. No PR has
been created. Full-task acceptance remains pending.

Repository query/history retention has converged after focused verification and
independent review. Protected Agent history and Entity maintenance operations
now share admission and shutdown tracking; see REVIEW_LOG.md. This checkpoint
was committed and pushed as f8a663cbe. AnyPacker implementation and caller adoption are now complete. The correction
preflight, targeted API/reliability reviews and final changed-path coverage
confirmation passed; checkpoint push is next. The prior checkpoint remains
independently reviewable.
No compatibility alias or provider workaround was introduced.

## Accepted retention decisions

- Repository cache lookup precedes construction; failed partial acquisition closes
  resources already opened and preserves acquisition plus cleanup errors.
- EventStore retains record storage per complete tenant identity and fixed group.
  Normal close returns a promise, fences new physical operations, drains admitted
  batch/check/query groups and attempts every retained close. Provider-only
  eventStoreAccess.closeIdle supports synchronous idle construction rollback.
- The acceptThenAppend callback runs outside a physical storage operation. A
  callback can await close; its later insertion then rejects without deadlock.
- Repository read/write access shares Entity storage by canonical tenant, model
  and captured history boolean. Reads do not open commit ports. A failed upgrade
  preserves prior read storage and closes only newly acquired resources.
- Agent audit history is retained separately from the state-history setting.
  No recovery-only execution-read cache is introduced.
- Changing the history setting retains both possible configurations. Future
  acquisitions select the current setting; an acquired commit uses its captured
  storageInput.stateHistory. A synchronous setting change never closes active
  resources.
- Ordinary clearRuntime detaches admission, drains direct operations, closes the
  retained Process Manager EventStore, then attempts every physical port close.
  Normal context cleanup starts all repository drains and removes registration
  records in finally. Idle rollback remains internal and synchronous.
- Entity-bound callbacks capture the exact repository lifetime, so old Entity
  instances cannot use storage after closure or rebinding. Protected Agent audit
  and Entity maintenance paths enforce this same rule.
- Agent recovery removal precedes shared saved-work scanning. Inbox/shard retention
  lands with the complete Delivery shutdown chain.

## AnyPacker decision and next implementation

D-0147 and TASK.md record the human requirement: use JVM-like AnyPacker throughout
instead of a Datastore native-key workaround. No workaround was implemented.
The architecture pass inspected local JVM AnyPacker and JsonFormat behavior.
Packing an existing Any returns the same object and preserves its URL and bytes.
Packing a normal message derives its descriptor URL and preserves unknown binary
fields. Typed unpack checks the complete URL; registry unpack honors the exact
registered URL. Optional unpack helpers return undefined for absent/invalid data.

Domain validation stays explicit at signal/API entry points, including existing
validate:false behavior. AnyPacker performs Protobuf conversion. Unrelated
record/transport serialization policies remain unchanged. Shared Stringifiers
must preserve each actual JSON @type occurrence, including Any values inside
packed payloads, repeated/map/oneof fields and well-known JSON shapes. Arbitrary
Struct/Value data containing @type stays ordinary data. Proto JSON does not promise
preservation of unknown binary fields.

Existing implementer storage_retention (immutable explicit gpt-6-sol/medium)
starts with core source, focused tests/fixtures and core README/REFERENCE, then
adopts the helper across production, normal tests and examples. Preserve malformed
and wire-preservation fixtures when their raw values are the test subject. Remove
AnyMessages without a compatibility wrapper. No new dependency is needed.
Estimated added work: 1.5–3 hours including adoption, tests and independent review.

## Provider baseline and confirmed defects

Dedicated task containers remain available for subsequent provider checks; ports,
credentials and exact commands are recorded in external sql-baseline.md and
Datastore evidence. PostgreSQL 18.6 passed 12 live storage tests. MySQL 8.4.10 and
MariaDB 11.4.13 each passed 15 cases across base and targeted tenant runs. Datastore
Agent audit-history baseline passed; Entity history trim exposed two defects.

A nine-query trace confirmed that JSON decoding changes the Any ID URL. Deletion
then reconstructs a different database key and removes no record. Fix shared Any
handling, as directed by the human; do not carry native keys as a substitute.
Separately, trim repeatedly reads its first page. Keeping at least the page size
can make it remove nothing forever. Implement keyset continuation and a cumulative
retained count, with tests spanning pages. Inspect related truncate progress.
Required regressions include 129 states trimmed to one, retention spanning pages,
and deletion after custom Any URL round trips. No arbitrary loop limit or timeout
increase. No provider changes have been made yet.

Provider commit wrappers still recreate internal storage per commit. The next
provider slice must retain those ports and coordinate admitted commits with
factory shutdown. Preserve independent externally requested factory handles;
do not add global caching of all factory outputs.

## Verification evidence

Node 24.18.0 and pnpm 11.9.0; frozen dependency installation, baseline Proto
generation and build/tooling typechecks passed. First EventStore preflight passed
386 focused tests. The close-race correction passed 523 tests and affected
checks; the final provider-only cleanup seam passed 534 tests and API confirmation.
Changed EventStore branches were inspected with focused coverage. Two Agent tests
also exercised awaited testing-helper cleanup.

Repository read-retention preflight passed 478 tests initially and 483 after
mechanical corrections, with server typecheck, ESLint, cleanup, TSDoc, formatting
and diff checks. Focused coverage thresholds were disabled only for inspecting
changed branches; no global coverage claim is made. Specialist review selected
434 tests plus 25 Entity tests, all passing. All accepted findings are resolved. The final naming correction passed 37
affected tests; independent final preflight confirmed new admission/maintenance
coverage and tooling/docs checks. Final release verification and security review remain pending.

Baseline generation refreshes tracked generationId stamps; those changes remain
excluded from retention commits. Raw logs, exact LCOV, diagnostic traces and
assignment details are outside Git in
`/tmp/spine-environment-lifecycle-20261027`. Key reports: repository-read-retention.md,
repository-read-independent/, provider-retention-next-slice.md, sql-baseline.md,
datastore-short-trace.log and any-packer-inventory.md.

## Assignment evidence

| Existing role or dispatched function | Agent                    | Explicit configured profile | Scope                                                                           |
| ------------------------------------ | ------------------------ | --------------------------- | ------------------------------------------------------------------------------- |
| requirements_splitter                | application_architecture | gpt-6-astra / high          | Frozen architecture; demonstrated close defect; human AnyPacker contract change |
| implementer                          | storage_retention        | gpt-6-sol / medium          | Retention, accepted corrections, next AnyPacker implementation                  |
| Mechanical/scanning function         | mechanical_checks        | gpt-6-luna / low            | Focused preflight/coverage, provider baseline, Any caller inventory             |

Model and reasoning were explicit at dispatch and immutable on reuse. Runtime
introspection is unavailable. Specialist assignments and dispositions are in
REVIEW_LOG.md. No child delegation occurred. JVM guardrails include core-jvm
Repository.storage()/close(), Delivery retained InboxStorage, EventBus and storage
close; AnyPacker uses local base-libraries/base/.../protobuf/AnyPacker.java.

## Next actions

Complete AnyPacker core/JSON behavior, full caller adoption and independent review,
then commit and immediately push. Continue MILESTONES.md
through provider preparation, TenantIndex, context registration, Agent recovery
removal, shared environment/Delivery and startup behavior. Keep narrow API docs
current; finish broad examples after interfaces stabilize. Run final release,
security and exact-SHA CI gates, select the required unused common workspace
version and push every feature commit. No existing-data migration, PR creation
or master write is authorized.

## Provider close question for the next milestone

Read-only provider analysis demonstrated that PostgreSQL factory shutdown closes
inner RecordStorage directly even when a retained commit is still using it. Its
current close API returns void and suppresses the internal drain rejection. The
existing requirements_splitter application_architecture (explicit immutable
Astra/high) receives only this concrete admission/close question across providers,
with no source edits. Decide the smallest safe contract before provider retention;
ordinary work remains with the implementer. Expected analysis 0.15–0.3 hours,
within the overall estimate. This does not delay the AnyPacker milestone.

Provider close decision accepted after source inspection: StorageFactory.close
and provider-only EntityCommitStorage.close return Promise<void>, with a
synchronous admission fence and asynchronous completion. RecordStorage close
stays synchronous. Commit wrappers drain before releasing their private records;
factory teardown does not close those records independently. Guarded internal
idle cleanup supports current synchronous rollback. Cleanup failures belong to
close promises, preserving completed commit results. Concrete paths and tests
are in external provider-close-contract.md; implement after AnyPacker.

While AnyPacker implementation proceeds, mechanical_checks (same explicit
immutable Luna/low profile) performs read-only source inventory for the later
Agent recovery removal: scheduler/claims/replay/outgoing-obligation contracts,
references, provider schemas/tests and shared audit-history dependencies. This
is a source map, not a new architecture pass or permission to edit recovery code.
Store evidence externally; the original complete removal requirements remain in
PROPOSAL.md. No child delegation or simultaneous production writer.

AnyPacker adoption uses a final mechanical source audit of handwritten Any
encoding/decoding, including fromBinary(schema, any.value) patterns. Existing
mechanical_checks (explicit immutable Luna/low) separates genuine Any payload
conversions from ordinary typed record/transport serialization and opaque copies.
Source inspection only while the implementer finishes checks; report candidate
callers for confirmation, without automatic replacements.

The final Any source audit found additional payload decoders in delivery,
integration and provider history. The implementer receives one confirmed
adoption batch, preserving optional/error behavior and opaque envelope copies.
Core JSON restoration retains its descriptor-based handling of original URL
aliases. The conformance fixture's StringValue-as-Entity-state use requires a
domain-correct replacement if modified. Estimated completion of this batch is
0.3–0.6 hours within the Any milestone. Before this batch, broad core/server
verification passed 2,557 tests; other affected packages passed 2,040 tests. Two
Node-runner tests require their native runner. Full release verification remains
pending.

A concrete fixture packaging blocker requires a bounded architecture decision:
published EntityHistoryConformance currently hardcodes StringValue as Entity
state. Storage has no published generated fixture target; embedding fileDesc
payloads violates the build protocol, while importing server test fixtures into
production violates package boundaries. requirements_splitter receives only this
question with explicit gpt-6-astra/high, no edits or delegation. Estimate
0.1–0.2 hours for inspection/decision; ordinary Any adoption continues separately.

Mechanical_checks (same explicit immutable Luna/low) inspects changed core Any
branches with focused coverage while the writer finishes separate callers. Read
only: preserve existing test evidence, do not run full verification. Report
uncovered new behavior with source references for the pre-review gate.

Fixture decision accepted as D-0149: generic adapter-supplied generated state,
using the existing core ProjectState fixture in tests. The explicit Astra/high
requirements_splitter provided the concrete contract; no runtime metadata is
exposed. Independent core preflight passed 111 tests in four suites with changed
branch coverage inspected. Add assertions for the missing-message and unknown
registered-URL error paths before review; no repository coverage claim.

Any correction coverage run passed 227 tests in six suites. Existing mechanical
function mechanical_checks (explicit immutable Luna/low) inspects exact LCOV for
optional Any absence, standalone prepublication validation, Any-ID storage and
subscription selection, and decisive conformance filtering. No test rerun or
source changes; final build/tooling/docs checks run sequentially in implementation.

Any corrections passed the targeted API and reliability reviews with no remaining
findings. The original 227-test LCOV contains overlapping old/new source mappings
for Entity ID extraction. Mechanical inspection therefore reruns only the real
storage-backed Any-ID subscription test against the freshly built outputs before
concluding whether a branch is uncovered. Do not add a test solely to satisfy
misaligned counters. Current docs no longer advertise removed AnyMessages APIs.

Final Any-ID evidence correction passed: generated ProjectEnvelopeState writes
and reads through real in-memory storage and the descriptor codec, preserving
ProjectOverviewId Any and rejecting an unequal lookup. The two narrow tests and
tooling/format/lint/diff checks passed; fresh LCOV confirms descriptor execution.
All AnyPacker review concerns are accepted. Next: checkpoint/push, then D-0148
provider lifetime/retention work. Full release/security remain pending.
