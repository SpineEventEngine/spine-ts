# Environment lifecycle work state

## Current checkpoint

Started 2026-10-27 from freshly fetched official master
`ff6c8669537a016c47f012150306500d3b52b5d1`. Branch `environment-lifecycle` is in
`/Users/armiol/.codex/worktrees/environment-lifecycle/spine-ts`.
Latest accepted checkpoint `abb145983` is pushed to official
`origin/environment-lifecycle`. Repository/EventStore/query/history retention,
shared AnyPacker, provider commit retention/shutdown, memory/SQL/Datastore
preparation, and public live TenantIndex/native membership are complete.
M5b tenant input checks and identifiable errors are verified and reviewed; the
authored checkpoint is ready for commit/push. M6 strict state registration is next.
Unconditional duplicate-state registration (including tests), Agent recovery
removal, shared environment/Delivery, explicit/lazy initialization, subscription
monitoring, environment tenant preparation and final integration follow in
MILESTONES.md. No PR has been created. Full-task release/security/CI acceptance
remains pending.

The sections below retain earlier decisions and implementation evidence; later
accepted checkpoints supersede earlier next-step wording. Current scope and
human requirements are maintained in TASK.md and PROPOSAL.md.

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

## AnyPacker implementation record

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

AnyPacker is reviewed and pushed at 0974d7627. Complete provider retention,
awaitable cleanup, and Datastore trim with focused/live tests and independent
review, then commit and immediately push. Continue MILESTONES.md through factory
preparation, TenantIndex, context registration, Agent recovery removal, shared
environment/Delivery and startup behavior. Keep narrow API docs
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

## Active provider milestone

AnyPacker checkpoint 0974d7627 is pushed. Continue D-0148 and milestone 3 with
the existing implementer storage_retention (explicit immutable Sol/medium).
Estimated 2–4 hours for shared awaitable shutdown, retained internal records in
memory/PostgreSQL/MySQL-MariaDB/Datastore, Datastore trim pagination, focused and
live provider checks, reviews and checkpoints. Follow the accepted external
provider-close-contract.md; no new architecture pass without a concrete blocker.
Start with awaitable close propagation and memory retention, keeping all built-in
providers/callers compiling and current close outcomes observable. Then retain
SQL and Datastore commit records in bounded patches and fix independent trim
pagination. No ordinary RecordStorage close contract change, generic lifecycle
framework, migration, Agent recovery extension or provider Any workaround.

Behavior acceptance: retain each used family once, acquire optional families only
when used, drain admitted commits before child/pool closure, synchronously reject
new work on close, preserve retries and captured inputs, attempt every cleanup
and expose all failures, roll back only newly acquired partial families and allow
retry. Keep independent public handles and borrowed ports independent. Internal
idle cleanup remains guarded for synchronous rollback. No full release gate yet.

In parallel, mechanical_checks (same explicit immutable Luna/low) inventories
factory/EntityCommitStorage close callers at immutable baseline 0974d7627. Focus
on discarded completion in callbacks/finally/teardown and synchronous rollback
callers; distinguish existing returned/awaited calls. Read-only evidence for the
writer, not a new architecture decision or independent implementation stream.

Provider baseline tests first failed for intended reasons: two current-only
commits created two memory Entity stores, and factory close did not fence a
previously issued commit handle while a write was gated. Shared-close/memory
implementation is active. Read-only caller inventory is accepted from the explicit
Luna/low function: repository ordinary versus idle cleanup, memory/PostgreSQL
Agent finally blocks, Datastore bundle propagation, direct tests/examples and
custom factory overrides need attention. Evidence is external
provider-close-callers.md; no new architecture decision or child edits.

Provider contract intermediate evidence: storage/all three persistent provider/
server package typechecks pass. Memory commit suite passes 29 tests. Four focused
provider suites pass 79 tests after preserving asynchronous commit rejection and
confirming PostgreSQL pool close follows admitted writes. The writer is tightening
cleanup failure aggregation and caller propagation before freezing the coherent
shared-close/memory-retention slice. SQL/Datastore internal record retention and
Datastore trim remain subsequent patches; no provider milestone commit yet.

Provider sequencing refinement: after shared-close/memory behavior and typechecks
are green, continue bounded PostgreSQL, MySQL and Datastore retention patches in
the same implementation context. Review the coherent milestone after those
related lifetime classes converge, rather than review signatures immediately
before editing them again. Earlier focused review remains available for a
concrete correctness blocker. Datastore pagination can close separately if its
diff is independently substantial. No extra implementation stream or commit yet.

Lifetime inspection confirmed two implementation defects during this slice:
memory acquisition ran before the admitted Promise was tracked, and idle cleanup
stored an already-rejected Promise. Correct before review: record admission before
backend callbacks and retain idle failure synchronously until an ordinary async
close is requested. Focused gated tests establish the required behavior.

Provider checkpoint: shared-close/memory focused suites pass 79 tests and affected
package typechecks/cleanup checks pass. PostgreSQL retention regression failed as
expected with two record closes before wrapper close, then passes with retained
current storage. Its 16 commit tests and package typecheck pass. Optional-family
rollback and cleanup diagnostics remain under implementation before MySQL and
Datastore retention. No review or provider commit yet.

While the writer finishes milestone 3, mechanical_checks (existing read-only
function, explicit immutable gpt-6-luna/low) inventories milestone 4 preparation
entry points at committed 0974d7627: factory construction connections, record
initializers, provider catalog/tenant settings, and existing tests. This is source
mapping only; accepted architecture remains unchanged, no source edits or tests.
Results are external to version control and feed the next bounded implementation
brief. Runtime metadata remains unavailable beyond the configured dispatch.

MySQL retention checkpoint: mocked repeated commits first failed with 12 premature
record closes, then passed after current/delivery records and lazy histories were
retained. A real MysqlEntityStorage test covers partial optional-family rollback
and retry without duplicate acquisition. Two focused suites pass 7 tests and
MySQL typechecking passes. PostgreSQL optional-family rollback/retry also passes.
Writer proceeds with Datastore, then narrow TSDoc/caller propagation and preflight.

Accepted the read-only factory-preparation map from mechanical_checks at immutable
0974d7627. Confirmed explicit Luna/low dispatch and no source changes; separate
runtime metadata unavailable. The map identifies builder connection probes and
coupled creation/verification in PG/MySQL, plus provider-native catalog and test
seams. Its final claim that the TS resolver contract is unsettled is not accepted:
the human approved setTenantResolver(tenantId => options). The proposal only says
JVM JDBC does not already establish that API. No product question is reopened.

Datastore retention checkpoint: repeated commits first opened current storage
twice, then passed with retained current and lazy optional records. Entity-history
suite passes 31 tests; combined factory/history suites pass 41; package typecheck
passes. Built-in commit capability avoids discarding a whole read bundle; custom
creator selection remains tracked. The memory reentrant admission and idle-close
failure tests now explicitly pass 2/2. Writer continues caller awaits, Datastore
trim and coherent preflight before independent review. No M3 commit yet.

Datastore trimming regression reproduced repeated first-page reads for 257 records
retaining 129. The 129-to-1 case already passed after shared AnyPacker correction.
Keyset cursor progress now passes all 33 Entity-history tests. No native-key
identity workaround or existing-data conversion was introduced. Named memory
regressions are `registers reentrant acquisition before close` and `reports idle
cleanup synchronously without orphan rejection`; both pass. Integration/caller
checks continue before the frozen review input.

A gated Datastore bundle-close regression exposed premature synchronous read-port
closure while a commit was active. Bundle shutdown now fences commits immediately,
awaits their drain, then closes read records and aggregates both cleanup failures.
The new test failed before the correction; all 34 history tests now pass. Caller
propagation/docs and deterministic checks remain before the review wave.

A demonstrated custom-provider contract blocker needs a bounded architecture
review, estimated 0.15–0.3 hours within M3. The existing Datastore custom Entity
creator returns a bundle; returning only bundle.commits leaves extra read/history
resources until factory close. Ordinary commit close can await bundle closure,
but synchronous repository rollback has no original bundle idle-close contract.
The in-progress optional closeIdle member is not an accepted decision yet. Do not
silently discard a Promise or merely report unsupported cleanup while leaking the
bundle. requirements_splitter custom_provider_cleanup uses explicit
gpt-6-astra/high, read-only, no subagents, to settle the smallest provider contract
and lifetime rules. Ordinary caller/TSDoc fixes continue with the sole writer.

Accepted custom_provider_cleanup requirements-splitter decision after reading its
source-backed report; explicit Astra/high dispatch confirmed, separate runtime
metadata unavailable. No repository edits/tests by that role. D-0148 now requires
async normal bundle close and mandatory internal idle cleanup. The custom commit
adapter delegates closure to the entire bundle, with one factory disposal root.
Idle cleanup must reject active work or unfinished async cleanup before release;
all paths preserve cleanup outcomes and attempt every release. No optional-method
fallback, custom-provider bypass or generic lifecycle class. Exact paths/tests
are in external custom-provider-cleanup-decision.md; sole implementer continues.

M3 runtime/test freeze: the custom Datastore bundle contract and one-path disposal
are implemented. Red custom individual-close and admitted-bundle tests now pass;
six focused suites pass 103 tests. Affected package/tooling typechecks, TSDoc and
cleanup checker pass. Writer restricts remaining edits to narrow docs/formatting.
Independent mechanical preflight begins with mechanical_checks, reused explicit
immutable Luna/low profile, covering focused provider/repository tests, changed
production branch coverage, tooling/docs/lint and all four live database engines.
Use dedicated task containers only. No full release gate; one aggregate review
wave follows clean preflight. The current M3 remainder estimate is 1–2 hours for
custom cleanup integration, tests, specialist review and immediate pushed commit.

Independent preflight first result: 544/545 tests pass in 12 focused files. The
remaining assertion expects old per-tenant interleaving of Entity/commit cleanup
errors. Inspection confirms all four errors survive; commits now drain before
physical ports, as D-0148 requires. Correct the assertion without introducing an
unnecessary error-order promise. Writer's final lint inventory has 26 issues in
four files (external provider-eslint-remaining.log); 32 earlier floating test-close
calls were corrected and typechecked before the frozen run.

Orchestrator source inspection during that failure triage also confirmed
RepositoryStorage.closeLifetimePorts uses commits.map(commit => commit.close())
without capturing a synchronous throw. A custom provider can then prevent the
remaining commit and physical cleanup attempts. Include a focused synchronous
throw regression and preserve immediate fencing/attempt-all semantics in the
pre-review correction batch. Independent coverage/live checks continue first.

Live preflight: PostgreSQL 12/12, MySQL 15/15 and MariaDB 15/15 pass. Datastore
passes 12/13 including the former trim timeout; its failure is a read assertion
before unawaited async bundle close has settled. Update those close callers.
The touched live history fixture also still uses StringValue as Entity state
and manual Any helpers; replace it with existing ProjectState/ProjectId helpers,
shared AnyPacker, and domain-appropriate Events. Scalar record/ID fixtures remain
legitimate. The earlier residual Any audit explicitly covered production only;
normal provider test helpers still contain direct Any payload conversions. Extend
fixture adoption during this correction, preserving deliberate malformed/wire
encoding tests and avoiding a core/proto dependency inversion.

Independent preflight function complete and accepted with explicit Luna/low
configuration; runtime metadata limitation recorded. Full report is external
provider-preflight.md. Production/tests unfreeze for one pre-review correction
batch, estimated 0.4–0.7 hours: obsolete cleanup error-order assertion, live
Datastore awaited close and domain-correct fixtures/shared Any helpers, repository
synchronous close-throw containment, remaining 26 lint errors, and behavior tests
for required acquisition-plus-cleanup and multi-resource cleanup failure reporting.
Ordinary Any test helpers missed by the production-only adoption audit are included;
intentional malformed/raw encoding tests and package dependency direction remain
unchanged. Same implementer, no new writer or architecture pass. Re-run focused
affected tests/Datastore emulator and deterministic checks before review.

While the implementer corrects provider fixture helpers, mechanical_checks reuses
its explicit immutable Luna/low profile for a distinct read-only Any audit outside
storage packages: ordinary tests/examples versus intentional raw Protobuf or
malformed-envelope tests. The earlier residual audit covered production. Identify
only genuine remaining Any payload pack/unpack helpers, avoid raw RPC bytes and
core/proto dependency inversion, and save an external bounded caller list. No
source edits or duplicate provider-helper audit.

The corrected Datastore emulator run passes 13/13 tests, including the former trim
timeout and awaited bundle cleanup with domain-correct Project fixtures. The
read-only non-storage Any fixture audit is accepted as a caller inventory from
explicit Luna/low (metadata limitation unchanged). Ordinary helper conversions
remain in server/integration/delivery/transport tests and remote-app fixtures;
intentional malformed/wire/alias cases remain explicit. Keep M3's correction
bounded to provider fixtures. Finish the listed non-storage helpers with their
scheduled server/Delivery/fixture changes before final acceptance; do not reopen
completed production AnyPacker design or create core/proto dependency inversion.
The external any-fixture-adoption-audit.md is the exact pending list.

Correction evidence checkpoint: repository synchronous/async cleanup failure cases
both pass and preserve the exact four-error multiset. Six provider suites pass
109 tests including acquisition-plus-rollback, multi-record close and catalog
cleanup failures. Combined repository/provider coverage run passes 563 tests in
13 files; scoped ESLint is clean. Three test-only Any helper typing corrections
are awaiting the final tooling rerun. Fresh LCOV is external
provider-correction-coverage/lcov.info. Mechanical_checks (same explicit immutable
Luna/low) now inspects changed-branch evidence only, without duplicating active
writer typechecks or test runs, before the review wave.

Human correction during M3: duplicate domain Entity state types must always be
rejected, including tests. No disabling switch or test-only exception is allowed.
Source search confirms the planned switch/registry is not implemented yet; M6 is
pending. Updated TASK ledger, PROPOSAL, MILESTONES and D-0146 before implementation.
The internal state record therefore contains at most one domain context per type.
Do not add a Tests profile for this rule. Preserve System Context exclusion,
identity-based registration, early reservations, attempt-all cleanup and reset
protection. Tests close/reuse contexts or use distinct domain schemas; process
replicas remain separate environments. No new architecture pass is needed for
this simplification of an unimplemented contract. Work continues.

Provider correction freeze: 563 focused tests plus 15 additional Agent/provider
tests pass; all static/docs gates pass. Fresh live PG and Datastore each pass
13 tests; MySQL/MariaDB each pass 15 with a tenant-specific skip after replacing
stale task-test databases containing old handwritten Any URLs. Finish the skipped
tenant cases in fresh dedicated test databases before accepting live evidence.
No existing-data migration is involved. Writer is idle pending review/corrections.

Accepted corrected-coverage inspection from explicit Luna/low. Some earlier
failure tests exercise read storage rather than retained commit storage. Finish
only the concrete new-contract gaps in provider-correction-coverage.md: PG/MySQL/
Datastore acquisition-plus-rollback errors; MySQL/Datastore commit multi-close;
MySQL commit-plus-pool and Datastore bundle-plus-catalog aggregation; successful
custom bundle idle disposal and repeatable outcome. Continue the same pre-review
correction, estimated 0.2–0.4 hours including fresh tenant-isolation SQL tests.
No broader coverage matrix or unrelated baseline branch work. Same implementer;
review starts after this cheap preflight is clean.

Final pre-review acceptance: the remaining 3 focused suites pass 64 tests; parent
independently parsed fresh LCOV and confirmed all cited new failure/idle lines
have hits. Current AnyPacker tenant isolation passes separately on MySQL and
MariaDB with fresh dedicated tenant databases. Static gates remain clean; final
follow-up changed tests only. The one full review wave begins, estimated
0.3–0.6 hours including bounded corrections. Production/tests stay frozen until
all relevant review concerns are collected. Full release/security stay pending.

M3 review wave complete. Accepted one correction batch listed in REVIEW_LOG:
callback admission, settled-root removal, missing await callers and narrow docs.
Estimate 0.3-0.6 hours including focused tests and targeted review. Parent confirmed
row-validation ID callbacks share the capture admission defect. All current
production work remains assigned to one implementer; no architecture change or
full verification rerun is needed for this bounded correction.

M4 bounded contract planning while M3 corrections continue: the accepted async
application tenant resolver must coexist with synchronous createRecordStorage and
provider Entity factories. Current SQL layout binding assumes a resolved pool/
schema. Shared preparation also lacks an exact provider SPI for model requirements.
This is a demonstrated public/provider-contract gap, not a repeat of the full
accepted architecture pass. Dispatch requirements_splitter preparation_contract
with explicit gpt-6-astra/high to freeze the smallest coherent contracts and
implementation slices; read-only source, external design report only. Estimate
0.2-0.4 hours including source inspection and recommendation. No production
changes until M3 commits and the parent accepts this bounded recommendation.

M3 provider retention/lifecycle accepted after all four review concerns and
targeted correction confirmations. Current evidence: 104 focused tests with fresh
LCOV after final race test, earlier 111 affected tests, prior 563 combined tests,
all four live provider families, current build/tooling/lint/docs/format checks.
No physical I/O change followed live evidence. Final doc-only stale Datastore
paragraph corrected. Commit and push provider checkpoint; preserve generation-only
manifest changes for final convergence. No PR requested or created.

M4 bounded architecture accepted as D-0150 and FACTORY_PREPARATION.md. Explicit
requirements_splitter preparation_contract used Astra/high; runtime metadata
unavailable, immutable dispatch confirmed. The parent identified inconsistent
Datastore create/check proofs; same pass corrected them to identical documented
native structural facts, with application-managed index deployment outside that
proof. Five slices start with shared contract/memory. Existing JVM source paths
and inspection impact are recorded in the accepted design.

M3 checkpoint c03c9844b pushed immediately to official origin/environment-lifecycle.
Only generation-only manifest changes remain outside that commit.

M4a shared preparation contract and memory starts at c03c9844b. High-risk public/
provider contract, covered by D-0150's accepted bounded architecture. Existing
implementer storage_retention resumes with explicit immutable Sol/medium profile,
metadata introspection unavailable. Scope: storage package factory checkConnection,
provider-only preparation port, memory implementation/pure validation, focused
behavior tests and narrow README/REFERENCE/TSDoc. Exclude SQL/Datastore, server
readiness wiring and Agent recovery removal. No subagents or parallel writer.
Estimate 0.5-1.0 hours including tests, docs, deterministic checks and independent
review. Synchronous creation remains offline. Preparation never creates Storage,
application records or tenant membership; unsupported custom capabilities fail
clearly. Closed factories reject. Compatible definitions are reusable and
incompatible same-family layouts cannot reuse prior success. Avoid a generic
resource/lifecycle framework. Retained Storage behavior remains covered by M3.

M4a mechanical scope extension: new provider exports require the existing API
documentation checker's exact export inventory and its test to be updated. The
current TSDoc gate also flags one M3 Datastore retainCleanup summary verb. Same
implementer may correct that comment and checker expectations; no Datastore
runtime behavior or broader architecture change. Storage 305-test suite and
build pass; finish deterministic checks and current focused coverage before
review. These ordinary gate failures are resolved within the current slice.

M4a full review wave accepted four reliability corrections and one narrow TSDoc
clarification; style/API clean. REVIEW_LOG records exact findings and parent
coverage evidence. Same implementer receives one correction batch, estimated
0.2-0.4 hours; no SQL/server changes. Targeted reliability confirmation follows
focused tests and static checks.

M4a shared contract/memory accepted after complete review and one correction
batch. Final 309 storage, 353 repository-routing and 62 focused coverage tests
pass with static gates. Targeted reliability confirms all four findings resolved;
API/style clean and documentation accurate. Commit and immediately push this
bounded slice. SQL/Datastore checkConnection and preparation are not yet claimed.

M4a checkpoint 6991951cc pushed immediately to official origin/environment-lifecycle.
M4b PostgreSQL offline binding begins from that commit, same explicit immutable
Sol/medium implementer. High-risk public/lifecycle contract already frozen in
D-0150/FACTORY_PREPARATION; no repeat architecture pass. Estimate 1-2 hours for
SQL logical-handle binding, resolver/shared options, explicit remembered
connection check, close coordination, focused/live tests, docs and independent
review. Scope PostgreSQL source/tests/narrow docs plus deterministic API inventory
if needed. No MySQL/Datastore/server edits or model-preparation implementation.

Acceptance: unreachable correctly formed database options assemble offline;
no resolver or connection at build or Storage creation; shared check touches no
tenants and writes no data/DDL; temporary check pools end; first awaited tenant
use coalesces async resolution, reads actual default schema, validates separation,
clears failed attempts and drains admitted binding before factory close. Preserve
existing table resolution and configured custom SQL; no database/schema creation,
new pool limits, live binding remapping, cross-factory readiness or migration.
Model creation versus read-only compatibility remains M4c; do not falsely claim
checkConnection prevents model DDL. Native retired-layout/upgrade scans must not
be expanded or used as new connection-diagnostic requirements.

M4b caller scan found an external PostgreSQL builder use in the Agent recovery
child harness selecting setTenantOptions without shared setOptions. Extend the
same implementer's scope to that necessary caller propagation only; preserve
current MySQL behavior until its parity slice. Do not infer shared settings from
a tenant inside the factory or introduce a compatibility fallback. The harness
is scheduled for removal in M7, but current API expectations must be explicit.
Live PostgreSQL first-use EventStore query exposed SQL compilation before schema
binding; corrected ordering now passes all 19 live tests. Remaining unit/static
checks and review are pending.

M4b narrow shared-reference clarification is included: checkConnection is a
public factory override; the StoragePreparations registry is for model
preparation. PostgreSQL now supplies the former before M4c supplies the latter,
so the existing adjacent wording must distinguish them. No broader docs rewrite.

M4b four-concern review completed; accepted corrections recorded REVIEW_LOG.
Public record shutdown regression was red and now passes, with 78 focused tests.
Concrete wrapper scan expands shutdown admission to Entity current/history and
Agent history/execution methods; a private provider callback tracks whole calls
without rejecting their later internal steps. Approximately fifteen wrapper
entries are affected. Revised remaining estimate 0.5-0.8 hours including focused
regressions/static checks and targeted reliability/style review. This is a proven
same-provider shutdown defect, not a shared architecture or public API change.
No new recovery feature is added; Agent execution removal remains milestone 7.

While M4b correction runs, dispatch independent read-only tenant-input inventory
as the existing orchestrator mechanical scanning function, mechanical_checks,
with verified immutable explicit gpt-6-luna/low profile. Runtime introspection
unavailable. Collect exact current TenantIndex creation/configuration/keep/read
callers and public/direct/transport request entrypoints for M5; no design, code
changes, tests or children. External tenant-admission-inventory.md only. Estimate
0.1-0.2 hours, concurrent with the correction. This does not start a new writer.

Read-only tenant inventory completed and accepted with the explicitly configured
Luna/low scanning profile; no runtime self-introspection. External
tenant-admission-inventory.md records current index creation/access, implicit
Inbox keep calls and command/Event/query/subscription/direct/saved-dispatch
entrypoints. No contains operation or membership checks currently exist; current
service checks only validate tenancy shape/mode. M5 must remove implicit keep
and cover effective-index admission, including subscription-ID registry discovery.
No source changes or tests were made by this scan.

M4b offline PostgreSQL factory/resolver and explicit shared connection check
accepted after four-concern review and one expanded shutdown correction batch.
Current evidence:106unit/103focusedcoverage/6liveaudit plus parent1liveAgentexecution;
static/docs/build and full formatting/diff pass. Targeted reliability/style clean;
API/docs corrected deterministically. Full record and Entity/Agent wrapper calls
now drain across factory shutdown. Commit authored paths and push immediately;
exclude generation-only manifests. Next: M4c factory-local physical preparation,
read-only compatibility and shared readiness, per D0150.

M4b checkpoint b7ef85b29 pushed immediately to official origin/environment-lifecycle.
M4c PostgreSQL physical preparation begins from that commit. Existing implementer
storage_retention resumes with verified explicit immutable gpt-6-sol/medium;
metadata introspection unavailable. This high-risk provider readiness contract
is already frozen by D0150/FACTORY_PREPARATION; no repeat architecture pass.
Estimate1-2hours for explicit create/check port, factory-shared successful and
pending evidence, temporary preparation connections, actual history/index needs,
focused/live tests, narrow docs and independent review. No server/TenantIndex,
MySQL/Datastore, recovery preparation, provisioning or existing-data migration.
Detailed external assignment postgres-preparation-brief.md supplements the full
human ledger and accepted design. Preserve M4b full-operation shutdown guarantees.

M4c source inspection confirms a baseline PostgreSQL destination probe still scans
all schema columns for retired _scope/_revision markers. This is upgrade-layout
detection unrelated to connection or the requested physical family and conflicts
with the accepted exclusion of upgrade scans. Remove that legacy-only probe and
its obsolete expectation while splitting preparation; validate actual requested
layouts only. Apply the same rule to MySQL's corresponding retired-layout guard
in its parity slice. No existing-data conversion, migration or compatibility
wrapper is added. Unrelated application tables must not fail a connection check.

Independent M4e prerequisite: existing documentation/API-verification function
provider_documentation, explicit immutable gpt-6-luna/medium, will inspect the
installed Datastore SDK and primary documentation to identify a real read-only
shared connection probe. No cloud/emulator mutation or source edits. Accepted
native guarantee is already settled; no new design or indexes/provisioning.
Use metadata access without fake application records/full namespace scan/new
arbitrary limits. External datastore-connection-probe.md records exact version,
API semantics and proposed call. Estimate0.1-0.2hours concurrent with M4c. Runtime
self-introspection unavailable; explicit configured profile is retained.

Datastore API verification returned installed SDK10.1.1 and emulator evidence,
but its recommended invented SpineStorageConnectionProbe kind is rejected: the
accepted contract excludes fake application/sentinel records even when the lookup
writes nothing. Same Luna/medium context must finish the native metadata option,
with exact shared-scope namespace semantics and necessary read permissions.
No architecture change or runtime implementation follows the rejected suggestion.
Native namespace metadata query was reportedly supported in local emulator;
confirm primary API documentation and no full scan/arbitrary limit. No cloud calls
or source edits occurred; the temporary emulator was reported stopped.

Revised Datastore API verification accepted as prerequisite evidence: SDK10.1.1
supports keys-only native **namespace** metadata query constrained to an exact
key range, without arbitrary scan limits or fake application identity. Shared
scope follows client.namespace in current single-tenant record construction;
NamespaceAssignments applies to named tenants. Namespace metadata requires
namespaces.get/list permissions and does not certify entity read/write/index
capabilities. External datastore-connection-probe.md records primary sources and
reused emulator proof. Implement/test in M4e; no runtime code changed now.
Explicit immutable Luna/medium function confirmed; introspection unavailable.

M4c PostgreSQL structure preparation accepted.172unit+coverage/20live tests and
build/tooling/static/docs passed; four-concern review found no blocking runtime or
API issue. Type-only audit-cache cleanup and precise pool-lifetime wording pass
focused3audit/typecheck/static checks. Factory readiness is shared by explicit
check/create and normal use; successful checks suppress DDL, failures retry,
temporary preparation resources close, and real Entity/audit requirements are
covered. Commit and push this checkpoint. MySQL parity follows in two bounded
slices: offline connection lifecycle, then physical preparation. This follows the
same accepted D0150 design and avoids mixing their independent review concerns.

M4c checkpoint29f2ed641 pushed immediately to official origin/environment-lifecycle.
M4d1 MySQL/MariaDB offline lifecycle starts from that commit. Existing implementer
storage_retention, verified explicit immutable gpt-6-sol/medium, no child agents;
runtime metadata introspection unavailable. Estimate1-2hours for offline factory,
shared options/dynamic resolver, explicit remembered connection diagnostic,
logical handles and full accepted-operation shutdown, dialect-specific unit/live
checks on both task engines, narrow docs and review. Same D0150 design, no new
architecture pass. Detailed external mysql-offline-brief.md applies alongside
TASK full ledger. M4d2 will separately implement physical create/check readiness.
No shared API redesign, server wiring, Agent recovery addition or data migration.

M6 prerequisite: read-only test/registration inventory under the latest human
requirement of unconditional Entity state uniqueness, including BlackBox.
Orchestrator-dispatched scanning function mechanical_checks uses its explicit
immutable gpt-6-luna/low profile; no children or source edits. Estimate 0.15-0.25
hours concurrently with M4d1. Identify any existing bypass and representative
simultaneously open duplicate-state fixtures, then recommend correct lifecycle
or distinct-domain fixture changes. External duplicate-state-inventory.md holds
detailed evidence. Runtime self-introspection unavailable. M6 implementation
remains sequenced after TenantIndex; no new architecture pass is requested.

M6 read-only inventory accepted from the explicitly configured Luna/low scanning
function. No existing duplicate-state disabling switch was found. Current checks
are per builder or per Server assembly, leaving separately built Bounded Contexts
unprotected. Representative constructor-injection, service validation, lookup
and Server-cleanup tests need revised lifetimes or distinct domain states.
External duplicate-state-inventory.md records exact anchors. Sequential scenarios
must also account for retained shared storage: closing a Bounded Context does not
erase its Entity state, so choose deliberate fresh identifiers when independence
is intended. No production or test source changed in this inventory.

M4d1 MySQL/MariaDB offline connection lifecycle accepted after full four-concern
review.124 scoped unit tests pass with fresh source maps; MySQL8.4 and MariaDB11.4
each pass21 live tests using shared and two tenant databases. Static/docs/build
checks pass. Three deterministic documentation corrections are verified; runtime
and tests unchanged after review. Factory assembly is offline, tenant resolution
coalesces/retries, explicit shared checks release temporary pools, and shutdown
drains complete accepted Record/Entity/Agent operations. No migration scan or
provisioning is added. Commit authored paths and push immediately; preserve
generation-only manifests. Next M4d2 implements physical creation/compatibility
using D0150 and the existing provider preparation port. Final release pending.

M4d1 checkpoint6919af639 pushed immediately to official origin/environment-lifecycle.
M4d2 MySQL/MariaDB physical preparation starts from this commit under accepted
D0150; no architecture redesign. Existing implementer storage_retention uses its
explicit immutable gpt-6-sol/medium profile, no children; introspection unavailable.
Estimate1-2hours for provider-port registration, pure actual-family requirements,
shared pending/successful evidence, read-only inspection versus creation, temporary
connections, Entity history/audit indexes, focused/live tests on both task engines,
narrow docs and independent review. External mysql-preparation-brief.md defines
scope. No server/TenantIndex changes, recovery preparation or migration. Preserve
complete-operation shutdown guarantees and generation-only manifest changes.

M5 prerequisite extends the earlier tenant-admission inventory with native provider
catalog semantics. Existing mechanical_checks scanning function, explicit immutable
gpt-6-luna/low, reads all four catalog implementations and membership consumers;
no design changes/source edits/tests/children. Estimate0.15-0.25hours alongside
M4d2. Record exact all/page/keep behavior, caching and side effects, fixed/resolver
enumeration and any existing direct membership lookup in external
tenant-catalog-inventory.md. Introspection unavailable. This evidence will inform
M5 without silently inheriting implicit registration or temporary TTL membership.

M5 provider-catalog inventory accepted from explicit immutable Luna/low scanning
function. External tenant-catalog-inventory.md records exact source anchors.
Current API has no contains. Memory storage binding can populate native catalog;
SQL dynamic keep accepts named tenants without resolver or enumerable membership;
Datastore native discovery is supplemented by an expiring/capped early cache.
These mechanisms cannot be silently treated as the new live membership contract.
M5 must keep incoming admission before storage side effects, define honest native
read/keep behavior and require application directory support where necessary;
no hidden persisted registry or provisioning. This was read-only, not a design
change or implementation acceptance. No tests or source edits occurred.

M5 JVM guardrail: production TenantIndex, DefaultTenantStorage and TenantStorage
in local core-jvm3429f5cd read after runtime research notes. Default index uses
environment factory and a single-tenant real Tenant registry; keep reads/writes
registration and all reads its index. This supports separate membership/database
resolution but does not authorize hidden TS registry records, explicitly excluded
by the accepted contract. Exact paths/impact recorded in external catalog inventory.
No server implementation changed yet.

M4d2 pre-freeze audit found a destination-resolution race: preparation calls
configFor independently per physical family, while runtime binding has a separate
pending map. Concurrent families or preparation/runtime first use can call the
resolver twice and accept differing destinations for one tenant. Correct before
review using shared pending/successful destination metadata, following accepted
PostgreSQL binding coordination. Add a deferred-resolver regression across
different families and explicit/runtime use; no new public contract. Same
implementer receives this bounded correction, estimate0.2-0.4hours for proof,
implementation and relevant verification. No repeated architecture pass needed.

M4d2 physical MySQL/MariaDB preparation accepted after four-concern review and
shared Agent-index declaration correction.131 scoped unit tests and23 live tests
on each engine pass; final focused29unit/2live and static/docs/build checks pass
after literal deduplication. Parent confirms one declaration and both consumers.
Read-only checks, create/verify, pure actual requirements, shared family readiness,
coordinated tenant binding and temporary cleanup are implemented. Source audit's
resolver race was reproduced (three calls) and fixed (one) before review. No
unresolved accepted findings; commit/push authored paths and preserve metadata.
Next is Datastore native/custom preparation under the same D0150 contract.

M4d2 checkpoint8ba27669e pushed immediately to official origin/environment-lifecycle.
M4e Datastore preparation begins from that commit. Existing implementer
storage_retention uses explicit immutable gpt-6-sol/medium, no children; runtime
introspection unavailable. Estimate1-2hours for native definition/read metadata
checks, optional custom-provider callbacks, shared readiness/shutdown, fresh
focused coverage/emulator verification, narrow docs and review. Accepted D0150
and external datastore-preparation-brief.md/datastore-connection-probe.md govern;
no new architecture pass. Native guarantee excludes write/index certification,
uses real namespace metadata without fake records or arbitrary limits, and keeps
caller-supplied client lifetime. No provisioning, migration or recovery prep.

M4e Datastore preparation is accepted after four-concern review and targeted
correction confirmation. Native metadata checks and model preparation are
read-only; custom callbacks preserve registration selection and application
readiness responsibilities. Failed probes retain live physical declarations;
normal handles reuse actual codec mappings. Final 164 local and 19 emulator
tests pass, along with build/tooling/static/docs checks. Review and external
evidence record the exact scope and remaining global verification. No root
contract change during correction. Commit/push this checkpoint; next is M5a
public live TenantIndex and honest native catalog semantics.

M4e checkpoint 3b5bcc3aa pushed immediately to official origin/environment-lifecycle.
M5a starts from this checkpoint: public live TenantIndex, effective environment
and Bounded Context configuration, and honest native catalog membership. This
is a high-risk public/lifecycle slice under the accepted frozen proposal; the
provider inventory resolves current mechanics without a repeated architecture
pass. Existing implementer storage_retention retains its explicit immutable
gpt-6-sol/medium profile; no children, runtime introspection unavailable. Estimate
2–3 hours includes implementation, focused native/server tests, narrow docs,
mechanical checks and four-concern review. External
tenant-index-implementation-outline.md defines ordered M5a/M5b/M5c scope.

M5a acceptance: public contains/keep/all/page and supporting public paging types;
actual live default/override object identity; no public tenantMode/close burden;
closing one Bounded Context leaves supplied indexes usable; lookup failures
remain failures; explicit keep is idempotent and read-visible. Native memory
membership comes from explicit registration, not record-family binding. Fixed
SQL catalogs are read-only and cannot register resolver-only tenants. Datastore
native discovery is read-only; remove expiring early-registration success, reject
keep for an absent namespace without writing records or infrastructure. Apps
use supplied directories to register before persistence. A factory with no native
catalog receives a transient memory index unless an application index is supplied;
no hidden persisted registry or fabricated resolver enumeration. No synthetic
single-tenant identity leaks into the company index. M5b removes implicit ingress
keep and adds typed unknown-tenant admission; this slice does not claim it yet.
Preserve generation-only metadata and previous checkpoint behavior outside scope.

M5b supporting scan: existing mechanical_checks function, explicit immutable
gpt-6-luna/low, inventories existing typed framework errors and transport/client
serialization paths only. No source changes, tests or child dispatch. This is
independent of M5a writing and does not repeat the tenant-entrypoint inventory.
Estimate 0.15–0.25 hours alongside M5a. Record exact paths/contracts for Command
Ack, query response, subscription errors, Connect/gRPC/native/browser/gateway
forwarding and direct in-process exceptions in external tenant-error-inventory.md.
No new error design or numeric code; accepted TENANT_UNKNOWN/NOT_FOUND remains.
Runtime introspection unavailable; immutable configured profile applies.

M5b error inventory accepted from the explicit immutable Luna/low scanning
function. Existing Spine base.Error has type/message/code/details; Command and
query services currently return most errors inside successful response bodies.
Unknown membership must bypass those normalizing catches as the already-approved
NOT_FOUND(5) with structured TENANT_UNKNOWN detail. Built-in browser/coordinator
forwarding preserves backend ConnectError except availability rewrites or
combined cleanup errors. Client web/node callers receive transport rejections as
Connect errors; no current tenant-specific decoder exists. Exact paths and
subscription lookup/cancel behavior are recorded in external
tenant-error-inventory.md. No source edits, tests or design changes by the scan;
no domain Rejection or new numeric status is introduced.

M5b client follow-up: source confirms client-web subscription #retryable currently
treats generic Connect errors as retryable. The accepted unknown-tenant request
error must remain identifiable and terminal rather than being hidden by a later
activation timeout. Record this for the admission/protocol slice: recognize the
structured TENANT_UNKNOWN detail, preserve transient transport retries and Node
delegation, and avoid message parsing. No client implementation is changed in
M5a.

M5a public live TenantIndex is accepted. Effective default/override objects remain
shared and usable after Bounded Context close; native catalogs expose honest
current membership without implicit memory storage admission or Datastore TTL
registration. Four-concern review resolved writable fallback cursors, dead native
paging state and fixed-SQL documentation. Final affected tests 24/24 and emulator
8/8 pass after the earlier 271-test scoped pass; build/tooling/static/docs are
clean. Parent confirms index 42/42 and Datastore 18/18 changed executable LCOV.
Authored checkpoint is committed/pushed before M5b input admission and errors.
Generation-only metadata stays unstaged; full release verification remains pending.

M5a checkpoint abb145983 pushed immediately to official origin/environment-lifecycle.
M5b begins: receiving-context live membership before tenant resolution, storage,
Inbox persistence or handlers; no implicit keep; typed TENANT_UNKNOWN and canonical
NOT_FOUND(5) with structured Spine error through actual service/client paths.
Missing/inapplicable IDs remain distinct; directory failures remain operational.
Shared subscription lookup may discover tenant before checking. Current membership
is rechecked at saved Inbox dispatch; single-tenant work never consults a synthetic
company member. This high-risk slice implements the accepted public/protocol
contract, with prior architecture and JVM M5 guardrail unchanged. No repeated
architecture pass. The external tenant-admission-implementation-brief.md plus
admission/error/catalog inventories define implementation and behavior acceptance.

Same sole implementer storage_retention, explicit immutable gpt-6-sol/medium; no
children, introspection unavailable. Estimate 2–4 hours covers runtime/service/client
implementation, explicit known-tenant fixture setup, fresh build/focused tests and
coverage/static/narrow docs, and relevant independent review. Include transport
identification now so the newly introduced error is usable; M12 still integrates
complete startup/protocol behavior. No new generic error hierarchy, persisted
registry, data migration, provisioning, retry timer or Agent recovery work.

M8 supporting inventory runs independently during M5b. Existing mechanical_checks
orchestrator-dispatched scanning function, explicit immutable gpt-6-luna/low; no
children, source edits or test runs. Estimate 0.2–0.4 hours alongside implementation.
Map current environment Delivery creation/defaults/Server attachment, per-context
Inbox/shard storage selection, committed-write notification and primary/background
dispatch, packed-signal tenant extraction and shutdown/resource ordering. Use
current files with exact paths; do not repeat M5 admission or M7 Agent inventories.
Record read-only source evidence in external shared-delivery-inventory.md for M8.
Runtime introspection unavailable; configured profile is authoritative.

M8 inventory accepted from explicit immutable Luna/low scanning function. Current
environment shares ports/workers but constructs Delivery wrappers per runtime or
supervisor group; Server performs attachment. Committed receive notifies readiness,
which later forwards to workers. Existing workers decode packed Command/Event
tenants, and periodic scans/watch provide recovery. Exact source/shutdown/test
paths are in shared-delivery-inventory.md. No code/tests changed. One bounded
follow-up records Inbox/shard factory scope and key/dedup identity to support the
single-tenant shared storage change without guessing existing semantics.

M8 targeted follow-up accepted: local Delivery retains Inbox/work-registry wrappers
but creates/closes underlying RecordStorage per operation. Current local mappings
append separate names and retain tenant scope; InboxId/message/shard protobufs have
no tenant field. In-flight handoff keys include tenant, while target blocking,
recent dedup, shard assignment and shard sessions omit it. Remote ports forward
packed messages/shards and the inspected delivery-server core uses in-memory
shard+UUID/shard identity. Single-tenant Inbox conversion therefore must also
retain physical records and qualify logical recipient/dedup identity from the
packed signal, rather than merely change the storage context flag. Exact paths
and distinctions are appended to shared-delivery-inventory.md. No source edits
or tests; same explicit immutable Luna/low profile, no children.

M9/M10 supporting read-only scan: same mechanical_checks function, explicit
immutable gpt-6-luna/low, no children/edits/tests. Estimate0.2–0.4hours alongside
M5b implementation. Locate subscription monitoring construction/start/initial pass,
periodic work/error restart/close and direct storage dependencies, with exact
callers from Bounded Context/Server. Identify existing awaited completion and
failure surfaces and focused tests; no redesign or Agent recovery duplication.
Record external subscription-monitor-inventory.md. This prepares explicit/lazy
startup work without changing the current tenant-admission slice.

M9/M10 subscription inventory accepted from explicit immutable Luna/low function.
Current SubscriptionRuntime is per paired Bounded Context, start returns void,
detaches its first reconciliation and installs a ten-second timer immediately.
Initial errors become WARN only if a logger is installed; buildAsync awaits only
integration readiness. Reconciliation tail/timer coalescing already permits later
retries; consume awaits a particular reconcile separately. Registry has a retained
single-tenant RecordStorage, and close drains reconciliation/observers/consumers
before registry close. Exact paths and tests in subscription-monitor-inventory.md
support later awaited initial startup and post-success WARN/retry behavior. No
new intervals or behavior were selected by this source scan; no source/tests
changed, no runtime introspection exposed.

M5b initial freeze reports 737/737 tests across seven affected suites and green
build/tooling/static/docs checks, plus focused restored Agent history evidence.
Parent changed-LCOV inspection includes new untracked error source (19/19), all
service changes (20/20), context checks (17/17), Inbox (10/10), client (3/3).
Three defensive invalid-instance branches remain intentionally uncovered. The
public Repository.history paginated path at repository.ts:1189 is another actual
input path, so parent requests one focused assertion before specialist dispatch,
in addition to already covered protected Agent reads. Same implementer, test-only
unless a defect emerges; estimate0.1–0.2hours within review allowance. No complete
review wave has started; no production edits are expected.

## M6 strict state registration preparation

High-risk lifecycle/public-contract slice; existing frozen architecture and
PROPOSAL section 3 remain binding. Latest human instruction forbids duplicate
domain state types even in tests, with no optional setting. Estimate 1.5–2.5
hours includes implementation, focused tests/static/coverage, independent review,
corrections and checkpoint push. Existing sole implementer storage_retention is
explicit immutable gpt-6-sol/medium; runtime metadata is not exposed. No children.
External duplicate-state-implementation-brief.md and duplicate-state-inventory.md
record acceptance cases and known invalid concurrent test fixtures.

JVM guardrail refreshed after searching spine-jvm-docs runtime/context notes:
PR1698 revision728e7654a711 ServerEnvironment.java serve/forget/contextsServing and
reset; BoundedContext.java register/serveStateOf and shutdown; and
BoundedContextBuilder.java build/closeAfterFailure were read directly from the
official raw repository. The local JVM checkout lacks this commit, so exact
remote source was used. Reserve before repository registration changes Delivery,
rollback only a newly inserted association, retain accepted repositories through
cleanup, and preserve initiating plus cleanup errors. The PR's historical
optional test setting is explicitly superseded by the human's unconditional rule.
No new library is needed for this domain-specific identity registry. M6 starts
after the M5b authored checkpoint is committed and pushed.

M5b review converged: reliability/style/API clean; README provider-catalog
qualification corrected. Generated docs including API/audience/snippets, README
formatting and diff checks pass after the prose-only correction. Runtime/tests
remain the reviewed frozen versions. No accepted P0–P2 remains. Commit the
authored changes, immediately push official feature branch, then start M6.
Generation-only manifests remain unstaged for final coordinated convergence.
