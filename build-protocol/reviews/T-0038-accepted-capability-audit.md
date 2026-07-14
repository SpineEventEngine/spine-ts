# T-0038 Review Log

Status: Row 23 style/docs rereview assigned

## Review Scope

- Baseline: `75340852`.
- Artifact: `build-protocol/release/INITIAL_RELEASE_CAPABILITY_MATRIX.md`.
- Review the matrix and current T-0038 records, not the full repository diff.
- Historical superseded text is non-actionable unless the matrix or current
  active records claim it as release state.

## Concern Dispositions

- Style/maintainability: review closed with accepted matrix-structure and
  durable-record corrections; re-review follows child integration.
- Documentation: review closed with accepted routing, governing-path, example,
  and historical-status corrections; re-review follows child integration.
- TypeScript/API docs: review closed with accepted type-URL defect and complete
  package export-subpath inventory requirements; re-review follows children.
- Performance/reliability: review closed with accepted framework-owned local
  multi-process execution defect; re-review follows child integration.
- Security: deferred to final T-0041 by protocol; no per-task security lane.

## Historical Reviewer Profile Plan

- Documentation reviewer: explicit `gpt-5.6-luna` / medium, no subagents.
- Style/maintainability, TypeScript/API docs, and performance/reliability:
  explicit `gpt-5.6-terra` / high, no subagents.
- Actual immutable runtime-role metadata must match before accepting results.

## Current State

T-0038a and T-0038b are integrated, post-merge verified, and represented by the
refreshed matrix. The integrated review wave is complete and its accepted local
record corrections are applied. Current path is local fix acceptance, affected
style/documentation/TypeScript/API rereview, then parent final verification.
Reliability remains CLEAN; security remains deferred to T-0041.

## Historical Pre-Review Lint

- At the earlier pre-review boundary, status headers were synchronized across
  all four records. That assertion is historical, not the current status.
- The matrix's routed gaps and reviewer-pending state are current statements
  rather than stale prior-round claims. No unsupported current-doc mismatch or
  resolved generated/build precondition remains current.
- Focused scans found no forbidden ordinary-example handler API use and no
  package-root export of internal delivery-loop/direct-drain primitives.
- Prettier passed for every owned file and `git diff --check` passed.

## Skill Applicability

- `2026-07-14`: task-relevant inventory evidence, the expected-skill manifest,
  complete readable user entrypoint enumeration, and the installed lock were
  checked. `verification-before-completion` was selected and fully read for
  fresh-evidence closure claims. Workflow skills that require worktree creation
  or subagent dispatch are N/A: the assignment provides the worktree and
  forbids subagents. Audit-only scope also makes planning, ADR, runtime,
  TypeScript, testing, and JVM skills N/A.

## Coordinator Pre-review Finding

- `2026-07-14T01:10:13Z`: actual Terra Medium implementer profile matches
  explicit immutable-role dispatch; agent closed, no subagents.
- Generated/build setup resolves the author's environment concern. TypeDoc/API
  export checks pass at 100/28/205/19/17/3, focused capability tests pass 5
  files / 64 tests, and cleanup enforcement passes.
- Before review, correct the unsupported stale-doc classification and replace
  resolved precondition language with executable green evidence. T-0039 remains
  planned but is not a found mismatch absent a concrete false current claim.

## Final Pre-review Classification Finding

- `2026-07-14T01:13:45Z`: normalize row 29 to the exact `IMPLEMENTED` token and
  keep its closure qualifier in evidence. Strict count must then prove 23
  implemented, four exclusions, one example gap, and one security gate.
- Repository generated-clean check passes. Re-review remains pending after this
  same-context correction.

## Independent Review Assignment

- `2026-07-14T01:15:54Z`: implementer accepted/closed at actual Terra Medium
  from explicit dispatch and immutable role metadata, no subagents.
- Pre-review evidence: exact 29 rows = 23 implemented + four exclusions + one
  example gap + one security gate; no unexpected/stale/defect classification.
  Focused tests pass 5 files / 64 tests; API exports pass at
  100/28/205/19/17/3; cleanup, generated-clean, Prettier, synchronized status,
  and diff integrity pass.
- Style/maintainability: assign explicit Terra High for matrix structure,
  duplication, evidence readability, and durable-record truthfulness.
- Documentation: assign explicit Luna Medium for active-vs-historical claims,
  current observable behavior, exclusions, and routing accuracy.
- TypeScript/API docs: assign explicit Terra High for package roots, exports,
  declarations, wire shapes, type URLs, and public-leak evidence.
- Performance/reliability: assign explicit Terra High for behavior coverage,
  lifecycle/retry/persistence/idempotency evidence, and gap classification.
- All reviewers are read-only, no subagents, and must perform/report the
  canonical skill-applicability check. Security remains deferred to T-0041.

## Independent Review Result

- `2026-07-14T01:23:48Z`: style requested HIGH/MEDIUM/LOW corrections;
  documentation requested two MEDIUM and one LOW; TypeScript/API docs requested
  two HIGH and one MEDIUM; reliability requested one HIGH. Actual profiles
  match immutable Luna Medium/Terra High role assignments; no subagents; all
  reviewers closed.
- Deduplicated parent findings: exact classifications need a route column; row
  29 conflates tooling with unexecuted release proof; governing paths are not
  repository-relative; row 21 falsely says only the test source exists; one
  work-log assertion is stale; package export subpaths are absent from the
  public/internal/API evidence audit.
- Accepted HIGH framework finding T-0038a: public `getTypeUrlPrefix()` and
  `deriveTypeUrl()` accept malformed caller-supplied fallback prefixes and can
  yield noncanonical public type URLs. Packing and implicit registry APIs have
  no custom fallback input.
- Accepted HIGH framework finding T-0038b: active local multi-process execution
  requirements are not met by callback-only transport binding plus unattached
  server environment transport. A framework child precedes T-0040 example proof.
- Security stays deferred to T-0041. Parent re-review follows matrix correction
  and integration of both children.

## Fix And Planning Assignments

- Parent correction returns to the same explicit Terra Medium implementer;
  exact four-file record ownership, no subagents.
- T-0038a/T-0038b planning uses the existing explicit Sol High requirements
  splitter; only `framework-children-plan.md`, no subagents. Public-contract and
  server/JVM evidence make selective deep planning applicable.
- Re-review occurs only after parent corrections and child integrations are
  reflected in a fresh matrix package.

## Child-Plan Coordinator Finding

- `2026-07-14T01:41:13Z`: parent matrix correction accepted; author closed.
  Planner actual Sol High matches explicit immutable-role dispatch and used no
  subagents; plan correction remains before acceptance.
- Required corrections: Terra Medium child implementers; child integration
  serially through `main` before parent back-merge; direct fallback-option defect
  wording without nonexistent pack/implicit-registry custom-input propagation.

## Child-Plan Acceptance

- `2026-07-14T01:44:38Z`: corrected Sol High plan accepted; explicit profile
  matches immutable role metadata, no subagents, planner closed. JVM evidence,
  Terra Medium implementation allocation, main-first integration order, and
  direct fallback semantics are satisfactory.
- Final parent correction is limited to matrix/record wording; child
  implementation begins only after this audit checkpoint is clean and committed.

## Historical Implementer Correction Result

The following result predates and is superseded by the independent review
findings at `2026-07-14T01:23:48Z`.

- Row 23 is now IMPLEMENTED, and T-0039 remains a planned completion pass rather
  than a routed mismatch.
- The matrix and logs now carry the green 100/28/205/19/17/3 export evidence,
  5-file/64-test focused capability result, and passing cleanup result.
- Classification counts are 23 IMPLEMENTED, four DOCUMENTED_EXCLUSION, one
  EXAMPLE_GAP, and one SECURITY_GATE; no STALE_DOC_STATUS or FRAMEWORK_DEFECT
  finding remains.
- Prettier check and `git diff --check` pass after the corrections; only the
  four assigned records are modified.
- Row 29 now has the exact `IMPLEMENTED` classification token; its closure
  qualifier remains in evidence. Strict 23/4/1/1 classification proof and
  final formatting/diff checks precede review handback.

## Parent Review-Fix Handback

- Parent matrix corrections are applied with exact classification and separate
  routing columns. Current count target is 31 rows: 23 implemented, four
  exclusions, one example gap, one security gate, and two framework defects.
- T-0038a and T-0038b are explicit blocking framework-child routes; T-0040's
  example proof follows T-0038b. Final verify/release proof is unclassified
  pending closure evidence.
- The six package manifests contribute ten export entries, all enumerated with
  designation and evidence/exemption. API-checker claims are narrowed to its
  real root-symbol/exact-source scope.
- Re-review remains pending after both framework children are integrated and
  the parent matrix is refreshed.
- Parent validation is clean: exact taxonomy/route counts are 31/23/4/0/1/1/2
  with zero unexpected tokens or route errors; all ten manifest export entries
  are inventoried; Prettier and diff checks pass; and no tracked generated path
  or generated-path diff exists.

## Child-Plan Precision Handback

- T-0038a is narrowed to malformed caller-supplied fallback handling in public
  `getTypeUrlPrefix()` / `deriveTypeUrl()` only. File-option/default behavior in
  packing and implicit registry paths remains unchanged compatibility evidence.
- No other classification, route, export entry, or capability evidence changed.
  Re-review remains pending after framework-child integration and parent refresh.

## Main Back-Merge Assignment

- Source `main` is `fedae6aa`; parent endpoint before merge is `0062f8e7`.
  Both framework children are integrated and verified on the source.
- Back-merge without commit, inspect conflicts/unmerged paths, and dispatch one
  existing style/maintainability reviewer at explicit `gpt-5.6-terra` / high,
  read-only with no subagents, for merge integrity only. Matrix capability
  review remains a separate parent-refresh gate.

## Main Back-Merge Review Result

- Reviewer `019f5f52-ce99-7650-ad3f-e72947ea8bd0`, actual immutable
  `gpt-5.6-terra` / high, skill check complete, no subagents, closed.
- Merge integrity is clean: zero conflicts/unmerged paths, correct `MERGE_HEAD`,
  both child endpoints integrated, staged source content equal to `main`, five
  parent artifacts preserved, no generated/config/unrelated change, no conflict
  markers, and no whitespace errors.
- Accepted P2: correct the recorded pre-merge parent from predecessor
  `9addd3b0` to actual assignment endpoint `0062f8e7`. The correction is staged
  for focused merge-integrity rereview before commit.

## Main Back-Merge Focused Rereview

- CLEAN. Same reviewer `019f5f52-ce99-7650-ad3f-e72947ea8bd0`, actual immutable
  `gpt-5.6-terra` / high, no subagents, closed.
- Pre-merge parent `0062f8e7`, source/`MERGE_HEAD` `fedae6aa`, zero conflicts,
  zero unmerged paths, five parent artifacts preserved, accurate staged
  records, no conflict marker, and no whitespace error. The no-commit merge is
  accepted for commit; capability matrix refresh remains separate.

## Integrated Matrix Refresh Assignment

- Existing implementer role, explicit `gpt-5.6-terra` / medium, no subagents,
  owns matrix plus three parent records only. Required current state is 31 rows:
  25 IMPLEMENTED, four DOCUMENTED_EXCLUSION, zero STALE_DOC_STATUS, one
  EXAMPLE_GAP, one SECURITY_GATE, zero FRAMEWORK_DEFECT.
- Rows 30/31 must cite the integrated source/tests/docs from T-0038a/T-0038b;
  routed findings retain T-0040 and T-0041 only. Parent final verify remains
  pending. Review dispatch follows focused static acceptance and a committed
  matrix endpoint.

## Integrated Matrix Refresh Pre-review Record

- Canonical skill applicability was performed before the refresh edit: session
  inventory, expected-skill manifest, complete readable
  `/Users/armiol/.agents/skills` entrypoint inventory, and installed lock were
  checked; `verification-before-completion` was selected and fully read.
  Worktree/subagent/planning/ADR/runtime/TypeScript/testing/JVM-server skills
  are N/A for the provided-worktree, no-subagent, audit-record-only scope.
- The reviewed integration base is back-merge `eae95a3e`. Rows 30/31 replace
  superseded defect evidence with the exact T-0038a core source/test/README/
  TSDoc and T-0038b context transport/server lifecycle/ZeroMQ source, focused
  runtime/lifecycle/native child-process/ZeroMQ proof, and current server/user/
  architecture docs. Both rows are `IMPLEMENTED` with an em-dash route.
- Current exact taxonomy is 31/25/4/0/1/1/0. Routed findings contain only the
  T-0040 example gap and T-0041 security gate. Parent final verify and T-0042
  release proof remain pending for later closure; this record makes neither a
  completion claim nor a new review disposition.
- Pre-review static evidence is taxonomy/route lint (31 rows; 29 em dashes,
  T-0040, T-0041), ten manifest exports/inventory rows, synchronized active
  status, clean owned-diff public/internal leakage and docs-overclaim scan,
  exact four-file Prettier, generated-path scan, `git diff --check`, and four
  owned modified paths. Full verify is intentionally not part of this handback.

## Matrix Pre-Review Finding

- Row 21 is stale: it says both example and framework cross-process proof are
  absent. T-0038b now proves framework behavior; the EXAMPLE_GAP/T-0040 route
  remains because the to-do application has no child worker/harness/test or
  local IPC workflow.
- Same matrix author is resumed at explicit `gpt-5.6-terra` / medium, no
  subagents. Fix row 21 evidence only, synchronize records, and retain all
  strict counts/routes before reviewer dispatch.

## Matrix Pre-Review Acceptance

- Row 21 now cleanly routes only the missing example composition/acceptance/
  guidance to T-0040 and cites T-0038b's integrated framework proof.
- Coordinator corrected stale active headers left by the handback and verified
  all four are synchronized. The matrix remains exactly 31/25/4/0/1/1/0 with
  routes 29 em dashes, one T-0040, and one T-0041. Reviewer packaging is
  authorized; parent full verify remains pending.

## Integrated Capability Reviewer Dispatch

- Baseline `eae95a3e`; endpoint `0ddfb3ad`; package
  `.superpowers/sdd/review-eae95a3e..0ddfb3ad.diff` (three commits, 79232
  bytes).
- Style/maintainability: existing role, explicit `gpt-5.6-terra` / high.
- Documentation: existing role, explicit `gpt-5.6-luna` / medium.
- TypeScript/API docs: existing role, explicit `gpt-5.6-terra` / high.
- Performance/reliability: existing role, explicit `gpt-5.6-terra` / high.
- All are read-only, no subagents, and limited to matrix/current active
  evidence. Superseded historical prose is ignored unless current state claims
  it. Security remains deferred to T-0041.

## Matrix Pre-Review Fix Handback

- The author applied receiving-review and verification guidance and confirmed
  the finding against current repository state. Row 21 now distinguishes the
  absent example-owned child worker/entry, harness/acceptance test, and local
  IPC workflow from T-0038b's integrated framework-level server child-process
  proof.
- EXAMPLE_GAP/T-0040 is unchanged. Every other matrix row, including rows
  30/31, and the exact 31/25/4/0/1/1/0 taxonomy with 29 em dashes plus one
  T-0040 and one T-0041 remain assigned for focused verification. Parent full
  verify and T-0042 release proof remain pending.
- Focused taxonomy/route, synchronized-status, stale-evidence, exact four-file
  Prettier, generated-path, four-file scope, `git diff --check`, and status
  checks pass. No review disposition is added; reviewer dispatch remains next.

## Integrated Capability Review Result

- `2026-07-14T09:15:44Z`: documentation reviewer actual immutable Luna Medium;
  style, TypeScript/API docs, and reliability reviewers actual immutable Terra
  High. Explicit dispatch profiles matched, all skill checks completed, no
  subagents were used, and all reviewers are closed. The resumed close request
  for the completed style reviewer returned `not found`, so no live reviewer
  remains on this surface.
- Performance/reliability: CLEAN with no actionable finding.
- Documentation P2: active status mirrors disagree between the matrix and the
  three T-0038 records.
- TypeScript/API docs P2: the manifest-exported generated registry support
  subpath is not package-internal. Its generated-code data types must be
  distinguished from `HandlerRegistryIngestor` and
  `HandlerRegistryIngestionError`, which are intentionally public from the
  package root despite sharing the implementation module.
- Style/maintainability P2: the unqualified active `Current State` above is
  stale because both framework children are integrated and the matrix is
  refreshed. Current action is this complete finding batch, affected rereview,
  and parent final verification.
- Assign all accepted findings together to the existing Terra Medium matrix
  author, no subagents, with the matrix and three T-0038 records as the complete
  write scope. Rerun style, documentation, and TypeScript/API lanes after local
  acceptance; retain the clean reliability disposition unless the fix changes
  its evidence.

## Integrated Review Fix Skill Applicability

- Before fix edits, the exposed session inventory, task-provided skill paths,
  expected-skill manifest, complete readable `/Users/armiol/.agents/skills`
  entrypoint enumeration, and installed lock were checked; all eight expected
  entries are present in the bounded evidence.
- `receiving-code-review` and `verification-before-completion` were fully read
  and selected. Dispatch/worktree/planning/ADR/runtime/TypeScript/testing/
  JVM-server skills are N/A because this is the resumed no-subagent matrix
  author in an existing worktree with four record files as its exact scope.

## Integrated Review Fix Handback

- Actual immutable runtime-role metadata is `gpt-5.6-terra` / medium and matches
  the explicit existing implementer dispatch; no subagents were used.
- The manifest-exported generated-handler-registry subpath now accurately
  describes non-root generated support consumed by generator-emitted imports.
  The root API/TypeDoc evidence separately identifies
  `HandlerRegistryIngestor` and `HandlerRegistryIngestionError`, even though all
  these declarations share one source module.
- Four active statuses agree on affected-rereview readiness. The unqualified
  stale `Current State` is replaced above: both children are integrated; local
  acceptance is this handback, affected rereview follows, and parent final
  verification remains after it. Parent full verify/T-0042 remain pending.
- Focused taxonomy/route, ten-entry export inventory, active-state/stale-state,
  docs-overclaim, exact four-file Prettier, generated-path, scope, and
  `git diff --check` checks pass. Reliability remains CLEAN and no full verify,
  commit, or out-of-scope change occurred.

## Integrated Capability Affected Rereview Assignment

- `2026-07-14T09:24:10Z`: accepted fix endpoint `359af4a6`; coordinator checks
  confirm exact taxonomy/routes, ten-entry export inventory, synchronized
  status, exact scope, Prettier, and whitespace integrity.
- Style/maintainability: existing role, explicit `gpt-5.6-terra` / high, scoped
  to the stale-current-state and status corrections plus matrix readability.
- Documentation: existing role, explicit `gpt-5.6-luna` / medium, scoped to
  current-vs-historical state and synchronized active claims.
- TypeScript/API docs: existing role, explicit `gpt-5.6-terra` / high, scoped
  to the generated-code support subpath, same-module root exports, and exact
  API-checker claims.
- All reviewers are read-only, may not spawn subagents, and must report skill
  applicability plus actual immutable role metadata. Performance/reliability
  remains CLEAN and security remains deferred to T-0041.

## Integrated Capability Affected Rereview Result

- `2026-07-14T09:29:07Z`: documentation reviewer
  `019f5ff2-0154-7292-954a-b814df4e44fa` is CLEAN at immutable Luna Medium;
  TypeScript/API reviewer `019f5ff2-3cbe-74b1-b997-26921d7d007c` is CLEAN at
  immutable Terra High. Style reviewer
  `019f5ff1-db74-7472-9111-fd3eba354f4e` returned one P2 at immutable Terra
  High. Every model/reasoning field was explicit at spawn, all skill checks
  completed, no subagents were used, and all three reviewers are closed.
- Accepted P2: current T-0038b task/work headers stop at accepted-for-main-
  integration despite their own completed integration record and main ancestry.
  This is a real stale active-status claim, but T-0038's scope/routing rule
  assigns its correction to T-0039a rather than this parent's four-file scope.
- Resume the same Terra Medium matrix author to change row 23 from
  `IMPLEMENTED` to `STALE_DOC_STATUS`, route T-0039, cite exact evidence, and
  update taxonomy/routes. Rerun style and documentation only; API and
  reliability remain CLEAN unless the fix crosses their concerns.

## Row 23 Fix Skill Applicability

- Before fix edits, checked the exposed session inventory, task-provided skill
  paths, expected-skill manifest, complete readable
  `/Users/armiol/.agents/skills` entrypoint enumeration, and installed lock;
  all eight expected manifest entries are present in the bounded evidence.
- `receiving-code-review` and `verification-before-completion` were fully read
  and selected. Subagent/worktree/planning/ADR/runtime/TypeScript/testing/
  JVM-server skills are N/A for this existing-worktree, no-subagent,
  parent-record-only classification correction.

## Row 23 Fix Handback

- Actual immutable runtime-role metadata is `gpt-5.6-terra` / medium and matches
  the explicit resumed implementer assignment; no subagents were used.
- Row 23 now records the concrete current mismatch: T-0038b task/work headers
  remain accepted-for-integration while both integration sections document
  merge `ac1d0f5e` and post-merge verification and ancestry succeeds. The row is
  STALE_DOC_STATUS/T-0039; T-0039a owns the child-record fix.
- All four active headers now agree on style/docs-rereview readiness. Taxonomy
  is 31/24/4/1/1/1/0 and routing is 28 em dashes plus one each T-0039/T-0040/
  T-0041. API and reliability CLEAN results remain applicable; parent full
  verification and T-0042 remain pending.
- Focused taxonomy/route, export-inventory, active-status, row-23 evidence,
  exact four-file Prettier, generated-path, scope, and `git diff --check` checks
  pass. No full verify, commit, child edit, or out-of-scope change occurred.

## Row 23 Focused Rereview Assignment

- `2026-07-14T09:35:35Z`: accepted endpoint `a6f184ea`; coordinator checks
  independently confirm exact taxonomy/routes, T-0038b ancestry/evidence,
  synchronized status, exact scope, Prettier, and whitespace integrity.
- Style/maintainability: resume existing role at explicit
  `gpt-5.6-terra` / high for row structure, evidence truth, routed scope, and
  current status/counts only.
- Documentation: resume existing role at explicit `gpt-5.6-luna` / medium for
  current-vs-historical truth and T-0039 ownership wording only.
- Both are read-only, no subagents, and must report skill applicability. API
  and reliability remain CLEAN; security remains deferred to T-0041.
