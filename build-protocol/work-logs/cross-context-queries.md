# Cross-context queries work log

Started: 28 September 2026. Status: implementation in progress.
Task/branch: `cross-context-queries`.
Worktree: `/Users/armiol/.codex/worktrees/cross-context-queries/spine-ts`.
Base: `2324311be8c23024f66cb2ba702fbe99a99e7dfb` from freshly fetched official origin.
Main checkout is clean master; native worktree is attached to this same chat.

## Framing and skills

Read current BUILD_PROTOCOL completely and CODE_QUALITY, current completion-plan
workflow and blocker sections, and expected-skill manifest. Session catalog is
the skill source; readable installed entrypoints listed with rg and installed
lock inspected at `/Users/armiol/.agents/.skill-lock.json`. Full selected skills:
implement, test-driven-development, using-git-worktrees and
subagent-driven-development (including dispatch templates). Existing approved
plan and prior skill evidence remain available; no duplicate architecture pass.
Review and verification skills will be read before their phases.

Protocol takes precedence over advisory skill defaults: reuse the implementer
for fixes, use repository logs rather than a duplicate hidden ledger, explicit
project profiles, no redundant baseline full test run, and no automatic PR/merge.
Unavailable writing-plans/finishing-branch skills are replaced by the reviewed
plan and project completion workflow. No new generic infrastructure or library
is selected: reuse existing query/storage/bus APIs and built-in Map.

Desktop exposes explicit required model profiles. All dispatch fields are
explicit; actual runtime metadata is not separately exposed. Accept immutable
role configuration unless a mismatch is reported. Standard speed only.

## Assignments recorded before dispatch

- Existing implementer: gpt-6-sol / medium; sole production/test/example writer,
  narrow behavior tests first, no broad release gate, no child dispatch.
- Mechanical workspace preparation: orchestrator-dispatched function using
  gpt-6-luna / low; install frozen dependencies and generate/build prerequisites,
  no tracked source changes, no children or broad tests.
- Review profiles and scope are recorded in the plan; record exact dispatches
  and evidence in the review log before review begins.

## Verification strategy

No full baseline rerun. Focused tests use one Vitest worker and no watch mode.
Preflight includes changed formatting, whitespace, affected typechecks/tests,
cleanup/TSDoc/doc checks and changed-production coverage inspection.
Shared runtime/lifecycle/tenant changes require one converged verify:release.
Build CI runs only for PRs; do not claim a green branch build without a run at
the exact final SHA. PR creation remains reserved for the human.

## Progress

Approved requirements and reviewed lifecycle corrections recorded before code.
Assignments dispatched explicitly: cross_context_setup uses Luna/low;
cross_context_implementation uses the existing implementer, Sol/medium. No
runtime profile mismatch reported. Both children are prohibited from spawning.

Official master Publish run 36447296300 passed at the exact baseline SHA.
There is no open PR for this branch. Registry reads confirmed snapshot.17 is
unused for all 19 publishable packages; this is the candidate common version.
No registry writes were performed. Frozen install succeeded with missing CLI
bin warnings before fresh dist generation; generation/build prerequisites are
in progress. The implementer waits for build completion before production edits.

Architecture-decision-records guidance was read for the existing decision-log
entry; reuse this project's record format, with no new ADR tooling or directory.

Preparation completed: frozen install, Proto generation and TypeScript build
passed. The setup child reverted only its generated tracked-manifest changes;
main records and the implementer's test remain. Record formatting, whitespace
and document audience checks passed. Plan checkpoint b2b6f9f98 was pushed to
origin immediately. No PR was created.

Initial cross-context failure was timing-ambiguous because Server delivery is
asynchronous. The corrected test waits for completion. Conclusive RED/GREEN:
temporarily restoring only the original local Stand query call fails with
StandStateTypeError for ProjectOverviewState; restoring routing passes 1/1.
Next RED confirms named-tenant to single-tenant rejection occurs after QueryReader
is entered; the correction must reject before any read. Full output is retained
in the implementation report under the task's temporary evidence directory.

CLI dist exists after build. A frozen reinstall completed without warnings but
did not recreate the two workspace CLI shims; no shim repair is claimed. No
current focused test depends on them. Check actual final verification needs
before expanding setup work.

Read-only documentation inventory assignment, before dispatch: existing
documentation reviewer gpt-6-luna / medium. Inspect only user-facing query/tenant
claims and example options, report affected files and concrete update suggestions;
no edits, builds/tests, prior reviews/memory or children.

Documentation inventory completed under the explicit Luna/medium profile with
no visible mismatch. Affected guidance: server README/REFERENCE, framework
USER_GUIDE, API and architecture overviews. Orders is the smallest suggested
two-context example; broad docs/example edits follow stabilized runtime.

Version-only commit 2ff068cce updates all31 workspace top-level versions to
2.0.0-snapshot.17 and was pushed immediately. JSON comparison proved no other
manifest fields changed in that commit. Pins and lockfile are updated separately;
offline frozen installation and release-policy validation pass. Lockfile-only
resolution reports existing ESLint/glob/node-domexception deprecations; no
dependency upgrade was made. Candidate registry checks covered all19 public
packages. No npm tags or publications changed.

Pins/lockfile commit 4e320831c was pushed immediately. Comparison with the prior
lockfile proves changes are only snapshot.16 -> snapshot.17 substitutions.
Main prepared the five public prose updates identified by the inventory and
checked formatting/audience/whitespace; these claims await runtime completion
and independent review. The implementer remains the only runtime/test writer.

Focused implementation milestones: tenant mismatch before QueryReader and
foreign SUBSCRIBE-only visibility rejection pass after failing assertions;
registered schema is used without reference-identity restrictions. General
SingleTenantIndex.all now reports SINGLE_TENANT and its focused test passes,
while the existing storage partition key stays unchanged. TypeScript build
passes after fixing two newly exposed declaration errors. These are narrow
checks, not release or complete feature acceptance.

## Query and tenant checkpoint

The implementer reports `pnpm exec tsc -b --pretty false` exit 0 and
`pnpm exec vitest run packages/server/test/entity/process-manager-querying.test.ts
packages/server/test/context/tenant-index-direct.test.ts
packages/server/test/services/spine-services.test.ts --maxWorkers=1` exit 0:
3 files, 137 tests passed. Evidence is in the tool transcript; later verification
captures logs under `/tmp/spine-cross-context-queries.ef2mk2`.

Effective tenant handling now reaches repository command/event/storage-context
boundaries, public reads, PM reads and the single-tenant index. The shared lookup
is used for public state routing too. Query reads use registered schema/metadata,
not schema-object-reference rejection. The implementer paused writes while main
formats/lints and captures this intermediate checkpoint. Startup/shutdown tests,
example, remaining TSDoc and full review/verification are still pending.

Read-only test-evidence inventory assignment, before dispatch: orchestrator
function using gpt-6-luna / medium. Compare the approved acceptance cases with
current focused tests; report concrete gaps without edits, test execution,
memory, or child dispatch. This is preparation, not final correctness review.

The shutdown regression separates two paths: environment detachment already
drains Inbox delivery, but an accepted direct CommandBus handler can outlive a
different context's Stand. Target-first registration reproduced `Stand is
closed`; the all-context drain correction passes both registration orders.
The existing server lifecycle suite then passed 150 tests with one worker.

An early deterministic TSDoc check failed on undocumented declarations in
touched files, including existing private methods. Full diagnostics are in
`/tmp/spine-cross-context-queries.ef2mk2/tsdoc-preflight.log`; these and the four
known callable-size findings go to the retained implementer before review.
No full release test run has started.

Read-only test inventory completed under the explicit Luna/medium profile,
without a reported mismatch. It confirmed tenant, visibility, duplicate,
separate-Server and local-query cases, and identified focused evidence still
needed for other Entity families, equivalent descriptors and recovery ordering.

Recovery-order RED/GREEN: moving route installation after delivery attachment
makes the startup probe fail; restoring pre-attachment installation passes.
The lifecycle checkpoint passed TypeScript build and 251 tests across the PM
query, server and bounded-context suites. The shutdown test observes the actual
begin-close operation; no test-only production accessor remains. Main's scoped
ESLint check then found four deterministic corrections, returned immediately to
the retained implementer before pushing. Final TSDoc/size checks, example,
independent review and release verification remain pending.

Checkpoint 0c17c3553 was pushed immediately after the four lint corrections,
repeat scoped lint/build/251 tests, formatting and whitespace checks passed.
The implementer resumed in the same context. The approved Orders addition is
a separate two-context composition, not a rewrite of the datastore benchmark:
an OrderReview process queries Catalog SKU state by type and records its name.

Proto generation exposed one remaining version-integration step: the nine
spine-proto-manifest.json packageVersion fields still read snapshot.16. Main
updated those fields to snapshot.17; subsequent generation must retain the
corresponding generated IDs and metadata. These belong outside the version-only
commit. No schema checksum or dependency version was changed by this correction.

Additional focused query evidence passed: all three Entity families, equivalent
descriptor instances, registered filter/order/mask validation, compound foreign
queries and detached rereads (25 tests), followed by TypeScript build. Scoped
lint caught repeated callback style and one non-null assertion in these tests;
the implementer is correcting those before this checkpoint is pushed and will
include lint in subsequent handoffs.

Checkpoint 9899b4165 was pushed after scoped lint and the 25 query tests passed.
Orders now has a separate two-context composition, a real OrderReview reaction,
and an OrderReviewed Event in the proper signal file. Proto generation,
example TypeScript compilation and its end-to-end test passed. The ID-only
query was simplified to an empty column selection, avoiding application use
of code-generation helpers. Public guides link to the runnable example.

GitHub CLI API access currently returns HTTP 401; credentials were not changed.
Public GitHub API access succeeds and reports no open PR for this branch.
SSH pushes continue to succeed. Final-SHA GitHub build evidence therefore
requires a human-created PR; no PR was created by this task.

Method-size corrections preserve existing construction/start/close steps and
add no lifecycle framework. The cleanup check, TypeScript build and 372 focused
tests passed after those extractions. Remaining semantic comments are being
completed before the review input is frozen.

Mechanical preflight assignment, recorded before dispatch: orchestrator
function using gpt-6-luna / low, with explicit model/reasoning and no child
dispatch. After implementation freezes, run generation/build prerequisites,
affected lint/format/TSDoc/cleanup/docs/Proto checks, focused behavior tests and
new-source coverage. Save actual output and exit codes. Do not fix authored
code, run the full release profile, commit or push. Main will inspect results,
return deterministic findings to the retained implementer, and only then
dispatch the planned independent review wave.

Preflight exposed a checker false positive: required TSDoc inside the existing
ServiceValues wrapper caused its unchanged enclosing code to count as a newly
modified 1,370-line callable. Main rejected a checkpoint-based workaround and
any IIFE exemption. The retained implementer is responsible for a bounded
checker correction and regression tests in scripts/check-cleanup-rules.mjs and
its existing test file. Comment-only edits must not count as executable changes;
new or code-modified callables retain the same 35-physical-line limit. Restore
extractions made only to work around this false positive, preserving actual
feature changes. Systematic-debugging and receiving-code-review guidance was
read for root-cause verification and evaluation of proposed corrections.

The checker correction passed all 154 existing/focused tests and a subsequent
new duplicate-copy regression. It compares executable/type tokens with the
baseline and counts matching baseline callables, so copied new callables do not
inherit an exception. New or code-modified callables still use 35 physical
lines, including comments. Comment-looking multiline template content remains
code. No IIFE or checkpoint exemption was introduced. The ServiceValues token
sequence is identical to the base; unrelated matcher and command-post bodies
were restored. Scoped ESLint, cleanup, TSDoc, TypeScript compilation and all
373 focused runtime/example tests pass after the correction.

Dispatched cross_context_preflight with explicit gpt-6-luna / low and no
inherited history. Its scope is missing deterministic checks and new-source
coverage, not a repeated full build or release profile. Authored code is frozen
for this check. Runtime metadata is not separately exposed by this surface;
the explicit configured profile meets the dispatch requirement.

Independent preflight passed formatting (including new example files), API docs,
audience checks, Proto lint/freshness, logging/dependency checks, release readiness
and diff whitespace checks. Tooling typecheck found a test predicate using `eq`
instead of a supported comparison operator; returned to the same implementer.
The 31-test targeted coverage run passed: 97.77% statements, 93.33% branches,
100% functions/lines. Main checked the raw LCOV after the mechanical report
mistakenly described the routing file as absent: registered-targets.ts has
28/28 lines and 20/20 branches covered. EffectiveTenants has 13/13 lines and
8/10 branches; the implementer will add the missing rejection-path tests while
correcting the fixture. No runtime or coverage threshold change is needed.

Mechanical corrections are complete: tooling typecheck and scoped lint pass;
the fixture uses the supported `equal` operator and three direct tenant-error
tests cover missing/malformed multitenant identity and explicit single-tenant
identity. Main reran the combined 34-test coverage selection with both new
runtime files included: 100% statements (45/45), branches (30/30), functions
(10/10), and lines (41/41). The implementation is frozen for independent review.

Checkpoint 78addab7a was pushed. The four independent review concerns were
completed with explicit profiles and no inherited history/memory. Limited
surface capacity required sequencing; the complete wave was collected before
one correction batch. Findings: Proto/generated mask-name mismatch, missing
actual PM query during shutdown, and missing persisted-work replay query.
Documentation was clean. Details and acceptance are in the review log.

The mask regression reproduced locally and across contexts with the existing
ProjectProfileState mutable_note field and typed mask("mutableNote"). The
correction validates Proto field names and applies translated property names
after decoding state, not to the stored EntityRecord envelope. Both focused
cases pass. Real paused-PM shutdown cases pass in both registration orders,
with the separate direct-CommandBus race test retained. Recovery now closes one
Server, resumes stored delivery in fresh contexts, and proves that existing PM
state is restored (observed construction versions 0 then 1) before a foreign
read. Stand's required TSDoc corrections are comment-only. A rejection-triggered
query case is the remaining plan acceptance test before the correction freezes.

The correction is frozen. The real ReviewRejected Event carries the rejected
command context, and its PM handler declares a supported optional Command
result. Its foreign read passes. Mask tests proved two successive failures:
unknown Proto field before validation correction, then lost property before
decoded-state masking correction. Both local/foreign cases are now green.
The final affected PM/Stand suites pass 77 tests; tooling typecheck, scoped
ESLint/Prettier, cleanup and TSDoc all pass. Only RegisteredTargets, Stand and
the PM-query test changed in this correction. API/reliability re-review follows;
no broad release profile has yet run.

Checkpoint cc2a90994 was pushed. Reliability re-review is clean. API re-review
caught a skipped malformed-mask validation path; the retained implementer
restored existing StorageQueryPolicy validation before stripping the mask from
the stored-record query. Six malformed-mask regressions and the full affected
83-test PM/Stand selection pass. Tooling typecheck, scoped lint/format, cleanup
and TSDoc also pass. Final API confirmation and security review precede the
single full release verification profile.

Checkpoint 88c385b2e was pushed and final API confirmation is clean. Security
review found a real same-Server isolation defect: a second startup could replace
an active context's query routes before rejecting reused delivery attachment.
The implementer reproduced it with an actual paused PM query returning the
second Server's `intruder` state instead of its original target. The approved
bounded correction validates the complete route set synchronously before any
route/logger mutation, excludes already-associated contexts from failed-start
cleanup, and releases this attempt's routes only after successful existing
close/rollback cleanup. Both registration-order regression cases now pass.
Concurrent-start and cleanup-retry checks remain before the correction freezes.
This security correction extends the initial estimate; release verification
remains pending rather than being claimed against the previous checkpoint.

Security correction is frozen: complete synchronous route validation precedes
route/logger mutation, live contexts are excluded from failed-start/build
cleanup, and route release is identity-checked after successful closure. Seven
focused security/lifecycle scenarios and the combined 320-test PM/server/
lifecycle/context suite pass. Tooling typecheck, scoped ESLint/Prettier,
cleanup and TSDoc pass. Final fresh security and reliability rechecks follow
this checkpoint; ordinary API/documentation claims remain unchanged.

Checkpoint a7814bf09 was pushed. Security recheck identified assembly-time
shared-context cleanup and post-attachment construction gaps. Base inspection
confirmed both underlying paths predate the task. A bounded independent
requirements-splitter consultation (explicit Astra/high, no history/memory)
recommended private startup admission and extending existing retryable cleanup,
without environment or public API changes. The retained implementer completed
that correction with RED/GREEN tests. Final scoped verification passes 325
tests, tooling typecheck, scoped lint/format, cleanup and TSDoc. One HTTP/2
session-order assertion failed once and passed isolated/combined reruns; no
unrelated implementation change was made for it. Final review and the broad
release gate remain pending.

Checkpoint 478a530f8 was pushed. Final independent security (Sol/high) and
reliability (Sol/medium) rechecks are clean; security additionally ran eight
focused startup/cleanup tests successfully. All four canonical concerns and
final security are resolved. Main dispatches a fresh mechanical verification
function with explicit gpt-6-luna / low: cheap preflight, one verify:release
run with the configured single worker, then release-cli prepare --check.
Capture actual output and exit statuses; no fixes, commits, publishing, or PR
creation are delegated. Any failure returns for scoped diagnosis rather than
blind repetition. Authored code is frozen at 478a530f8.

The first release command stopped before the full test suite: the new
effective-tenant.test.ts copyright text was wrapped differently from the
required header. Main applied the exact existing header as a deterministic
comment-only correction; repository-wide lint:copyright and diff checks pass.
This check should have been included in cheap preflight for the new file.
No runtime or review disposition changed. Resume the release profile after
cheap preflight, preserving the failed attempt's logs and exit status.

Release attempt two completed its suite: 298/304 files and 5,054/5,061 tests
passed. All seven failures trace to integration omissions in main's version/
documentation work: three tests still asserted snapshot.16, and four packaged
consumer/release tests rejected the server README's relative link outside its
tarball. Main corrected real-manifest assertions in four test files to .17 and
changed the Orders link to the official repository URL, matching existing
package documentation links. No runtime changes or relaxed assertions. These
deterministic fixes require focused tests and package proof before the next
full run, not another specialist review. The failed run did not retain a fresh
coverage artifact; prior targeted coverage is not full-run evidence.

Focused verification of all six failed files now passes 78/78 tests, including
real package-consumer preparation. Copyright, cleanup, TSDoc and tooling
typecheck pass. Main's scoped formatting and diff checks pass. Commit/push the
version assertion and package-safe link corrections, then authorize release
attempt three from the clean checkpoint. No runtime changes reopen review.

Release attempt three at ef56f0dec passed all deterministic gates, then finished
with 303/304 files and 5,060/5,061 tests passing. The sole failure is the HTTP/2
session-close ordering assertion previously observed intermittently. Its client
`session` event was absent while subsequent server cleanup events were present.
Do not retry merely for green. The retained implementer (explicit configured
gpt-6-sol / medium) is investigating synchronization versus runtime ordering,
with bounded reproduction and correction only. No fresh coverage was retained
by this failed run, and the separate release package proof was not run.
The public GitHub API still reports no PR for this branch; an asynchronous
request asks the human to open one because CI runs on PRs only. No PR creation
or publication is authorized.

The lifecycle failure came from observing the client-side HTTP/2 close event
as if it were the server-side close awaited by shutdown. Client notification
can arrive later. The integration test now observes the real server session
through the existing HTTP adapter test hook and retains the exact cleanup
sequence; it awaits client disconnection separately. A sibling test with the
same assumption keeps exact resource/facility sequences and confirms exactly
one client close event. No runtime change. Both files pass all 201 tests;
tooling typecheck, scoped lint/format, cleanup and TSDoc pass. A fresh existing
performance/reliability reviewer is dispatched with explicit gpt-6-sol / medium,
no inherited history or memory, to check the narrow test correction against
actual shutdown behavior before another release run. Runtime metadata remains
unavailable; the explicit configured profile is recorded.

The reviewer found one residual client/server endpoint ordering assumption;
the retained implementer corrected it and explicitly awaited an adjacent
client-stream close notification. The final 201-test selection and cheap checks
pass. Focused independent re-review is clean and confirms exact shutdown-order
assertions remain. Commit and push the test-only correction, then run cheap
preflight and the complete release profile again. The prior failed attempts
remain recorded; none is claimed as successful coverage evidence.
