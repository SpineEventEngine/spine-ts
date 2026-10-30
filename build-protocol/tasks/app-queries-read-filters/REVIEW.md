# Review record

Implementation active. Per milestone, record style/maintainability,
documentation, TypeScript/API docs, and performance/reliability dispositions.
Relevant existing reviewers use explicit Sol/medium; documentation Luna/medium.
Final security: existing security_reviewer Sol/high after convergence.
Pre-review deterministic checks precede review. Collect complete waves before
returning one correction batch to the existing implementer.

The approved design received independent typescript_api_docs_reviewer
Sol/medium review before implementation authorization; no actionable findings.
This is not implementation or runtime verification.

## M01 planned review assignments

Dispatch only after implementer handoff and cheap preflight. All reviewers read
TASK.md Human-Imposed Requirements Ledger, approved PROPOSAL validation section,
M01.md, and concern-specific diff. Historical/superseded records are not findings
unless current claims adopt them. No grandchildren or production changes.

- Existing style_maintainability_reviewer, explicit gpt-6-sol/medium: core
  validation module structure, existing dependency reuse, short clear methods.
- Existing typescript_api_docs_reviewer, explicit gpt-6-sol/medium: optional
  TypeRegistryLookup extension, error distinction, paths, declared recursion,
  shipped package declarations/runtime contract, semantic fixture quality.
- Existing performance_reliability_reviewer, explicit gpt-6-sol/medium: nested
  traversal/isolation, duplicate reports, bounded behavior, registry lookup,
  failure/sanitization paths, and compatibility with existing validation callers.
- Existing documentation_reviewer, explicit gpt-6-luna/medium: changed core
  README/REFERENCE/TSDoc and example meaning only.

Use three available child slots for the independent technical lanes, then the
documentation lane when capacity permits. Collect complete findings before any
corrections. No dedicated security review until final release readiness.

## M01 complete review wave and accepted correction batch

All four configured roles explicitly dispatched with expected model/reasoning;
Sol/medium technical reviewers and Luna/medium documentation. No runtime
self-introspection available and no visible profile mismatch. Accepted the
immutable dispatch/profile evidence. Reviews completed; production stayed frozen.

- API P2: missing numeric/bool required collection members pass. Accept; reject
  null/undefined without rejecting 0/false.
- API P2: absent recursively validated Any collection member becomes a technical
  exception. Accept; preserve required violations and avoid traversing absent
  entries. Cover list and map combinations.
- Style P2: method comments contradict presence semantics. Accept; align them
  with implemented scalar defaults and collection handling.
- Docs P3: narrow README registry wording to types outside descriptor closure.
  Accept as bounded accuracy correction.
- Reliability P3: nested registry-only Any + required members, and throwing
  registry lookup regression tests. Accept; inexpensive tests cover newly added
  execution branches and error classification. No extra infrastructure needed.

One correction batch returns to the existing M01 implementer. API/reliability
receive targeted substantive re-review after tests; deterministic comments do
not reopen style/docs lanes. Estimate 15–25 minutes. Full release gate remains
reserved for integrated task convergence.

## M01 targeted correction review dispatch

Focused 79 tests, >=90% scoped coverage, generated build, lint/format/TSDoc and
installed consumer proof are green after corrections. Main rechecked diff,
docs audience and installed consumer. Reuse API and reliability reviewers with
immutable explicit Sol/medium configured profiles for the accepted behavioral
fixes only; no second full wave, no production edits. Style/documentation fixes
are deterministic wording corrections accepted by main. Runtime metadata remains
unavailable. Production/test freeze continues during targeted review.

### Targeted result and final bounded correction

API accepted both P2 fixes with no new finding. Reliability confirmed explicit
null/undefined handling and nested/lookup tests, but found sparse list holes are
misclassified as technical errors: Array.map preserves holes and the supplement
then destructures undefined. Main reproduced with installed core and a valid
ProjectBatch except counts=Array(1): sanitized technical Error instead of a
counts.0 constraint. Accept P2. Return this single correction to existing
implementer; use dense indexed iteration preserving all indices and test sparse
required scalar/Any members. Estimate 5–10 minutes. No further complete review
wave; behavior-specific checks and reliability confirmation only.

## M01 convergence

2026-10-30 18:04 UTC: sparse P2 independently confirmed resolved (published
IdFilter sparse repro gives id.0 constraint). No remaining P0/P1 or accepted P2.
All four concerns accepted; P3 regression suggestions also implemented. Main
rechecked wording corrections,81focusedtests,installedconsumer and diff. Record
reviewers completed; no active reviewer work remains. Checkpoint ready to push;
whole feature is not complete. Next slice is M02 under the same implementer.

## M02 planned review assignments

Base3227be3ac, including all untracked M02 files. Dispatch only after frozen
handoff, focused checks/coverage and deterministic docs/status preflight. Ledger
TASK.md plus M02.md/PROPOSAL validation requirements bind each affected concern.
Historical completed records outside active claims are not findings. No writer
other than current implementer; no reviewer source edits or descendants.

- Existing style_maintainability_reviewer, explicit Sol/medium: changed bus/error
  structure, shared generated-registry reuse, small documented callables.
- Existing typescript_api_docs_reviewer, explicit Sol/medium: full envelope vs
  declared nested constraints, enum-qualified Ack type/code/details, public
  validation automatic registry behavior, domain-correct fixtures.
- Existing performance_reliability_reviewer, explicit Sol/medium: validation
  before admission/dispatch/storage, queue/lifecycle behavior, technical failure
  classification, cached descriptor inventory changes and mutations.
- Existing documentation_reviewer, explicit Luna/medium: changed README/
  REFERENCE/TSDoc claims only. No documentation skills, per user.

Collect all four completed concern results before one correction batch. Reuse
existing implementer for corrections. Final release/security remain later work.

## M02 full-wave dispositions and correction assignment

All four concerns completed under recorded explicit profiles; no visible model
mismatch, actual runtime metadata unavailable. Main reran installed automatic
registry proof, diff/docs checks and independently calculated changed coverage
(28/29 statements,21/22 branch arms) from V8 data. Runtime remained frozen.

- API P1 accepted: check decoded Command payload against schema default after
  unpacking and before admission/dispatch. Existing CreateNumberedProject
  fixture demonstrates default int32 payload bypassing implicit ID checks.
  Add direct-bus and service Ack regressions with structured validation detail.
- Style P2 accepted: Event producer identity must use the actual producing
  Entity ID type (or its correct primitive-ID packing), not UserId. Correct new
  cases and the same helper they reuse without substituting another concept.
- Style P2 accepted: CommandValidationError constructor parameter TSDoc now
  covers envelope and payload, not payload alone.
- Docs P3 accepted: explain technical COMMAND_POST_ERROR vs INVALID_COMMAND
  in the existing server REFERENCE paragraph.
- Reliability proposed P2 not accepted as a current task defect. Main inspected
  every production setAdmission registration: only BoundedContext's internal
  tenant-reading callbacks at bounded-context.ts:1085–1089. Access objects are
  absent from public package exports; callers cannot install callbacks through
  the public API. They do not mutate envelopes, and this callback ordering was
  already present for configured admission before M02. The proposed repro
  replaces trusted internal framework code with a mutator; it establishes a
  hypothetical internal misuse, not an exposed mutation path. Record as P3
  advisory, without extra copies on every signal. Public caller mutation is
  already isolated by enqueue cloning. Revisit only with a reachable extension
  that actually receives this envelope or a demonstrated regression.

One correction batch to existing implementer, estimate10–15minutes. API targeted
re-review after behavior tests; deterministic fixture/comment edits do not reopen
style/docs. No second full wave or full release profile. M03 remains prepared.

### M02 targeted API confirmation

Dispatch to existing `app_query_m01_api` TypeScript/API reviewer, retaining its
explicitly configured `gpt-6-sol` / `medium` profile. Scope: accepted decoded
default Command payload finding and its bus/service regressions only. No new
review wave for deterministic fixture/doc corrections. Runtime model metadata
is unavailable; immutable configured profile remains the acceptance evidence.

M02 targeted API confirmation resolved the P1. No remaining P0–P2 finding.
Style and documentation corrections were checked deterministically; reliability
advisory disposition is recorded above. Configured profiles matched the explicit
dispatches, with no visible fallback. M02 is accepted as an intermediate slice.

## M03 review preparation

Base: accepted/pushed `cc19b416d`. Freeze after current preflight, then reuse
existing configured reviewers, whose original dispatches explicitly selected
model and reasoning. Runtime metadata is unavailable; immutable profiles remain
the acceptance evidence. No source writer overlaps review.

- TypeScript/API: app_query_m01_api, gpt-6-sol/medium. Query/Topic/Subscription
  admission and structured RPC contract, tenant distinctions, generic oneof/Any
  validation and schema/provenance compatibility. Include untracked new status
  module and the full TASK ledger, not only tracked diff.
- Performance/reliability: app_query_m01_reliability, gpt-6-sol/medium.
  Validation before side effects, caller isolation, native/gateway/coordinator
  error propagation, lifecycle cleanup and shared validator traversal behavior.
  M04 unknown activation and M08 trust changes are not current claims.
- Style/maintainability: app_query_m01_style, gpt-6-sol/medium. New status helper,
  shared validator view, exact source adaptation/verifier and affected runtime
  structure/fixtures, with mechanical results supplied.
- Documentation: app_query_m01_docs, gpt-6-luna/medium. Current package/API/status
  claims and changed public examples only; immutable proposal and historical
  records are context rather than current behavior documentation. If the role
  cannot write a report, main records its returned findings.

Collect the complete relevant wave before one correction batch. Security remains
M14; no separate security review is invoked for this slice.

### M03 dispatch and preflight acceptance

Main confirmed the final diff check. M03 evidence records 381 focused tests,
75 shared-runtime regressions, 96.2% changed-statement and 94.1% changed-branch
coverage, generated build and installed-package proof. Review estimate is
0.25–0.5 hours including corrections. API reuses the explicitly configured
Sol/medium reviewer. Earlier reliability/style/docs contexts are no longer
listed by the execution surface, so their existing roles are redispatched as
app_query_m03_reliability and app_query_m03_style (explicit Sol/medium), and
app_query_m03_docs (explicit Luna/medium), with the same bounded scopes above.
No role is added or changed. Actual runtime metadata remains unavailable.

## M03 complete wave and correction batch

All four concerns completed with the explicit profiles recorded above; no
visible mismatch and no runtime self-introspection. Main independently reran
the final installed-consumer proof successfully. Production remained frozen.

- API: clean.
- Reliability P2, independently also style P2: accept lifecycle semantic gap.
  Reject target-independent malformed Topic shapes, including includeAll=false
  and empty filters, before Activate/Cancel lookup, mutation or Coordinator
  pending-activation cleanup. Preserve canonical stored Topic routing and
  idempotent valid unknown cancellation; do not invent client Topic equality.
- Reliability P2: accept sanitization gap. Unexpected storage/read exceptions
  remain technical faults even if wrapped as ConnectError. Preserve deliberately
  produced framework tenant/auth/cancellation/availability statuses at their
  correct boundaries; do not blindly expose arbitrary adapter errors.
- Style P3: accept deletion of obsolete Query error-response helpers after
  confirming no callers remain.
- Docs P3: accept concise Topic/lifecycle status details in current API guide.

One batch goes to the existing Sol/medium implementer. Estimate 0.25–0.5 hours
for corrections and focused verification. Targeted reliability confirmation
will cover the two behavioral corrections; deterministic helper/docs changes
do not reopen full lanes. M04 remains pending acceptance and push of M03.

### M03 convergence

Targeted reliability confirmation resolved both P2 findings. Main confirmed
obsolete helper removal and Topic/lifecycle documentation details, and reran
git diff --check. All four concerns are accepted; no remaining accepted finding.
Correction evidence: 3 red then 3 green tests, 175/175 affected tests, 375/375 scoped tests,
97.6% changed statements and 96.4% branch arms, affected build and cheap checks. The earlier
456-test shared/transport run and installed consumer remain valid for untouched
core/Proto code. Full release and security gates remain M14.

## M04 planned review assignments

Base: accepted/pushed 54520ee63. Dispatch after frozen handoff and focused
preflight. Read TASK ledger, M04.md and the unknown-activation/recovery section
of PROPOSAL.md. Existing reviewers retain their explicitly configured profiles;
actual runtime metadata remains unavailable. No source edits or descendants.

- app_query_m01_api, TypeScript/API, gpt-6-sol / medium: enum-qualified
  UNKNOWN_SUBSCRIPTION and NOT_FOUND contract, native/Connect details, exact
  client error classification and preservation of valid/invalid distinctions.
- app_query_m03_reliability, performance/reliability, gpt-6-sol / medium:
  registry missing/expired versus duplicate/closed behavior, activation races,
  bounded fresh-ID recovery, cancellation, Entity resynchronization/Event gaps.
- app_query_m03_style, style/maintainability, gpt-6-sol / medium: bounded
  runtime changes, reuse of queues/status helpers, domain fixtures, TSDoc.
- app_query_m03_docs, documentation, gpt-6-luna / medium: changed lifecycle
  and retry claims in current API/package docs, no broad tutorial expansion.

Collect the complete relevant wave before corrections. Final security and
release gate remain M14. Deterministic record wording corrections to M13 source
inventory are complete; they do not add a runtime review lane.

### M04 review dispatch

Final 291-test focused run, affected generated build and cheap checks passed.
Changed coverage is 93.8% statements and 94.7% branch arms. Main independently
confirmed git diff --check and inspected M04 evidence. The three technical
reviewers are dispatched with their immutable explicit Sol/medium profiles;
documentation follows as a slot becomes available. Estimate: 0.2–0.4 hours
for review and bounded corrections. Production remains frozen.

## M04 complete wave and correction batch

All four concern reviews completed using recorded explicit profiles; no visible
mismatch, runtime self-introspection unavailable. API and reliability are clean.
Accept style P2: new mocked successful recovery paths must use complete,
domain-correct Topics and authoritative Query requests, not empty Topics or a
fictitious Entity type URL. Validate requests observed by the mock transport
where useful so it cannot silently accept shapes the actual service rejects.
This is a fixture correction, not runtime expansion. Accept docs P3: state
that well-formed unknown cancellation remains OK.

One correction batch to existing implementer; estimate 0.1–0.2 hours for valid
fixtures, focused tests and documentation checks. Runtime is unchanged, so
reuse runtime coverage/build evidence; focused client suite and fixture
validation checks suffice. Main will inspect deterministic corrections; no new
complete review wave or broad test run.

### M04 convergence

API and reliability clean; style fixture and documentation corrections are
resolved by main inspection. Seven fixture-validation failures reproduced the
issue before correction; the complete client suite passes 115/115 afterward.
Scoped lint/format/docs/diff checks pass. Runtime stayed unchanged, so the
291-test runtime evidence and coverage/build remain current. All four concern
dispositions accepted, with no remaining finding. Checkpoint ready to push.

## M05 planned review scopes

Base: accepted/pushed 044640283. Wait for completed consumer migration and
preflight before review. Include every untracked runtime/generation module.
Read TASK ledger, M05.md, M05_BASELINE.md and approved discovery contract.
Existing profiles remain explicit Sol/medium for API, reliability and style;
Luna/medium for docs. Runtime metadata unavailable; no visible fallback.

- API: generated output/exports, removed root API, useful explicit registries,
  exact-constructor lookup, ordinary Proto registration and model-only safety.
- Reliability: passive imports, missing/stale/conflicting descriptions,
  initialization-cycle diagnostics, class-selection isolation, staging/cleanup
  atomicity and inventory behavior across contexts. No active handlers in globals.
- Style: small runtime inventory and generator changes, existing mechanism reuse,
  class/startup module separation and domain-correct fixtures.
- Docs: narrow bootstrap/root migration and current public claims, examples and
  packaging references. Transitive discovery and App Queries remain M06/M07.

No dedicated security review until M14. Collect all relevant results before
one correction batch; do not reopen previously accepted slices without new
evidence in the affected execution paths.

### M05 reviewer allocation before dispatch

Use existing role identities with these explicit profiles after the frozen
preflight handoff; dispatch is not yet started:

- app_query_m05_api: typescript_api_docs_reviewer, gpt-6-sol / medium.
- app_query_m05_reliability: performance_reliability_reviewer, gpt-6-sol / medium.
- app_query_m03_style: reuse style_maintainability_reviewer, immutable explicit
  gpt-6-sol / medium from its original dispatch.
- app_query_m03_docs: reuse documentation_reviewer, immutable explicit
  gpt-6-luna / medium from its original dispatch.

New review contexts use fork_turns=none with both fields explicit. Runtime
self-introspection remains unavailable; inspect visible metadata for mismatches.
The prior API/reliability contexts are no longer listed on this execution surface.
Review all introduced and exposed M05 behavior, including new files and bounded
helper documentation. Historical task text is not active behavior unless the
current task records or changed public documentation make that claim.

### M05 preflight evidence received

Affected runtime tests pass 422/422; final tooling batch passes 222/222.
Generation/freshness, tooling typecheck, scoped ESLint including new declaration
modules, canonical TSDoc, format, audience and whitespace checks pass. Four-file
coverage run passes 194/194; changed production coverage is 74/76 statements
(97.4%) and 29/30 branch arms (96.7%). Static image contract passes 4/4; the
stale local image execution is explicitly pending rebuilt-image proof in M14.
The required helper documentation is now clean without checker/debt changes.

Main inspected the two prior CommandBus void callback fixes and record-only
formatting changes. New source files are marked intent-to-add so all reviewers
see them in the diff. Final M05 evidence handoff precedes dispatch. Estimated
review/correction window: 0.3–0.6 hours; production remains frozen during review.

### M05 complete wave and accepted correction batch

All four concerns completed under the recorded explicit profiles; no visible
mismatch. API and style overlap on custom registry names; consolidate this as
P2 with style's additional Proto-module import collision case. Accept reliability
P2: retired-output validation/removal must not throw after leaving a new pair
live. Prevalidating the path alone is insufficient for a subsequent removal I/O
failure; retain rollback for all operation failures. Accept the narrow current
guide corrections, deduplicating the USER_GUIDE report.

Existing implementer receives one correction batch: supported custom metadata
export/bootstrap bindings and collision-free Proto module imports; safe retired
file cleanup with failure regressions; current workflow/path wording. Estimate
0.25–0.5 hours. Reuse unchanged runtime/BC evidence and run focused generator
tests, affected tooling/typechecking and cheap checks. Targeted API/style and
reliability confirmation only for their substantive corrections; main verifies
deterministic documentation. No new whole-change review wave.

### M05 convergence

All accepted findings resolved. API/style confirm coherent bootstrap export
bindings and collision-safe Proto imports, including the additional
registerSpineMetadata export collision found by main during correction.
Reliability confirms retired-path validation and rollback on removal failure.
Main confirms current guide wording and paths. Same explicit profiles retained;
no visible mismatch and runtime metadata unavailable.

Seven regressions red then green; final generator suites 53/53 including compiled
source proofs. The preceding affected generator/tooling batch passed 321/321.
Build, tooling typecheck and cheap checks pass. Corrected generator coverage is
371/383 statements and 176/189 branches; changed 60/61 statements and 28/29 arms.
The unchanged BC/runtime evidence remains applicable. No further review wave.
