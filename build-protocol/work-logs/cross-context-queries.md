# Cross-context queries work log

Started: 28 September 2026. Status: complete approved implementation and extension
locally release-verified on 29 September; GitHub CI awaits a human-created PR.
The implementation includes complete states with no masking APIs, generated
queries, tenant-preserving cross-context reads and receiving-repository routing.
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

## Local verification complete

Pushed code checkpoint `506b7301845999c2d675a4b16ad7fcce0a38d692` passes the
mandatory cheap checks and full `pnpm verify:release` (exit 0). All 304 test
files and 5,061 tests pass. Fresh coverage: statements 24,021/25,749 (93.28%),
branches 14,134/15,693 (90.06%), functions 6,119/6,571 (93.12%), lines
22,199/23,506 (94.43%). No thresholds or exclusions changed.

`node scripts/release-cli.mjs prepare --check` passes (exit 0): all 19 package
tarballs at `2.0.0-snapshot.17` pass consumer install, build and import checks.
All 31 workspace versions were updated in the required version-only commit;
dependency pins and lockfile changes were separate. No publication occurred.

Fresh LCOV was inspected. EffectiveTenant is fully covered (13 lines, two
functions, ten branches). RegisteredTargets covers 38/40 lines, 10/10 functions
and 23/26 branches: remaining defensive installation guards are intercepted by
Server admission, and release's defensive identity-mismatch branch is unhit.
Server covers 356/363 lines, 80/80 functions and 125/142 branches; Stand covers
268/274 lines, 64/64 functions and 124/140 branches. The larger Repository module
covers 1,525/1,617 lines, 441/451 functions and 808/934 branches, with the new
query route exercised. Two Orders tests execute the compiled example against
a real Server; its authored-source LCOV entry has zero hits because the tests
import compiled output. Do not describe that as source coverage.

The verification function used explicit Luna/low as assigned; its raw results
were independently checked by main. Current-run local logs and exit files are
under `/tmp/spine-cross-context-queries.ef2mk2/release4-*`. Accepted independent
review findings are resolved. The final update changes records only, so it needs
format and diff checks, not another complete runtime test run.

Remaining external step: open the feature PR and check CI for its final SHA.
The public GitHub API still returns no PR for this branch, Build runs only on
PRs, and the local GitHub CLI credentials return 401. SSH pushes and public
read-only API access work. The human has been asked to open the PR; no PR
creation, merge, publication or credential change is authorized. Local work is
verified, but final-SHA CI and protocol completion are not claimed.

## Repository queries and generated DSL: plan extension

The human approved receiving-repository-only queries during routing, all three
methods (`findIds`, `findStates`, `find`), real Entity instances from `find`,
asynchronous routing, and automatic generated query registration with a JVM-like
fluent interface. More than 1,000 distinct final recipients must warn, not fail;
the find methods must not warn. This adds work to the existing branch; it does
not invalidate the recorded original verification but requires new verification
after future implementation. Current authorization is written plan and review
only, not implementation.

Selected skills fully read: doc-coauthoring, planning-with-files and
verification-before-completion. Session inventory and targeted `rg --files`
confirm their installed entrypoints; expected-skill manifest and readable local
skill-lock header were inspected. Use existing canonical plan/work/review files
instead of the planning skill's duplicate root files or chat-memory catch-up.
The human already supplied context and approved the proposal, so skip redundant
interview/brainstorming steps from doc-coauthoring and proceed to fresh-reader
review. No skill authorizes a broader change or automatic implementation.

Main updates the plan and current status, then runs Markdown/whitespace checks.
Expected standalone assignment: existing requirements splitter, explicit
gpt-6-astra / high, fresh context with no chat history or memory. Review the
complete requirements ledger and extended plan against current code and latest
official JVM source; identify contradictions, missing decisions and small fixes.
No files may be changed and no builds/tests or child agents may be launched by
the reviewer. Desktop supports the explicit profile; separate actual runtime
metadata is unavailable. Planning estimate given: 0.2–0.35 hours.

The standalone plan review completed with six accepted findings. The plan now
specifies class-aware routing types, exhaustive reads in all four providers,
JVM repository lifecycle selection, shared query execution and copied inputs,
routing-bound read access, and generation edge cases. The independent reviewer
used the explicitly requested profile without inherited history or memory;
see the review log for acceptance and source details. One user question remains
about complete Entities when a query selects only some fields. No production
code was changed and no runtime tests or builds were requested or run in this
planning turn. The first plan checkpoint was pushed as `7dd649583`.

Planning-document verification passed: Prettier on the five changed Markdown
files, `node scripts/check-doc-audience.mjs`, and `git diff --check` (exit 0).
These checks validate the documents only, not the unimplemented extension.

## Reanalysis after removing query masking

The human directed removal of masking from the query engine altogether, then
asked for plan reanalysis. This resolves the last question: Entity/state queries
return complete state. Current work is analysis and documentation only; no
implementation was started before the reanalysis request. Estimate: 0.15–0.25
hours for tracing affected paths, revising records, focused independent plan
review, document checks and push. No builds or runtime tests are needed here.

The public-contract change requires a focused architecture recheck, not a new
full implementation review. Expected assignment: existing requirements splitter,
explicit gpt-6-astra / high, fresh context and no memory, read-only review of the
revised plan against current query paths. No child agents, edits, builds or tests.
Desktop supports the required explicit profile; independent runtime metadata is
not exposed. Record actual dispatch and findings before accepting the result.

Re-read AGENTS and BUILD_PROTOCOL. Selected doc-coauthoring and
verification-before-completion skills were read fully; session inventory,
expected-skill manifest and readable installed lock are available. Use the
existing plan and logs, skip redundant interviews and scope-unrelated skill
steps, and run a single focused fresh-reader pass. Implementation and test-first
skills were inspected before the user narrowed this step to reanalysis; they do
not authorize production changes now. No new library or infrastructure is needed.

The attempted fresh requirements-splitter dispatch explicitly supplied Astra/high
and `fork_turns: none`, but the surface rejected it because the agent thread
limit was reached. Use the retained `/root/repository_query_plan_review` for this
focused follow-up under its unchanged, originally explicit Astra/high profile.
This is independent from the author but not a new no-history review; do not claim
otherwise. It must re-read the updated files, not use external memory or chat
retrieval. No additional review roles are needed for this plan-only correction.

The focused review confirmed complete removal coverage and no remaining product
questions. Accepted its one P2 finding: specify subscription recovery tests that
use complete authoritative-query results while preserving separately masked live
updates. The plan now includes that sequence and local/remote filter-before-mask
checks. Updated the governing specification and resolved-questions record.
No runtime files changed. Final checks passed (exit 0): Prettier for the six
changed Markdown files, `node scripts/check-doc-audience.mjs`, and
`git diff --check`. Implementation remains pending.

### Human correction: subscriptions too; ignore wire masks

The prior plan checkpoint `48730a1dc` was pushed before the human corrected its
scope. It incorrectly retained subscription masking and rejected query masks.
The explicit rule is now recorded throughout the active plan and specification:
no masking in any API or execution path; ignore mask fields in incoming Protobufs.
Do not validate mask paths or reject Event topics, queries or state subscriptions
because a mask is present. Complete results apply to live delivery and recovery.

Remove the shared pruning helper instead of moving it into subscriptions. Replace
the previous acceptance scenario with full-state query and subscription results
despite incoming wire masks. This correction changes only the plan/specification
and records. Estimate: 0.05–0.1 hours for edits, focused checks and push. The
earlier follow-up's subscription exception is superseded, not an accepted rule.

Correction checks passed (exit 0): changed-document Prettier check, documentation
audience check and `git diff --check`. A targeted scan confirmed the active plan,
specification and questions log contain no requirement to retain masking or reject
wire masks. No production code or runtime tests changed.

## Complete standalone plan review requested by the human

Scope: review the complete corrected plan without memory or inherited history,
report genuine remaining questions, then summarize if none remain. Estimate:
0.1–0.2 hours for independent source checks, any bounded plan corrections,
documentation verification and reporting. No runtime implementation or builds.
The doc-coauthoring fresh-reader stage applies; use one independent complete
review, not repeated brainstorming or review of earlier conclusions.

The Desktop fresh-agent limit prevented dispatch. CLI 0.144.1 was rejected by
the model service before review began. A new ephemeral read-only process uses
the already-installed app-bundled CLI 0.158.0-alpha.2.1 with explicit Astra/high,
the existing requirements-splitter remit, memories/multi-agent/fast mode disabled,
and no resumed session. The execution header confirms gpt-6-astra, high and
read-only. No prior chat or work/review-log conclusions were supplied. Evidence:
`/tmp/spine-query-plan-review.nROe5z/bundled-execution.log` and `result.md`.
The initial plan/document formatting and whitespace checks passed. No software
was installed or configuration changed. The separate review log tracks outcome.

The fresh standalone review completed successfully with no remaining user
questions. Accepted three P2 plan findings: remove the builder's explicit-ID
ceiling for repository execution; adapt subscription recovery to common generated
queries; and add focused review checkpoints between major runtime slices. All
are incorporated into the written plan. Read-only review did not independently
refresh JVM HEAD, and made no new JVM-parity claim. No implementation occurred.

Post-review document checks passed (exit 0): Prettier on the three changed files,
documentation audience checks and `git diff --check`. The review process exited
normally; no reviewer process is left running. Ready to push this plan update
and give the requested simple summary, without claiming feature implementation.

## Approved extension implementation

Started 29 September 2026 from `d37ca8179` in the existing task worktree/branch.
The human authorized the whole reviewed extension. High-risk: shared public
query contracts, storage behavior, asynchronous routing and delivery. The
approved Astra/high architecture review is complete; do not repeat it absent
a material contract change or demonstrated blocker. Estimate remains 4.5–6.5
hours, excluding CI queue time; detailed breakdown is in the plan.

Progress: masking removal is reviewed, verified and pushed; generated queries
and their consumers are in progress. Complete repository reads, async routing,
broad examples/docs and final verification are pending. Preserve original
cross-context implementation and its regressions.
Use `verify:release` once after the reviewed slices converge, because shared
runtime/contracts change; run cheap checks and focused coverage before reviews.
Do not start a redundant full baseline run. Current prior release evidence is
recorded above. Every feature commit must be pushed immediately by main.

Main reread AGENTS and BUILD_PROTOCOL. Selected skills: subagent-driven-development,
test-driven-development, verification-before-completion, using-git-worktrees,
requesting-code-review; full skill instructions and dispatch templates read.
Session inventory, installed entrypoints and repo expected-skill manifest checked;
installed-lock source was inspected during this task. Use existing plan/work/review
records rather than another skill ledger. Repo-specific role routing, retained
implementer corrections, concern-specific review waves, and one final release
gate supersede generic skill instructions to create new fixers or run full suites
per slice. Missing writing-plans/finishing skill names use the canonical reviewed
plan and repo workflow instead; no new worktree, branch or dependency installation.

Expected implementation assignment: existing implementer role, explicit
gpt-6-sol / medium, one production writer for all masking-related source, tests
and narrow API documentation. Main retains these protocol records. Agents are
not alone in the checkout and must preserve unrelated edits. Desktop agent
capacity is exhausted; the already-verified app-bundled CLI supports explicit
profiles. Use a fresh CLI session and retain it for corrections/follow-on slices,
with memory and child-agent creation disabled. No new user chat is created.
Mechanical checks use Luna/low; documentation review Luna/medium; API, style and
reliability reviewers Sol/medium, each fresh and independent. Record actual
execution headers before accepting work; separate runtime metadata may be absent.

Masking slice brief/report/logs are under `/tmp/spine-query-implementation.NI6cD6/`.
Main dispatched the app-bundled CLI with explicit gpt-6-sol / medium, memories,
multi-agent and fast mode disabled. This implementation session is retained for
corrections. Its assigned source/test/doc scope excludes main's protocol records.
Focused tests are constrained to run mode and one worker; do not launch watch
processes. Repository origin/master was fetched and remains at the original base
`2324311be8`; no merge or branch replacement is needed.

Independent read-only preparation for the next slice: orchestrator-dispatched
code/API scanning function, explicit gpt-6-luna / medium. Map existing generator
integration and typed-query consumer seams into a compact report for the retained
implementer. No edits, tests, builds or child agents; do not duplicate masking
implementation exploration. This is a mechanical/API verification function, not
a new project role.

Execution headers confirm the implementer session `01a0ed61-8899-76f2-ba6a-e5438eded07e`
uses gpt-6-sol/medium and the read-only scan uses gpt-6-luna/medium. Main verified
official core-jvm HEAD with `git ls-remote`: still
`ea3067b137938ac0beb6920c39d11e300976fcc9`. The implementer inspected its
ToEntityRecordQuery source; explicit human no-masking behavior supersedes that
JVM feature. Expected failing query and local/remote subscription tests were
observed before source changes; their commands/output are in the slice log.

The Luna/medium read-only scan completed (exit 0) without edits or tests. Accepted
the explicit configured profile confirmed in its execution header. Its report
`query-seams.md` maps normal proto-tools staging/import rewriting/fingerprints,
existing column plugin, core builder/compiler, canonical ID-field inference,
and PM/client/recovery consumers for the next slice. Use it to avoid repeating
that source discovery; implementing repository searches remains a later slice.
Next-slice preparation: a second independent read-only scanning assignment uses
explicit gpt-6-luna / medium to map provider query limits, Entity restoration and
async routing/admission call sites. It must not edit files, run tests or overlap
the completed generation/consumer scan. This is the orchestrator's scanning
function, not a new project role. Its compact report will support the retained
implementer after generated-query contracts stabilize.
The provider/routing scan completed with exit 0; its execution header confirms
gpt-6-luna / medium. Accepted report: `provider-routing-seams.md` beside the
generation scan. It identifies each provider's candidate limit, normal Entity
restoration, routing admission and recorded-target replay. No source edits or
tests were performed by that scanning function.

Masking preflight is not yet accepted: focused tests passed (latest 469 tests in
11 files), but cleanup rejects the modified ServiceValues closure and touched-file
TSDoc/spacing checks require correction. These are implementation work, not waived
baseline limitations. Main prepared a correction brief for the retained Sol
session; do not start specialist review or claim this slice ready before they pass.
The first implementation session returned DONE_WITH_CONCERNS. Accepted its test
and behavior evidence, but not slice completion: cleanup and touched-file TSDoc
failures must be resolved. Resumed the same session with explicit gpt-6-sol / medium;
the new execution header confirms both. The correction brief requires a small
behavior-preserving removal of the oversized wrapper, all required documentation
and spacing fixes, no checker exemptions, and reuse of unaffected test evidence.
Main formatted its protocol records. Specialist review remains pending.
Cleanup now passes after unwrapping the service helper closure and shortening
three affected helpers. During documentation drafting, main rejected a temporary
name-based comment generator before its proposed prose reached source files:
generic parameter/result guesses were not acceptable documentation. Interrupted
only that task's CLI process, then resumed the same explicit Sol/medium session
with instructions to inspect each declaration and write accurate comments.
No source work was discarded; no enforcement rule was weakened. The temporary
drafting script is outside the repository and will not be committed.
Independent final-verification preparation is assigned as a read-only mechanical
function with explicit gpt-6-luna / low. Inspect existing real-database/emulator
test commands, example smoke commands, Docker availability and task/release
preflight configuration. No test/build/container startup, installs, source edits
or child agents. This avoids discovering environmental requirements at release
time; it does not authorize changing the shared environment.
The live-verification preparation completed, exit 0, with gpt-6-luna / low
confirmed in the header. Accepted `live-verification-seams.md`: current real SQL
and Datastore commands, Todo smoke configuration, and release/tarball entry points.
It found the Docker client installed but the daemon unavailable; no resources
were started or modified. Main notified the human to start Docker before live
provider verification. Code work can continue; do not claim mocked-provider tests
as live database evidence. Current integration fixtures need explicit large-read
cases to establish exhaustive provider behavior.
Masking correction completed. Final report: `masking-report.md` in the task's
temporary evidence directory. Final cheap checks pass: cleanup, TSDoc, changed
source/script ESLint and Prettier, generated build typecheck then tooling
typecheck, API-documentation inventory and `git diff --check`. No checker
exemptions were added. Reused the prior 469-test focused masking coverage, and
reran 115 service tests after unwrapping helpers plus 62 core tests after the
documented private rejection-factory correction; all passed. Datastore helper
class expressions were named without changing their frozen-instance behavior.
These small code changes are explicitly included in independent review.

Started fresh API, reliability and style reviews, each explicit Sol/medium with
confirmed execution metadata; documentation will follow as Luna/medium within
the available capacity. Hold production source unchanged until the complete
wave has been collected. Review evidence and final acceptance belong in the
review log. Full release verification and live database evidence remain pending.
During the held-source review wave, a mechanical verification function uses
explicit gpt-6-luna / low for generated documentation/snippet checks, repository
format and whitespace checks. No source edits or production builds; reuse current
generated outputs. These supplement the implementer's touched-source preflight.
Accepted the complete masking checkpoint after all review corrections. The same
Sol/medium session added real activation and complete Event/state delivery tests
for invalid masks and corrected RecordValues documentation. Final service suite:
117/117; generated build and tooling typechecks, affected ESLint/Prettier, cleanup,
TSDoc and whitespace checks all pass. No runtime change in the review correction.
Main checked the new assertions and accepted each finding as resolved. The next
slice is the shared context-free query, normal generated DSL and existing consumers.
Committed and immediately pushed the accepted masking checkpoint as `30539151f`
to official `origin/cross-context-queries`; push exited 0. Next assignment is the
existing implementer, explicit gpt-6-sol / medium, retained session
`01a0ed61-8899-76f2-ba6a-e5438eded07e`, for shared context-free queries, normal
generated DSL and existing PM/client/recovery consumers. Main remains responsible
for protocol records. No repository-read/provider/routing implementation yet.
Use `shared-query-brief.md` and the completed source-seam scan. One production
writer; focused red/green checks, no child agents and no full release rerun.
Shared-query contract spelling: inclusive comparisons use `isAtLeast()` and
`isAtMost()` rather than the longer draft spellings. Main accepts this bounded
naming adjustment to satisfy the existing semantic-name limit and keep the DSL
plain. Predicate semantics, types and architecture are unchanged; update plan,
generated examples and tests consistently, without an extra architecture wave.
Main read the complete TypeScript advanced-types skill for the generated DSL's
mapped/conditional types. Its relevant guidance is to verify inference and invalid
calls with compile-time tests, without complex assertions hiding a runtime mismatch.
No optional reference was needed. Main inspected the generated builder and found
an actual mismatch: either() callbacks accepted root ID/order/limit operations
while combining only predicates, and unknown return types also admitted async
callbacks. These could silently omit requested criteria. Interrupted only the
active implementation process and resumed the same explicit Sol/medium context
with a condition-only branch correction and focused tests. The plan now clarifies
the existing grouping semantics; no ID-in-OR wire feature or new product decision.

The continuation brief also requires the full already-approved generator evidence
(nested/collision/non-id cases, invalid column handling, repeated registration,
external imports and generation rollback), not only a source-text assertion. New
source files must be staged before review and included in git diff from `30539151f`.
Demonstrated generation design problem: ordinary query generation must reject
invalid/reserved column annotations, while internal negative fixtures must still
produce their Protobuf messages. The in-progress implementation now uses package-
name exceptions in the published generator. Main does not accept that as the
final separation. Dispatch one bounded existing requirements-splitter pass,
explicit gpt-6-astra / high, fresh read-only without memory, to select the smallest
existing test-generation seam. This is not a repeated whole-plan architecture
review: it resolves a concrete build/validation conflict. No edits or children.
The bounded requirements-splitter pass completed without edits/tests. Its header
confirms gpt-6-astra / high, fresh and read-only. Accepted recommendation in
`fixture-generation-design.md`: use a repository-local runner and existing
GenerationOperations.runProcess; do not override runBuf because that disables
the default interface phase. Generate all descriptors, omit core fixture queries,
and run strict server query generation excluding only invalid-column.proto. Remove
published-generator package-name branches and the validation-allowance option.
Tradeoff: one extra server-fixture Buf invocation and a tested internal-template
dependency. No public configuration or altered negative Proto declarations.

Returned the accepted design to the same explicit Sol/medium session, retaining
all valid changes. The continuation must finish generator/consumer acceptance and
cheap checks before review. The existing clean-bootstrap test archives HEAD;
record its limitation now and run it against the implemented checkpoint after
commit rather than presenting a prior-HEAD pass as proof of these changes.
Metadata scope for all app-bundled CLI assignments above: execution headers
establish the explicitly configured model and reasoning effort. The surface does
not expose a separate provider-internal runtime identity. No visible mismatch or
fallback was reported. Acceptance uses the immutable configured role/profile and
records this limitation; it does not rely on a model's self-description.

Main read the complete receiving-code-review skill before the shared-query review
wave. It requires checking each finding against the accepted requirements and
actual implementation, then returning one confirmed correction batch to the
retained implementer. Repository review sequencing takes precedence over the
skill's generic suggestion to react to findings individually.

Shared-query implementation returned with focused evidence: 147 tests in five
query/PM/client/generator/external-consumer files, nine fixture/bootstrap tests,
normal generation, sequential build/tooling typechecks, generated-current,
cleanup, TSDoc, copyright, changed-file ESLint/Prettier and full generated-doc
checks passed. An earlier broader workflow run had one test setup failure; the
corrected rollback case passed. The clean-bootstrap test still needs the new
committed HEAD. Main staged all new source/test/script files before review and
confirmed the complete staged diff passes whitespace checking.

Fresh independent API, reliability and style reviews dispatched concurrently
with explicit gpt-6-sol / medium, memory disabled and read-only. Each uses its
existing configured role and the shared-query brief against `30539151f`. Docs
review, explicit Luna/medium, follows when a slot is free. Source changes are
paused until the complete concern wave is collected. No later slice is complete.

All shared-query reviewers completed. Main verified and accepted three concrete
corrections (one deduplicated recovery-test gap, generated runtime dependency
validation, and ordered-positive-limit documentation), and rejected the mistaken
snippet-marker extraction claim using the checker implementation. Returned one
batch to the retained explicit Sol/medium implementer, with coverage inspection
missing from its first report. Estimate for this correction/check wave: 0.17–0.33
hours active work. No full release gate or additional whole review wave yet.

To prepare approved local provider verification, main started Docker Desktop
using `open -a Docker` after the capability checks found its daemon unavailable.
No test containers or volumes have been created yet and no application/production
database is in scope. Use dedicated task resources for later live checks.
The app remains in `starting`; engine info/container-list requests return HTTP 500. Main read systematic-debugging fully and inspected only status, processes
and startup logs. No root cause is established from those logs; no reset,
update, container removal or alternate database was attempted. A nonblocking
question asks the human to check for a Docker startup prompt. Code work continues.

Shared-query corrections returned. The external packed query-only model proves
missing direct core dependency fails before output replacement, then succeeds
when declared. The internal testing fixture needed the same direct dependency;
its manifest and lockfile now include it, and frozen offline install plus
production-dependency checks pass. The two-tenant recovery test proves forced
reconnect, complete authoritative state and complete resumed updates.

Focused coverage initially failed at 86.34% branches despite 145 passing tests.
After additional behavior cases, 149 tests pass with 93.67% statements, 90.77%
branches, 93.68% functions and 96.66% lines across the shared query, generated
runtime and plugin. Individual branch coverage: 89.44%, 96%, 92.42%; no thresholds
were weakened. The report lists remaining uncovered shared-query/fallback paths.
Final normal generation, build then tooling typechecks, generated-current,
cleanup/TSDoc/copyright, changed-file lint/format, generated-doc checks and the
six-test external consumer/generator subset pass. Independent targeted API
follow-up dispatched explicitly Sol/medium; source held unchanged until its result.

Independent targeted API session `01a0ede1-455d-7050-a6bd-262eddbe8169` returned
no findings; configured Sol/medium header confirmed. Main accepts the shared-query
slice after all four concern dispositions and the focused checks above. Next:
commit/push checkpoint, verify clean-HEAD generation, then exhaustive provider and
receiving-repository reads with the retained Sol/medium implementer. Clean-HEAD
verification is a mechanical function explicitly dispatched Luna/low, isolated
from the writer. It must not modify production files or run a full release gate.

Committed shared-query checkpoint `f675c34371fdbd3b78cf5e6c33042a3a8355c622`
and immediately pushed to official origin; both commands exited 0 and the tree
was clean. Dispatched the exact clean-bootstrap test to fresh Luna/low. Resumed
the retained implementer session `01a0ed61-8899-76f2-ba6a-e5438eded07e`, explicit
Sol/medium, for the approved exhaustive provider/repository read slice using
repository-reads-brief.md and the completed seam map. No asynchronous routing or
broad example migration yet. Docker startup remains unresolved; live evidence
must be distinguished from driver mocks. No product scope or estimate change.

Fresh mechanical session `01a0ede3-ab6b-7690-b09a-ebd56a4b89bf` confirmed the
explicit Luna/low profile and exact HEAD. The clean-bootstrap test passed:
one test, 112 skipped, 34.25 seconds, command exit 0. It generated from a temporary
clean checkout of `f675c3437` without compiled proto-tools output. No matching
temporary clean-bootstrap worktree remains. This closes the shared-query
checkpoint's previously recorded clean-HEAD evidence gap.

CI access check during implementation: authenticated `gh pr list` still returns
HTTP 401. Unauthenticated official GitHub REST reads succeed and show no open PR
for `SpineEventEngine:cross-context-queries` and zero workflow runs for this branch.
Public REST is therefore an available read-only route for later CI inspection,
but there is no CI result to claim yet. No PR was created or credentials changed.

Repository implementation hit a concrete registration discrepancy: the generated
ProjectState query includes name, while the ProjectAggregate spec used by the
large-read test lists only lifecycle/version columns. Main paused only its own
active implementation CLI process before accepting a proposed universal
complete-state scan. This is a demonstrated architecture/correctness question,
not a repeated whole-plan review. Dispatch fresh read-only requirements splitter,
explicit Astra/high, to distinguish invalid fixture setup from runtime metadata
registration and choose the smallest correction preserving provider queries.
Expected investigation and integration: 0.1–0.25 hours active work, within the
original overall range. Main and reviewer do not write production code.

Requirements-splitter session `01a0edef-dce6-7821-a9ed-3e00fa5f23bc` completed,
explicit Astra/high header confirmed. It traced the production defect to
EntityDescriptors.columns(): only Projection/Process Manager declarations are
included, whereas generated query/core registration accepts Aggregate too.
SpecScanner consumes descriptors directly; this is not an import timing issue.
Main accepts the narrow metadata correction and preserving generic ENTITY policy.
Remove the unfinished whole-state scan; pass the compiled plan to current.query.
Retain valid SQL predicate/order/application-limit execution independently from
exhaustive candidate policy. Add regression assertions for materialized Aggregate
columns and preserved provider criteria, not only a matching result count.
Existing durable Aggregate definitions may require normal schema management;
no automatic migration or new registration dependency is authorized. Returned
this batch to the same Sol/medium implementation context; work continues.

Repository/provider implementation returned: 466 tests in six affected unit files
and five selected PM/public regressions pass, along with package builds,
test-inclusive typechecking, cleanup, TSDoc, formatting and whitespace checks.
Real-provider cases are added but not executed; an import-only run intentionally
skipped 23 tests and is not live evidence. Main does not yet accept readiness:
the report omits mandatory measured coverage, ESLint and generated-doc checks.
Dispatch explicit Luna/low mechanical verification for those bounded gaps, with
the writer paused and thresholds unchanged. Return deterministic failures to the
retained writer before specialist review. No full release gate in this preflight.

Mechanical session `01a0edff-1c22-7342-811e-3ad2b2813293` completed with explicit
Luna/low header: nine ESLint errors (non-null assertions/unsafe mock access/void
expressions), missing API-doc inventory entry for RepositoryReadQueries, and a
coverage-run timeout in the large-read case. There were 476 passes and one timeout
at 7.56 seconds against the default five-second limit; no coverage summary was
produced. The scan also missed the Entity-history test's entity/ path. Main returned
all deterministic findings to the same Sol/medium implementer before specialist
review. Use the normal release verification 15-second allowance, unchanged
coverage thresholds and correct test path; preserve the >10,000 boundary. Estimate
for this focused correction/check step: 0.1–0.2 hours active work.

Preflight corrections are complete. Affected ESLint, generated API/audience/snippet
docs, cleanup/TSDoc, formatting, sequential package builds and test-inclusive
typechecking pass. The >10,000 test keeps its full population; large explicit-ID
assertions use a separate fixture to avoid repeatedly scanning that population.
Nine focused unit files pass 509 tests with the existing 15-second release test
allowance. Scoped coverage across the nine selected broad source files reports
90.24% statements, 83.11% branches, 92.19% functions and 91.56% lines; command exit
1 is solely the unchanged 90% branch threshold. This is NOT a passing coverage
gate. LCOV against changed lines records 102/102 executable lines, 138/138 branches
and 29/29 functions hit. Remaining misses are older paths outside this test
selection; final verify:release must still prove >=90% project-wide coverage.
Main accepts this as the required pre-review changed-source inspection, not final
task acceptance, and will not expand an inner-loop run into the full release gate.

The nine tests cover repository routing, server index/metadata, memory record and
Entity history storage, common query policy/evaluation, and MySQL/PostgreSQL/
Datastore record storage. New targeted cases additionally exercise invalid
exhaustive policy input, nested large-ID plans, lifecycle tree traversal and
Datastore cursor handling. Real-provider tests remain pending. Source is paused
for the recorded independent concern wave against `f675c3437`.

The human restored Docker after its crash. Main verified engine 29.6.2 responds
and no containers are running. Cached MySQL 8.4, MariaDB 11.4, PostgreSQL 16/18
and Datastore emulator images are available. Dispatch Luna/low mechanical setup
to prepare dedicated local test containers, with no source edits or tests yet;
record exact resources and connection settings in the temporary report. Live
verification follows the accepted provider corrections. Setup is expected to
take 0.05–0.1 hours, excluding image startup waiting.

The three technical reviewers completed with explicit Sol/medium profiles.
Their API, reliability and style findings concern nested Datastore conjunctions,
MySQL collation-sensitive limit pushdown, unused commit handles during reads,
handle cleanup if opening commit storage fails, and two inaccurate comments.
The remaining documentation concern is dispatched explicitly as Luna/medium;
collect that result before returning one deduplicated correction batch.

Docker setup session `01a0ee11-3ae8-7721-bebe-5336f2cf4270` completed with an
explicit Luna/low header. Five dedicated containers, all with suffix
`20260929-174955`, are ready: `spine-query-test-mysql` (port 52392),
`spine-query-test-mariadb` (52393), `spine-query-test-postgres16` (52395),
`spine-query-test-postgres18` (52396), and `spine-query-test-datastore` (52397).
SQL containers have separate main/tenant-A/tenant-B test databases. Credentials
are disposable and retained only in the temporary setup report. No existing
resources were changed. This establishes readiness, not passing integration
tests; run those after provider corrections, and remove only these test resources
when all affected app/provider checks finish.

Provider corrections now pass 511 tests in the nine-file measured selection and
455 tests in the final seven-file focused selection. Type/build, lint, formatting,
cleanup, TSDoc and generated documentation checks pass. Scoped aggregate coverage
still fails unchanged thresholds (89.85% statements, 82.19% branches); this is not
the final release gate. Changed-source inspection and the correction report are
being finalized. Dispatch after source freezes: focused performance/reliability
review, fresh Sol/medium, and mechanical real-provider verification, Luna/low,
sequential engines and one test worker. Both profiles must be explicit. Live
tests cover the task-created MySQL/MariaDB/PostgreSQL16/18/Datastore instances;
leave them available for later Todo smoke. Expected live waiting: 0.1–0.3 hours.

The first live pass finished in under a minute of suite time. PostgreSQL 16/18
each passed ten cases (four other-provider cleanup skips). MySQL/MariaDB each
passed nine and failed five; Datastore passed five and failed one, with four
conditional skips each. The new ungrouped MySQL scale fixture shares its table
with existing Entity tests and adds a conflicting column; use test isolation,
not relaxed production schema validation. Datastore's Entity-family fixture lacks
the StringValue schema in its ID-encoding registry. The retained implementer is
diagnosing/correcting this setup alongside the two accepted SQL logic findings.
PostgreSQL explicitly emits NULLS FIRST/LAST already; the additional ordering
concern is resolved by inspection and regression coverage, not a new runtime fix.
The complete live/review correction batch and 0.2–0.4 hour estimate are recorded
in the review log. Containers remain ready and no other test runner is active.

Correction reruns now pass MySQL/MariaDB (14 each) and PostgreSQL16/18 (10 each),
each with four conditional other-provider skips. Datastore's new 10,002-row case
passes, but its pre-existing Entity/history case times out even in a fresh emulator
project; server logs report transaction locks. This is a demonstrated boundary
beyond read-only query changes. Main paused the sole writer before transaction
runtime changes and dispatches the existing requirements splitter explicitly as
Astra/high, read-only, to classify fixture misuse versus baseline/new runtime
defect and the smallest justified action. No redesign or new feature is approved.
Expected investigation: 0.05–0.1 hours. Current query fixes remain preserved.

The stage trace corrected the initial contention hypothesis: initial/conflict/
replay and both concurrent commits finish; one aborted transaction retries and
returns the expected conflict. All 128 history appends finish, then states.trim
hangs. Trace is retained in the temporary datastore-stage-trace.log. No baseline
checkout execution is claimed. Entity-history source is unchanged even against
original task base 2324311; its provider-page trim path does not call the new
normalized exhaustive query path. Main asked the human asynchronously whether
to include this separate history-cleanup issue. Without expansion approval,
continue the agreed routing task and record the unresolved live-suite limitation;
no transaction redesign, serialized-away assertion or longer timeout is accepted.
Temporary tracing is removed and the original 30-second test timeout restored.

Explicit all-10,002-result SQL assertions now pass on MySQL, MariaDB and both
PostgreSQL majors; the Datastore 10,002-result case passes too. Earlier complete
SQL suite results remain valid with only those assertion additions. Query-scope
checks are distinct from the still-failing Datastore history-cleanup case.

Provider/query checkpoint acceptance: 515 focused tests pass; affected build and
test typechecks, lint, formatting, TSDoc, cleanup, generated docs and whitespace
checks pass. Scoped coverage is 90.29% statements, 82.52% branches, 92.56% functions,
91.74% lines (branch-threshold failure remains explicit). All changed executable
lines are hit except one repository factory guard; SQL alternate guard branches
are partly uncovered. Full release coverage is still required after routing and
examples. Independent query-slice findings are resolved, including final complete
SQL result assertions. Commit/push this checkpoint without claiming the separate
Datastore history suite or whole extension is green.

Next phase: asynchronous query-based routing and complete recipient delivery,
estimated 0.8–1.2 hours for implementation, focused tests and concern-specific
review. Assign the existing implementer role explicitly Sol/medium in a fresh
bounded implementation context for this distinct phase; retain it for its fixes.
The completed provider context remains available for provider-specific followups.
Only one production writer runs at a time. Main keeps protocol records current;
no worktree/branch/PR changes. Read the full approved ledger and call-site map,
preserve all current query semantics, and do not expand into history cleanup
without the pending human scope decision.

Provider checkpoint `d7c795f2bc29cd2e2704741c41cc8be88a7ca9ba` was committed,
pushed immediately to official origin/cross-context-queries, and verified by
ls-remote. Worktree was clean before the next implementation dispatch. The
asynchronous routing implementer is now running with explicit Sol/medium, no
memory, no child agents and no Git mutations; main will record its configured
session header before accepting work. Provider live containers remain available
for later app checks. The human's history-cleanup scope answer is still pending.

Routing session `01a0ee3d-b929-7140-b6ba-de5a77e7cff5` confirms explicit
Sol/medium in its CLI header, with no visible fallback; separate runtime metadata
is not exposed. Inspection confirms synchronous direct/admission paths and
pre-deduplication 1,000-target rejection. The implementer estimates 1–2 hours
for this broader call-site change and focused verification. Main revised the
remaining whole-task estimate to 2–3 hours including routing, examples/docs,
reviews and final verification, excluding any newly approved history-cleanup work.

Routing implementation has stopped writing and reports 331 focused tests passing
in five files, plus production/test typechecks, ESLint, TSDoc, cleanup, formatting
and whitespace checks. Main also ran logging containment, documentation audience
and generated API checks successfully. Before specialist review, dispatch the
mechanical coverage function explicitly Luna/medium: one focused coverage run for
the four changed routing sources, changed-line/branch inspection against d7c795f2b,
and a factual report without source edits or another full suite. Runtime review
will use the frozen diff; any missing behavior evidence goes back to the same
implementation session before acceptance. The full release gate remains later.

Coverage session 01a0ee5e-a54d-7ef0-acec-6b797d82957e confirms explicit
Luna/medium in its configured header; independent runtime identity is unavailable.
Its one run passes 331 tests; statements 90.21%, lines 91.29%, functions 95.60%,
branches 80.92% (configured 90% branch gate fails). Three changed statements and
three changed branch outcomes are uncovered, with most uncovered branches in
unchanged repository paths. Main also found absent explicit acceptance tests for
async interface/default route callbacks and filtering a large find result below
the warning threshold. Before reviewers, return these deterministic coverage/test
gaps to the retained Sol/medium author; estimate 0.15–0.25 hours. Do not rewrite
unreachable legacy paths or claim the focused coverage threshold passes.

While only the routing author writes/tests, dispatch one independent read-only
example/documentation map, explicitly Luna/medium. Identify the exact Todo and
routing-example generation, registration, query and smoke entrypoints for the
already-approved final migration; report paths and existing executable checks.
This is preparation, not a new review or source-writing stream. The browser
testing skill was inspected: current app checks are the existing headless gRPC
smoke and integration harnesses, not browser UI changes, so its Playwright helper
does not apply. Reconsider it only if a changed UI actually requires browser tests.

Read-only mapping 01a0ee61-494e-7d70-89d4-a24853699907 finished; its header
confirms explicit Luna/medium. It identified Todo's manual entity-columns source,
custom generation configuration, TaskListQuery output, snippet/tests and SQL smoke
entrypoints. Main rejects its optional suggestion to select Todo recipients by
open-task count: that changes the Event's intended recipients. The implementation
brief instead uses the existing orders example for a small, separate OrderCard
demonstration with existing OrderCreated/SkuRegistered Events and an indexed SKU
field. This supplies the concrete domain model expressly allowed in the accepted
plan without modifying load-demo topology or adding another workspace package.
Todo retains meaningful existing routing and adopts the generated query imports.

Routing correction session resumes with explicit Sol/medium confirmed. Its first
red test reproduces wrong-class route attachment. The implementer estimates
0.5–0.8 hours because constructor identity must be retained through declarations
and repository option types without breaking ID-only declarations; main relayed
the revised correction estimate, replacing the initial 0.25–0.4 hours. No scope
expansion or new public concept is approved. Batch allocation, Event/state shutdown
tests and helper simplification remain in the same accepted correction batch.

The correction passes 341 focused routing tests and cheap checks. Main then
verified the built server declarations and found that private field type erasure
removed the source-only class constraint. The same retained implementation
context corrected it and added a built-declaration regression with six rejected
wrong-class cases and valid matching/ID-only cases. Follow-up build and 330 tests
in three files pass, as do the API-documentation and audience checks. The current
runtime coverage evidence remains 90.47% statements, 91.48% lines, 96.01% functions,
81.42% branches for the focused four-file subset; full-project coverage is not
yet claimed. Targeted fresh API/reliability/style reviews are running against the
correction diff, each explicit Sol/medium and no memory. Examples remain next.

Routing review converged. The final accepted test-only finding is verified for
Command, Event and state routing with distinct constructors of identical static
shape. Affected cheap checks pass; no runtime edits followed the 341-test focused
run, only emitted-type protection, consumer tests and this runtime identity test.
The six-case built-declaration regression passes. Commit/push the routing slice
now, preserving the explicit focused branch-coverage limitation until the final
release suite. Next: a distinct bounded Sol/medium example/documentation phase
using the prepared brief and read-only map, without additional branches/worktrees.
Expected remaining example/docs work and focused review: 0.5–0.8 hours; final app,
security, release and package-consumer checks follow. Keep the prior routing
implementation context available for any routing-specific correction.

Routing checkpoint 423a34ebda0fe27847a4181d2df04bb13bfd022b was committed,
pushed immediately to origin/cross-context-queries, and verified by ls-remote.
The checkout was clean before the next writer started. Distinct example/docs
implementation session 01a0ee86-8137-7912-8717-84089f8a3f13 confirms explicit
Sol/medium in its configured header, with no visible fallback; separate runtime
identity is not exposed. It has the complete ledger, prepared example brief,
read-only source map and required skills. It is the sole source/docs writer;
main handles task records. Retain this context for its review corrections. No
database runner, extra worktree, dependency change or full release run is active.

Example phase reports passing builds, 50 focused behavior tests and 129 broader
scoped tests; the final workflow-only rerun also passes 112 tests after obsolete
Todo template fixtures are removed. Executed compiled example coverage is 92%
statements, 100% branches, 94.73% functions and 100% lines. Authored-source-only
coverage initially measured zero because these tests import dist modules; it is
not reported as runtime failure or passing authored-source coverage. Snippets,
audience, TSDoc, cleanup, Proto lint, formatting and whitespace checks pass.
After the writer stops, run the prepared live Todo smoke function explicitly
Luna/low against memory and four retained SQL services, sequentially with clean
test databases and no overlapping test runner. In parallel, fresh independent
API (Sol/medium) and documentation (Luna/medium) reviews may read the frozen slice.
Then use available slots for reliability and style reviews, both Sol/medium.
All use the examples-review-brief.md and full ledger; collect the complete wave
and live evidence before returning one correction batch to the example author.

Live smoke session 01a0ee99-0799-7f00-9f4b-b9be48645835 confirms explicit
Luna/low. All five modes pass the existing Todo smoke with exit 0: memory,
MySQL 8.4.10, MariaDB 11.4, PostgreSQL 16.15 and PostgreSQL 18.6. Each SQL engine
uses a dedicated fresh spine_todo_query_smoke database in the task container.
The helper runs children asynchronously, closes each app in finally, and confirms
no app/smoke process remains. Containers/databases remain for final cleanup.
Provisioning initially returned an overall failure after PostgreSQL databases
were created; existence checks confirmed them, and no application correction was
needed. Exact logs/commands remain in the temporary todo-live-smoke-report.md;
disposable credentials are not copied into project records. Independent API and
documentation sessions explicitly use Sol/medium and Luna/medium respectively;
API completed, documentation and the remaining technical concerns are pending.

The full example review wave is collected; its accepted remaining corrections
are test/documentation-only. Final security can review stable framework runtime
in parallel without another production writer. Dispatch the existing security
reviewer explicitly Sol/high, fresh without memory/history, using
extension-security-brief.md. Main read security-best-practices/SKILL.md in full
for this protocol-required release concern. Its reference inventory has no guide
for this custom TypeScript server/SQL/generator stack; Express/Next/React/DOM
guides do not match the changed surfaces and are not loaded. Apply the skill's
general trust-boundary guidance and concrete code evidence. The user-approved
autonomous protocol governs correction authority over the skill's generic offer-
to-fix step: in-scope confirmed findings may be fixed; unrelated expansion still
requires approval. No new TLS policy, identifier validation or recipient cap is
authorized. The report belongs in the existing task review record after acceptance.

Dispatch an independent read-only release-state function explicitly Luna/medium
while the security review and test/docs correction run. Verify common workspace
version and the version-only commit, internal pins/release metadata with existing
non-mutating checks, unused registry versions for each publishable package, and
public GitHub PR/Actions state for this official branch. Do not publish, alter tags,
modify credentials, create a PR, fetch/modify a branch, run builds/tests or change
versions. Public unauthenticated GitHub reads avoid the known gh HTTP401 problem.
This does not replace exact-tarball proof or final-SHA CI after the final push.

Example corrections are accepted: settled delivery proves both manual filtering
and no-match behavior without state/Version changes; the exact documented Node
reader invocation passed; later-registration wording now matches the example.
Normal generation, affected builds, tooling types, snippets, audience, Proto lint,
generated cleanliness, formatting and whitespace checks pass. No runtime change
followed the five successful live Todo checks. Final security session
01a0eea0-8945-7ee0-ae3c-25bfb49d2c17 explicitly confirms Sol/high and reports no
actionable findings. Release-state session
01a0eea1-85b2-72c2-81a4-ba275deeb8be explicitly confirms Luna/medium; its local
version checks pass but sandbox DNS prevented registry/GitHub checks. Main can
reach the registry, so retry those read-only checks on the capable surface rather
than treating the sandbox limit as external unavailability. Separate backend
profile metadata is unavailable; no configured mismatch or fallback is visible.

Remaining estimate: 0.5–1 hour for cheap preflight completion, one converged
release gate, exact-package consumer proofs, immediate feature-branch pushes,
remote checks and disposable-container cleanup. Dispatch mechanical preflight
explicitly Luna/low, and registry/GitHub verification explicitly Luna/medium,
with no source edits or children. The former runs only outstanding ESLint,
TSDoc/cleanup, API/audience, logging, production-dependency and release-readiness
checks plus changed formatting/whitespace. Existing focused tests/builds remain
valid. After clean preflight and commit, dispatch the prepared final verification
brief explicitly Luna/low. Never overlap test runners or claim CI without the
exact remote commit's results.

Final preflight session 01a0eea6-e41c-7e20-be3a-eb2d6389b048 confirms explicit
Luna/low. ESLint catches two unused smoke imports and a static-only TaskListReader
class. Return these deterministic corrections to the same example implementer,
explicit Sol/medium, estimate 0.05–0.1 hours. Preserve the reader's documented
call shape using the project's documented object-method style, update its copied
snippet/wording, then affected tests/build/snippet checks and complete cheap
preflight. No runtime contracts change, so no new specialist wave. Prettier's
initial command had incorrect argument splitting and included deleted files;
those are checker-invocation errors, not source formatting findings.

Network verification session 01a0eea6-e890-71b1-a3bf-0ae9c2a73bae confirms
explicit Luna/medium. All 31 workspace versions agree at snapshot.17. Official
GitHub reports no open PR, no check runs/statuses and no Actions runs for this
branch. Its registry report incorrectly included private server-blackbox-tests
in a fallback scan, so main rejected that inventory conclusion and used
expectedReleaseModel(readReleaseManifests(process.cwd())) directly. All 19 actual
public package exact-version registry requests returned HTTP 404 successfully;
snapshot.17 remains unused. No package/tag/authentication writes occurred.

Mechanical example correction is verified: remove unused imports and replace
the static-only reader class with a documented frozen object, preserving both
method call signatures. Affected Todo build, both reader tests and exact guide
invocation pass. Complete cheap preflight passes: tooling types, ESLint, cleanup,
TSDoc, API docs, audience/snippets, logging, dependency policy, release readiness,
changed formatting and whitespace. Prior normal generation/Proto checks and
live-provider evidence remain applicable. Commit/push this example slice now;
then run the prepared full-release and exact-tarball brief once, explicit
Luna/low, without live database environment variables or overlapping tests.

Example checkpoint bc53aeaba9aebde8eff282e712159fa5e33601bb pushed immediately
and exact remote SHA confirmed. Final verification session
01a0eeab-9813-72e2-a16d-33e0bceccdb3 confirms explicit Luna/low. First release
attempt stopped before Vitest at the full formatter: proto-tools bootstrap
tsconfig's new generator entry needs multiline formatting. Earlier changed-file
format checks omitted that committed configuration path. Main applies Prettier
only, a micro correction with no semantic change; estimate 0.05–0.1 hours to
format and complete preflight. No reviewer lane reopens. Preserve first-attempt
logs; package proof was not run. The child accidentally wrote its scratch report
at the worktree root; main moves it to the designated temporary evidence folder.
Run the complete cheap preflight before a second release attempt; use full
format checking so committed slice configuration is included.

Formatting-only checkpoint 73565932516c797c1f23b6643d228ecf57cc928f pushed and
remote SHA verified. Preflight session 01a0eeae-c291-70f2-b6f5-6d0a1974eb56,
explicit Luna/low, passes all cheap checks and 48 focused example tests. Second
release session 01a0eeb2-7b0b-7ee3-b228-53295dd9116a confirms explicit Luna/low.
All pre-test gates pass; 305 of 306 test files and 5,126 of 5,127 tests pass.
The sole failure is the existing package-boundary guard: repository-routing.test
imports the private InMemoryEntityStorage implementation from storage/src.
Main reproduced the exact guard result without another test runner and reread
systematic-debugging guidance. Coverage is not reported on this failed run;
package proof remains unexecuted. No running test process remains.

Return this test-only correction to the retained repository-read implementer
01a0ed61-8899-76f2-ba6a-e5438eded07e, explicitly Sol/medium. Replace the private
concrete test type with supported storage contracts or a narrow test-local shape;
do not expose a private class, weaken the guard or change runtime. Preserve read,
write-count and handle-close assertions. One source writer, no children/Git or
full profile. Run the failing guard and affected repository tests, then complete
cheap preflight. No specialist lane reopens for a type-only test import correction.
Additional estimate 0.3–0.5 hours, mostly the required final verification rerun.

The retained Sol/medium implementer replaces the private import with the public
EntityStorageConformance provider type plus required close() in the test-local
alias. All runtime code and assertions are unchanged. The package guard and
repository-routing suite pass together, 334 tests in two files. Affected build,
tooling types, full ESLint/formatting, cleanup/TSDoc, API/audience/snippets, Proto
lint/current output, logging/dependencies/release readiness and whitespace checks
pass. Commit and immediately push this test-only correction, then dispatch final
release verification explicitly Luna/low, preserving prior logs and using one
test worker. Exact-tarball proof follows only a successful release gate. No
additional specialist review is required for the test type import correction.

## Final local acceptance

Correction checkpoint ed2374619bc3f75e069bf382f2d81192d9ca8f23 was pushed
immediately and its exact remote SHA confirmed. Final mechanical session
01a0eec3-14e0-7bc1-b2a2-5b1381df6b16 explicitly confirms Luna/low, with no visible
fallback; separate backend metadata is unavailable. The complete release command
exits 0: 306 files and 5,127 tests pass, with no skips reported by that suite.
Test duration is 614.63 seconds, separate from preliminary build/document checks.
Coverage: statements 93.21%, branches 90.00%, functions 92.99%, lines 94.40%.
The separate non-publishing release prepare --check exits 0 and proves all 19
exact package tarballs in an external consumer. No verification process remains;
the verified code checkout is clean. Final record-only edits do not change that
runtime, test or package tree and do not require another full release run.

The focused and independent review evidence above covers masking, common query
types/generation/consumers, repository/provider reads, routing/delivery, examples
and documentation. All accepted findings are resolved. Final security reports no
actionable findings; later changes are mechanical example shape, JSON formatting
and a test-only import correction, with their focused checks recorded above.
All participating CLI workers have exited. No further approved implementation
work remains; CI still requires a PR, which this task is not authorized to create.

Live verification is separate from the default suite: query checks pass on
MySQL 8.4, MariaDB 11.4, PostgreSQL 16/18 and the Datastore emulator, including
10,002 matching rows and late/global query cases. Todo smoke passes on memory and
the four SQL engines. Do not claim the entire Datastore integration suite passes:
its unchanged history trim path hangs after all appends, as documented earlier.
The question whether to expand scope to fix that path remains unanswered; no
history runtime change is included. Keep diagnostic logs for later investigation.

Cleanup removed only the five task-created containers with suffix
20260929-174955 and their inspected anonymous database volumes. Their disposable
test data is deleted; diagnostic logs remain. No existing containers, images or
shared resources were removed. Final registry check at 20:18 UTC confirms
snapshot.17 is unused for all 19 public packages. Final record formatting,
documentation-audience and whitespace checks pass. The branch/worktree remains
available for the human's PR; no PR, merge, package publication or npm tag change
was performed.

## Human-requested three-round review — 30 September

The human requests three sequential independent whole-branch reviews, fixing
each round before the next. This explicitly overrides the normal two-wave limit
and concern-only scope for this review task. Keep the existing branch/worktree;
initial code HEAD is 76b0839c4a386accc3180dbdd1bb084a4861d6c1 and the fixed review
base is 2324311be8c23024f66cb2ba702fbe99a99e7dfb. The checkout starts clean.
High-risk classification remains: public types/generation, storage, tenancy and
asynchronous delivery. Estimate 1–2 hours: three fresh reviews, confirmed fixes,
focused preflight, one converged release/package verification if code changes,
immediate pushes and final status. No PR, merge, publication or new version bump.

Main reread BUILD_PROTOCOL, current completion-plan workflow/blockers, AGENTS
and the expected-skills manifest. Session skill catalog plus bounded rg of the
four review/verification entrypoints and installed skill-lock confirms available
review (mattpocock) and requesting/receiving review plus verification (superpowers).
Selected instructions and the reviewer template are read fully. Apply review's
Standards/Spec axes, but the explicit single independent reviewer per sequential
round and project roles override its generic parallel-agent/issue-tracker setup.
The existing written plan supplies the base and specification; no clarification,
tracker setup or new planning files are needed. Requesting/receiving-review skills
require evidence-based findings and technical validation before fixes. No new
architecture pass is justified by review alone. Correction-specific skills will
be read if their work becomes necessary.

The bundled capable CLI is 0.158.0-alpha.2.1 and supports explicit profiles.
Each reviewer uses the existing performance/reliability reviewer function,
explicit Sol/medium, with the human-requested complete changed-branch remit,
including API, documentation and standards dispositions. Each is a new ephemeral
session, memory disabled, no inherited conversation, no prior review/work-log
reports or agent-state access, no subagents and no edits. Main records configured
header/session metadata before accepting each result; separate runtime identity
may be unavailable. Read only the requirements/design portions of the plan,
not its status/review conclusions. Prior whole-branch mechanical verification is
current for unchanged code; initial diff whitespace passes. Main corrects the
completion plan's stale extension status before review. Fixes use one retained
Sol/medium implementation context where applicable; test runs remain serial and
single-worker. Collect a full round before assigning its correction batch.
