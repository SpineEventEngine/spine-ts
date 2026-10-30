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
