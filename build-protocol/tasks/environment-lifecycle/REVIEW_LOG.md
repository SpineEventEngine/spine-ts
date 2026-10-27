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
