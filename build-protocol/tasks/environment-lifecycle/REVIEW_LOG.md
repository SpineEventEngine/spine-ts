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
