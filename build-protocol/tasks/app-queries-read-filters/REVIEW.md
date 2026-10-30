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
