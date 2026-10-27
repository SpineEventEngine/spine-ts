# Environment lifecycle reviews

## Required concerns

All full-task concerns are pending: style/maintainability, documentation,
TypeScript/API docs, performance/reliability and final release-readiness security.
Review assignments will name bounded paths, the human requirements ledger,
explicit configured model/reasoning and acceptance evidence. Historical proposal
text does not claim current implemented behavior. Collect all relevant findings
before returning one correction batch to the current implementation context.

## Product questions

No unresolved product question blocks implementation. The final human decisions
are recorded in TASK.md and PROPOSAL.md: lazy failure is request-local and
retryable; explicit startup failure is fatal; each false flag independently
selects first-input preparation. No existing-data migration is authorized.

## Retention review package

Compare baseline ff6c866 to current contents of repository.ts,
repository-routing.test.ts, storage/event/event-store.ts and its test. The first
repository portion is checkpoint c0c312b57; include unstaged corrections/EventStore.
Independent cheap preflight passed 386 tests across three suites, typechecks,
lint/format/cleanup/TSDoc/docs audience and diff checks. Exact focused LCOV covers
all changed executable lines and branches; global thresholds remain unverified.

Assignments (read-only, no child delegation; full TASK.md human ledger applies):

- Existing style_maintainability_reviewer: gpt-6-sol/medium, explicit dispatch;
  four-file structural simplicity, cleanup clarity and test quality.
- Existing performance_reliability_reviewer: gpt-6-sol/medium, explicit dispatch;
  retention identities, acquisition/close error behavior and concurrent operations.
- Existing typescript_api_docs_reviewer: gpt-6-sol/medium, explicit dispatch;
  public EventStore lifetime behavior, declarations and narrow TSDoc correctness.
- Existing documentation_reviewer: gpt-6-luna/medium, explicit dispatch;
  changed lifecycle claims, task/spec status versus implemented slices.

Runtime metadata will be recorded when exposed; configured profiles are immutable.
Collect the complete wave before fixes. Pre-existing clearRuntime/history-switch
attempt-all cleanup is recorded for the next retention slice, not claimed complete.
Historical/superseded proposal text is not current behavior. Security review is
reserved for final release readiness; no security surface changes in this slice.

Complete first review wave: API and documentation clean. Style's proposed tenant
assertion P2 was withdrawn after inspecting generated TenantId.kind: toEqual checks
both case and value. Reliability P1 accepted: EventStore.close closes a retained
handle during an admitted multi-record append, so the next write can fail after a
persisted prefix. Fix requires deterministic gated concurrent-close coverage and
keeping storage live until admitted operations settle. No other accepted finding.
All four explicit configured profiles were confirmed; runtime metadata unavailable.

A bounded architecture follow-up is justified by the demonstrated close contract
problem: EventStore.close currently returns void and some context assembly-error
cleanup is synchronous. Choose the smallest safe drain/close integration without
prematurely implementing the full context startup rewrite. Existing requirements
splitter gpt-6-astra/high reused with immutable explicit original dispatch profile.

The accepted correction fences and drains physical groups with asynchronous
EventStore.close; internal closeIdle handles idle synchronous assembly cleanup.
Author preflight passed 523 tests, storage/server/MySQL typechecks and narrow
quality checks. Independent mechanical function mechanical_checks (immutable
explicit gpt-6-luna/low) checks this expanded patch and exact changed coverage
before affected re-review. The implementer is preparing the next repository
retention slice read-only while this patch remains frozen.

Affected correction review assignments, after independent preflight:

- typescript_api_docs_reviewer, close_api_review, gpt-6-sol/medium: Promise close,
  internal closeIdle, all ordinary and synchronous cleanup callers, declarations.
- performance_reliability_reviewer, close_reliability_review, gpt-6-sol/medium:
  admitted work draining, cleanup outcome, callback gap and construction cleanup.
- style_maintainability_reviewer, close_style_review, gpt-6-sol/medium: new close
  state/helpers and deterministic tests only.
- documentation_reviewer, close_documentation_review, gpt-6-luna/medium: changed
  storage REFERENCE close paragraph and narrow lifecycle TSDoc claims only.

All assignments use explicit model/reasoning and read-only scope, without child
delegation. This is the affected second wave, not a new full-task review.

Second affected wave completed: reliability, style and documentation clean. API P2
accepted: @internal alone leaves closeIdle publicly callable on EventStore. Move
the synchronous hook behind the existing provider-internal event-store access
module; preserve its guard and all behavior. Only this materially changed API
concern needs a bounded confirmation after deterministic checks. All explicit
profiles confirmed; runtime metadata unavailable. Existing Agent integration
tests also passed (2 tests), exercising the testing helper's awaited cleanup.

API correction confirmed: private EventStore method and provider-only access seam;
public class/root declarations exclude idle cleanup. Final focused author checks
passed 534 tests, storage/server/MySQL and tooling typechecks, lint, cleanup, TSDoc,
formatting and diff checks. Independent API declaration/caller inspection and
diff check clean. P1 and P2 are resolved; all four bounded concerns accepted.
Live providers, full release coverage and final security remain pending.

## Repository query/history retention package

Next package baseline is 6ccfc3efc. After author freeze, existing mechanical
function mechanical_checks (immutable explicit gpt-6-luna/low) runs independent
focused preflight and exact changed-branch coverage before review. Review scope
will be repository storage sharing and direct-read lifetime, captured history
configuration, Process Manager retained EventStore and context cleanup callers.
The complete TASK.md human ledger applies; provider defects are a separate slice.

Repository correction preflight passed 482 focused tests and affected typecheck,
cleanup, TSDoc, ESLint and formatting. Focused coverage is used to inspect changed
branches; repository-wide coverage is reserved for final release verification.
Dead acquisition/composite-close helpers were removed and disposed lifetime maps
are cleared. Review assignments after author freeze (read-only, no delegation):

- performance_reliability_reviewer, gpt-6-sol/medium: direct read admission/drain,
  shared Entity/history ports, captured settings, rebind and attempt-all cleanup.
- typescript_api_docs_reviewer, gpt-6-sol/medium: internal cleanup API and callers,
  public history-switch behavior and API/TSDoc claims.
- style_maintainability_reviewer, gpt-6-sol/medium: retention structures, helper
  necessity and focused test quality.
- documentation_reviewer, gpt-6-luna/medium: changed lifecycle TSDoc and current
  task claims only. Broad future milestone documentation is not this review.

All profiles are explicit at dispatch. Runtime metadata is unavailable beyond
configured profiles. Full TASK.md human ledger applies; superseded historical
text is not a finding unless presented as current behavior. Collect the complete
wave before any correction batch. Expected review/integration time: 0.3–0.6 hours.

Complete repository review wave collected; explicit configured profiles confirmed,
runtime introspection unavailable. API clean. Accepted reliability P1s: protected
Agent audit reads bypass retained-lifetime admission; protected Entity state/Event
maintenance exposes raw trim/truncate operations. Both must capture the exact
lifetime, reject stale callers and drain admitted work. Accepted style P2: the
read-to-write reuse test counts two unrelated Entity openings without proving port
identity. Accepted documentation P2s: describe captured settings for in-flight
commits and include tenant/history configuration in retention identity.
Style P3 on the single-use upgrade helper is advisory; simplify only if naturally
needed by these fixes, without expanding scope. No other blocking findings.

Return one correction batch to existing implementer storage_retention, immutable
gpt-6-sol/medium; pause core-only AnyPacker edits at a safe point. Source scope
adds agent/agent-history.ts only as needed for the admitted read callback.
Estimate 0.3–0.6 hours including focused checks and affected reliability/API
confirmation. Final author preflight was 483 tests; older 478/482 counts denote
earlier snapshots, not conflicting results. Reviewer selected 434 tests plus
25 Entity tests, all passed; it did not rerun the author's exact four suites.

Repository correction frozen: 494 tests passed across five focused suites, with
server typecheck, lint/format/cleanup/TSDoc and diff checks. Exact focused LCOV
is in external repository-history-review-coverage/. Core WIP remains external
and does not affect this checkpoint. Targeted second review: existing reliability
reviewer repository_reliability_review (immutable explicit Sol/medium) checks both
protected-operation fixes; existing API reviewer repository_api_review (same
explicit profile) checks the new internal admission callback and narrow claims.
Style test assertion and wording corrections are deterministic and do not reopen
those lanes. Mechanical function mechanical_checks (immutable Luna/low) inspects
changed-branch coverage and final source/check evidence without duplicating tests.

Targeted reliability review confirmed both P1s resolved with gated tests. API
confirmed types, callers and captured-setting documentation; accepted final P2
is purely deterministic callback naming (admit/read must use on-prefixed names).
Rename in the same implementation context, run affected narrow checks, and do not
reopen specialist lanes for a name-only correction. Estimated 0.05–0.1 hours.

Repository slice converged: both reliability P1s and all accepted P2s resolved.
Naming-only correction passed 37 affected tests and all narrow checks. Independent
final preflight confirmed recorded 494-test run and coverage of both Agent admission
outcomes and all three maintenance delegates; tooling typecheck, docs audience and
diff check passed. Idle retained-EventStore failure and prepared-repository close
delegate are not naturally reached by synchronous assembly, which acquires no
repository storage; the underlying idle seam is tested directly. No coverage-only
fixture is added. All four concerns accepted; full release/security remain pending.
Checkpoint includes only the five authored source/test files and current task
records, excluding generated manifest stamps and external AnyPacker WIP.

## AnyPacker review wave

Baseline f8a663cbe. Scope: common JVM-like AnyPacker, per-occurrence JSON URL
preservation, explicit semantic validation, adoption across callers and provider
history, Any-valued services, generic domain-correct conformance, public docs
and narrow checker updates. Final author preflight: 84 tests in five suites,
generated build, cleanup, TSDoc, changed ESLint, formatting, docs and diff checks
passed. Earlier broad runs and independent changed-core coverage are recorded
in WORK_LOG.md and external evidence. No release-profile claim.

| Existing role                    | Assignment                    | Explicit configured profile | Concern                                                                       |
| -------------------------------- | ----------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| performance_reliability_reviewer | any_reliability_review        | gpt-6-sol / medium          | Any round trips, validation, caller correctness and error behavior            |
| typescript_api_docs_reviewer     | repository_api_review (reuse) | gpt-6-sol / medium          | Public packer and conformance contracts, declarations and narrow API claims   |
| style_maintainability_reviewer   | any_style_review              | gpt-6-sol / medium          | Changed helpers/refactoring, fixture/domain style and quality-checker changes |
| documentation_reviewer           | any_documentation_review      | gpt-6-luna / medium         | Supported behavior claims and examples; scheduled as capacity frees           |

New dispatches explicitly set model and reasoning; reused API profile is immutable
and originally explicit. Runtime introspection is unavailable. No child delegation
or source edits by reviewers. Collect the whole concern-specific wave before
sending one accepted correction batch. Estimate 0.3–0.6 hours including review,
correction, targeted checks and checkpoint push. Full release/security remain
final-task gates.

Complete Any review wave collected. Configured profiles match recorded dispatches;
no actual runtime metadata is exposed. Documentation's first source comparison
used the primary checkout and was rejected; rerun with explicit assigned workdir
confirmed the stale docs findings against the correct implementation. Accepted:

- Reliability P1: standalone produced Command/Event/rejection payloads lost
  validation before publication, including all-results validation before any
  multi-output publication. Restore explicit semantic validation and regression
  tests using actual constrained domain messages.
- Reliability P2: subscription ID filters fail declared Any IDs; apply the same
  envelope handling as query/field filters with a focused Any-ID subscription test.
- API P2: optional unpack helpers must accept undefined and return it before
  schema/registry lookup; strict helpers remain required and throwing.
- Adoption P2: integration intake still decodes an Any payload directly. Preserve
  exact accepted alias lookup while using the shared registry-aware packer.
- Style P2: conformance query fixture can hide ignored filters because sorting
  already selects the expected record. Make the predicate decisive.
- Documentation P2: docs/api/README.md still lists removed symbols;
  docs/architecture/README.md promises removed unknown-field/unpack semantics.
  Correct current API inventory and behavior. Reviewer marked these High; the
  orchestrator classifies them as P2 documentation defects, not runtime P1.

One correction batch goes to existing implementer storage_retention, immutable
explicit Sol/medium. Expected 0.3–0.6 hours for corrections, focused preflight and
affected reliability/API confirmation. Deterministic docs and fixture assertion
corrections do not reopen those lanes. No new full review wave for cosmetic work.

Correction tests exposed a related Any-ID storage failure. Parent inspection
confirmed entity-storage-descriptor.unpackMessageId still expected a nested Any,
while the accepted packer returns an existing Any unchanged. This is part of
adoption, not an unrelated provider limitation. Correct the shared ID codec and
use a real storage-backed subscription regression; a mock-only test is not an
acceptable substitute. Include this exact path in targeted reliability review.
The first correction run otherwise passed 194 tests across six affected areas.

Broker correction was narrowed after inspecting EventDispatcherRegistry: both
dispatcher and schema-only registration derive complete keys from TypeUrls.derive.
The presumed accepted alias case is not reachable in current EventBus. Use direct
typed AnyPacker.unpack after its existing exact accepted-type lookup; do not
allocate a temporary registry or introduce alias support. Core unpackUsing still
tests genuine explicitly registered aliases. Real storage-backed Any-ID selection
and exclusion now pass; Proto lint, source verification and generated-current
checks passed. Docs must run after build-output cleaning completes.

Correction freeze: 227 focused coverage tests across six suites and 48 broker
tests after canonical lookup simplification passed. Generated and tooling
typechecks, Proto lint/source/generated-current checks, docs, cleanup, TSDoc,
changed ESLint/format/copyright and diff checks passed. Targeted confirmation
reuses any_reliability_review and repository_api_review, both immutable explicit
Sol/medium. Reliability checks explicit validation/atomic multi-output behavior,
real Any-ID storage/subscription path and broker shared decode. API checks
optional absence and narrow declarations/docs. Style and documentation fixes are
deterministic; independent mechanical inspection covers their current evidence.
No general review rerun or full release-profile invocation.

Targeted API and reliability confirmation resolved all prior findings. No source
edits or broad verification reruns by reviewers. The code's Any-ID path is covered
by a real-storage behavior test; independent LCOV inspection noticed zero counters
but the record contains both old/new function positions, so its initial gap claim
is provisional. Rerun that one test after the final generated build to resolve
mapping ambiguity rather than add coverage-only assertions.

Fresh isolated Any-ID subscription run passed but confirmed descriptor extraction
remains unhit. Parent source inspection found the scenario posts System Events
without persisting Entity state, so its earlier retained-state claim was too
broad. Add a focused Any-ID storage/descriptor round trip alongside existing ID
codec tests, rename the subscription scenario accurately, and replace its new
25 ms wait with the existing activation acknowledgement. This is a test/evidence
correction in the same implementation context, estimated 0.1–0.2 hours; no
production contract or specialist lane reopens.

AnyPacker milestone accepted. Final evidence-only correction passed both named
behavior tests and tooling/lint/format/diff checks. Fresh narrow LCOV confirms
Entity ID extraction executes through real in-memory write/read and preserves
the full packed identifier; unequal ID lookup stays absent. The subscription
scenario now waits for an activation ACK and accurately describes System Event
filtering. All four canonical review concerns have accepted dispositions, all
confirmed findings are resolved, and no runtime change followed the targeted
reviews. Full-task release/security gates remain pending. Commit authored code,
Proto fixtures, tests, docs/checkers and task records; retain generation-only
manifest churn outside this checkpoint until coordinated convergence.

## Provider lifecycle and retention review wave

Baseline 0974d7627 to the frozen M3 working tree in the environment-lifecycle
worktree. Runtime/test scope: retained private provider commit storage, awaitable
factory/commit close, synchronous rollback, custom Datastore bundle disposal,
Datastore trim progress, caller awaits and ordinary provider Any helper adoption.
The latest unconditional domain-state registration rule is recorded for M6;
no test exception or disabling switch may be introduced. Later milestones are
not current M3 runtime claims. Shared AnyPacker design is already reviewed.

Cheap preflight: 563 combined tests, final 64-test targeted coverage, 15 extra
Agent/provider tests; PostgreSQL/Datastore 13 each, MySQL/MariaDB full non-tenant
suites plus separately passing current tenant cases. Typechecks, scoped lint,
TSDoc, cleanup, docs API/audience/snippets, formatting and diff checks pass.
Parent LCOV inspection confirms the specific previously missing failure paths.
Exact commands and limitations are in external provider-correction-evidence.md.

| Existing role                    | Assignment                    | Explicit configured model / reasoning | Scope                                                                                                 |
| -------------------------------- | ----------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| performance_reliability_reviewer | provider_reliability          | gpt-6-sol / medium                    | Admission, drains, retained records, rollback, error aggregation, Datastore paging and custom bundles |
| style_maintainability_reviewer   | provider_style                | gpt-6-sol / medium                    | Changed runtime structure, bounded helpers, clarity and unnecessary abstractions                      |
| typescript_api_docs_reviewer     | repository_api_review (reuse) | gpt-6-sol / medium                    | Awaitable public/provider contracts, caller propagation and narrow API/TSDoc                          |
| documentation_reviewer           | provider_documentation        | gpt-6-luna / medium                   | Changed storage README/REFERENCE and lifecycle claims                                                 |

Explicit model/reasoning fields are required for new dispatches; the reused API
reviewer retains its verified explicit immutable profile. Runtime introspection
is unavailable. No child delegation or source edits. Three technical concerns
run first; documentation follows as capacity frees. Collect all findings before
one accepted correction batch. No whole-change re-review for deterministic
record/format changes. Review outcomes pending.

M3 full concern wave collected. All dispatch profiles matched the required explicit
models/reasoning; runtime self-introspection was unavailable. Reliability reported
P1 input capture before commit tracking in all four providers and P2 memory/
Datastore closed roots retained indefinitely. Parent inspection confirms SQL row
validation also invokes supplied ID unpack/key callbacks before tracking, so the
same admission correction covers validation and capture. API reported P2 missing
awaits in project-worker.mjs, sql-recovery-writer.mjs, deployment provider tests,
deployment-gce registry-reader tests and deployment README; also stale exported
Storage TSDoc. Documentation confirmed the README issue and stale storage
REFERENCE provider lifecycle comparison. Style found no P0-P2 issues; accept its
two local TSDoc corrections for CommitHandles and PostgresCommitRecords.

One accepted correction batch, estimated 0.3-0.6 hours: fence/check open and track
the full admitted commit before configurable callbacks, remove closed factory
roots only after settling (including idle disposal), propagate awaited closes,
correct narrow documentation, and add focused reentrant-close/retention tests.
Do not add a lifecycle abstraction or weaken independently closeable handles.
Targeted reliability/API confirmation follows deterministic checks; style and
documentation corrections need only mechanical/source verification. Original
implementation context should be reused if available; otherwise resume its exact
frozen state in one replacement implementer, Sol/medium.

M3 accepted corrections are frozen. Focused preflight passes 104 tests with fresh
LCOV after the final Datastore idle/async-close race regression; earlier six-suite
run passed 111. Build/tooling typechecks, lint, cleanup, TSDoc, docs and scoped
formatting pass. Parent formats its record-only changes. Reuse provider_reliability
and repository_api_review with their explicit immutable Sol/medium profiles for
targeted confirmation only. The parent-detected premature removal after failed
idle close was reproduced and corrected in this same batch. Read-only style/docs
corrections need no reopened lane. No full release gate yet.

M3 accepted: targeted API and reliability confirmations resolve every prior P1/P2.
Parent independently inspected fresh LCOV for callback admission and terminal
cleanup, including success/error removal. All four canonical concerns accepted.
The Datastore reference's remaining stale final paragraph was corrected and
formatted deterministically after review; no runtime change. Global formatting
and diff checks pass. Complete release/security gates remain deferred until the
coordinated task converges. The provider patch is ready for checkpoint commit and
immediate push; generation-only manifest churn remains unstaged.
