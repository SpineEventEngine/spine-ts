# T-0040c Review Log

Status: Wave 4 fixes verified - re-review pending

Baseline: `526b7b4d`

Branch: `task/T-0040c-todo-readme-user-guide-closure`

## Review Contract

Use a literal baseline-to-endpoint package, the full Human-Imposed Requirements
Ledger, current task/work status, executed documentation commands, real smoke
evidence, and affected paths. Ignore historical superseded text unless current
task state or changed public docs claim it active.

Run lightweight docs/status lint before dispatch: stale statuses and paths,
duplicate policy constants, public/internal leakage, generated tracking, broken
links/imports, and future-policy overclaim.

## Planned Concern Dispositions

- Code style/maintainability: relevant for example command/snippet structure,
  duplication, naming, and any smoke fixture. Use Terra High.
- Documentation completeness: central concern for reader workflow, command
  truthfulness, links, scope, and limitations. Use Luna Medium.
- TypeScript/API docs: relevant for generated-client imports, snippet types,
  public package boundaries, and agreement with the actual public API. Use Terra
  High.
- Performance/reliability: relevant for bounded smoke waits, listener/session/
  process cleanup, deterministic commands, and no orphaned IPC. Use Terra High.
- Security: deferred by protocol to T-0041.

## Assignment State

- Requirements splitter: N/A for the stable documentation-only surface.
- Implementation: existing immutable `implementer`, expected explicit
  `gpt-5.6-terra` / medium. Owns example/root docs, minimal checked-in smoke,
  package script, and task/work evidence; no framework runtime/config/dependency
  or review-log ownership. Explicit dispatch and immutable Desktop metadata
  agree for agent `019f6235-15d0-7022-a8dc-ac7579dffb0c`, actual
  `gpt-5.6-terra` / medium.
- Reviewers: not assigned.

## 2026-07-14 - Pre-Review Lint

- Durable statuses agree that implementation and focused verification are
  complete while specialist review and final gates remain pending.
- Public docs contain no active stale `examples/todo/src/index.test.ts` path;
  historical RED evidence in task/work records is intentionally retained.
- No duplicated framework-policy constant, accidental package export, internal
  source import, tracked generated output, broken Markdown link, or future-policy
  overclaim was found in the baseline-to-worktree diff.
- Exact install/build/start/smoke/test evidence and focused type, lint, format,
  docs, generated-clean, and diff checks are recorded in the task/work logs.

## 2026-07-14 - Specialist Wave 1 Assignment

- Endpoint: `fde98797` (`Document runnable to-do workflows`).
- Review package:
  `.superpowers/sdd/review-526b7b4d..fde98797.diff`.
- Code style/maintainability: existing
  `style_maintainability_reviewer`, expected explicit `gpt-5.6-terra` / high.
  Scope is the bounded smoke/package-script maintainability and changed-doc
  structure, duplication, naming, and clarity.
- Documentation completeness: existing `documentation_reviewer`, expected
  explicit `gpt-5.6-luna` / medium. Scope is a fresh-reader runbook audit of
  exact commands, links, demonstrated behavior, lifecycle, and limitations.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, expected
  explicit `gpt-5.6-terra` / high. Scope is public imports, generated-client
  shapes, package/export boundaries, declarations, and claims against the real
  API.
- Performance/reliability: existing
  `performance_reliability_reviewer`, expected explicit `gpt-5.6-terra` /
  high. Scope is bounded waits/diagnostics, process/listener/session/timer
  cleanup, deterministic smoke behavior, and local multi-process claims.
- Every reviewer is read-only, may not mutate Git or spawn subagents, and must
  report only concrete milestone-scoped defects. Historical superseded text is
  non-active unless the current task/work status or changed public docs claim it
  as active.
- Explicit dispatch fields and immutable Desktop role metadata agree:
  - style/maintainability agent
    `019f6244-dc51-7791-8b9c-2888f1e9c1a9`: actual
    `gpt-5.6-terra` / high;
  - documentation agent `019f6244-d8f1-7382-b55a-b00c99c8ce3c`: actual
    `gpt-5.6-luna` / medium;
  - TypeScript/API docs agent `019f6244-e313-7402-a8fc-9ed043475835`:
    actual `gpt-5.6-terra` / high;
  - performance/reliability agent
    `019f6244-df88-7731-af67-d15a86fbe0b2`: actual
    `gpt-5.6-terra` / high.

## 2026-07-14 - Specialist Wave 1 Results

- Style/maintainability: one P2 finding. Node built-in imports at the end of
  `smoke.mjs` obscure dependencies and violate repository import grouping.
- Documentation completeness: two P1 findings. Query criteria fragments leave
  required request/client setup implicit, and subscription prose omits a
  complete bounded activation/iteration/cancellation/session example.
- TypeScript/API docs: one important finding. `EntityStateWithVersion.state`
  is optional and `unpackAny` may return `undefined`; the direct guide
  instruction does not type-check safely.
- Performance/reliability: clean.
- All reviewers were closed after result capture. The complete accepted batch
  will be fixed by the original implementation context, existing
  `implementer` agent `019f6235-15d0-7022-a8dc-ac7579dffb0c`, expected
  explicit `gpt-5.6-terra` / medium, with no subagents or Git mutation.

## 2026-07-14 - Wave 1 Fix Acceptance

- The resumed implementation assignment retained explicit
  `gpt-5.6-terra` / medium dispatch context and immutable Desktop role
  metadata; the agent was closed after result capture.
- Coordinator inspection and native execution confirmed the import grouping,
  optional/mismatched state guards, complete query clients, and bounded
  subscription lifecycle corrections.
- Fresh focused build/docs/lint/format/generated/diff checks passed. A new
  baseline-to-endpoint package and all four specialist lanes are required.

## 2026-07-14 - Specialist Wave 2 Assignment

- Endpoint: `fa4b0af9` (`Complete executable to-do guide examples`).
- Review package:
  `.superpowers/sdd/review-526b7b4d..fa4b0af9.diff`.
- Style/maintainability: existing
  `style_maintainability_reviewer`, expected explicit `gpt-5.6-terra` / high.
- Documentation completeness: existing `documentation_reviewer`, expected
  explicit `gpt-5.6-luna` / medium.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, expected
  explicit `gpt-5.6-terra` / high.
- Performance/reliability: existing
  `performance_reliability_reviewer`, expected explicit `gpt-5.6-terra` /
  high.
- Each lane re-reviews the full baseline-to-endpoint milestone within its
  original bounded concern, with special attention to the Wave 1 corrections.
  Reviewers remain read-only, may not mutate Git or spawn subagents, and ignore
  historical superseded text unless current state claims it active.
- Explicit dispatch fields and immutable Desktop role metadata agree for Wave
  2: style agent `019f6253-c7bc-7121-884b-0387513c4ba3` is actual
  `gpt-5.6-terra` / high; documentation agent
  `019f6253-cb9a-7372-a6ed-727728c578cb` is actual `gpt-5.6-luna` / medium;
  TypeScript/API docs agent `019f6253-d1b4-7a62-9c67-8ddd62a12311` is actual
  `gpt-5.6-terra` / high; performance/reliability agent
  `019f6253-cee1-7263-89ca-8562bc5776a5` is actual `gpt-5.6-terra` / high.

## 2026-07-14 - Specialist Wave 2 Results

- Documentation completeness: clean; Wave 1 reader gaps are closed.
- Style/maintainability, TypeScript/API docs, and performance/reliability all
  reported the same optional-`unpackAny` smoke dereference. It is one accepted
  finding: skip absent/mismatched decoded rows in target matching and finite
  diagnostics.
- Performance/reliability also reported that the guide's `includeAll`
  subscription may accept another writer's update. Accepted correction:
  precompute one task ID, use an exact-ID topic filter, validate the delivered
  list ID, and retain bounded cleanup/failure behavior.
- All Wave 2 reviewers were closed. One fix batch returns to existing
  `implementer` agent `019f6235-15d0-7022-a8dc-ac7579dffb0c`, expected
  explicit `gpt-5.6-terra` / medium, no subagents or Git mutation.

## 2026-07-14 - Wave 2 Fix Acceptance

- The resumed implementation context retained the explicit immutable
  `gpt-5.6-terra` / medium profile and was closed after result capture.
- Coordinator inspection and native behavior verification accepted the shared
  smoke row-inspection guard, finite diagnostics, exact-ID subscription topic,
  delivered-ID assertion, and focused regressions.
- Fresh type/build/docs/lint/format/generated/diff checks passed. A fresh
  baseline-to-endpoint package and all four specialist lanes remain required.

## 2026-07-14 - Specialist Wave 3 Assignment

- Endpoint: `1a2aa2da` (`Harden to-do smoke and subscription guidance`).
- Review package:
  `.superpowers/sdd/review-526b7b4d..1a2aa2da.diff`.
- Style/maintainability: existing
  `style_maintainability_reviewer`, explicit `gpt-5.6-terra` / high.
- Documentation completeness: existing `documentation_reviewer`, explicit
  `gpt-5.6-luna` / medium.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, explicit
  `gpt-5.6-terra` / high.
- Performance/reliability: existing
  `performance_reliability_reviewer`, explicit `gpt-5.6-terra` / high.
- Re-review the full milestone within the original bounded concerns, especially
  the import-safe smoke test seam, unavailable-row diagnostics, exact-ID topic,
  unrelated-update regression, and bounded activation cleanup. Read-only; no
  Git mutation, installs, or subagents; historical superseded text is inactive
  unless current records/docs claim otherwise.
- Explicit dispatch and immutable Desktop metadata agree for Wave 3:
  style agent `019f6264-0dce-7b42-b113-528c7e0ba750` is actual
  `gpt-5.6-terra` / high; documentation agent
  `019f6264-0a0f-7fe0-970e-29f0b8efb298` is actual `gpt-5.6-luna` / medium;
  TypeScript/API docs agent `019f6264-10e8-7ba2-84ea-d59dfab660e6` is actual
  `gpt-5.6-terra` / high; performance/reliability agent
  `019f6264-1430-7d93-9ede-cc32339f601b` is actual `gpt-5.6-terra` / high.

## 2026-07-14 - Specialist Wave 3 Results

- TypeScript/API docs: clean.
- Style/maintainability: replace the `@ts-expect-error` plus erased cast with
  a typed import-light smoke row module, and add malformed matching-type bytes
  to the direct regression.
- Documentation completeness: cancellation must cover activation setup
  failure, and the two complete guide modules need exact save/run commands and
  generated-build/server prerequisites.
- Performance/reliability: apply target-delivery timeout after posting the
  target while keeping the raw read pending beforehand; replace `Date.now()`
  identity with a collision-resistant per-run suffix.
- All Wave 3 reviewers were closed. One complete fix batch returns to existing
  `implementer` agent `019f6235-15d0-7022-a8dc-ac7579dffb0c`, expected
  explicit `gpt-5.6-terra` / medium, no subagents or Git mutation.

## 2026-07-14 - Wave 3 Fix Acceptance

- The resumed implementation context retained the explicit immutable
  `gpt-5.6-terra` / medium profile and was closed after result capture.
- Coordinator inspection and native evidence accepted the typed private
  decoder, malformed-wire regression, delayed delivery timeout, activation
  cleanup scope, UUID identities, and exact guide save/run commands.
- Fresh type/build/docs/lint/format/generated/diff checks passed. A fresh
  baseline-to-endpoint package and all four specialist lanes remain required.

## 2026-07-14 - Specialist Wave 4 Assignment

- Endpoint: `e45d1584` (`Finalize to-do guide client reliability`).
- Review package:
  `.superpowers/sdd/review-526b7b4d..e45d1584.diff`.
- Style/maintainability: existing
  `style_maintainability_reviewer`, explicit `gpt-5.6-terra` / high.
- Documentation completeness: existing `documentation_reviewer`, explicit
  `gpt-5.6-luna` / medium.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, explicit
  `gpt-5.6-terra` / high.
- Performance/reliability: existing
  `performance_reliability_reviewer`, explicit `gpt-5.6-terra` / high.
- Re-review the full milestone within the original bounded concerns, with
  special attention to every Wave 3 correction. Read-only; no Git mutation,
  installs, duplicate test runs, or subagents; historical superseded text is
  inactive unless current records/docs claim it.
- Explicit dispatch and immutable Desktop metadata agree for Wave 4:
  style agent `019f6275-524f-7132-a41e-4d566937ff5a` is actual
  `gpt-5.6-terra` / high; documentation agent
  `019f6275-4ee1-7ff1-9ac7-7b28e18409b4` is actual `gpt-5.6-luna` / medium;
  TypeScript/API docs agent `019f6275-4b1b-70b1-b284-75af9570c3e2` is actual
  `gpt-5.6-terra` / high; performance/reliability agent
  `019f6275-4727-78b3-b8bf-5c46cf54b12d` is actual `gpt-5.6-terra` / high.

## 2026-07-14 - Specialist Wave 4 Results

- Style/maintainability: clean.
- Documentation completeness: accepted. The exact-ID query example currently
  uses `task-1` without creating or requiring it; seed via smoke and pass the
  printed ID explicitly.
- Performance/reliability: accepted. Cap row inspection/retention and sanitizer
  input work with oversized regressions; catch malformed matching-type guide
  query rows.
- TypeScript/API docs: rejected after coordinator adjudication. Relative
  `../dist/**` paths are app-owned imports from scripts that execute inside the
  private example package, not unsupported imports from an external package
  consumer. All framework imports use public exports. Creating example export
  subpaths is an out-of-scope public-contract expansion.
- All Wave 4 reviewers were closed. One accepted fix batch returns to existing
  `implementer` agent `019f6235-15d0-7022-a8dc-ac7579dffb0c`, expected
  explicit `gpt-5.6-terra` / medium, no subagents or Git mutation.

## 2026-07-14 - Wave 4 Fix Acceptance

- The resumed implementer retained explicit immutable `gpt-5.6-terra` /
  medium metadata and was closed after result capture.
- Coordinator native evidence accepted bounded response/sanitizer work,
  oversized regressions, malformed guide-row handling, and the seeded exact
  query workflow.
- Fresh type/build/docs/lint/format/generated/diff checks passed. A fresh
  baseline-to-endpoint package and all four specialist lanes remain required.

## 2026-07-14 - Specialist Wave 5 Assignment

- Endpoint: `6f55ae21` (`Bound to-do client diagnostics`).
- Review package:
  `.superpowers/sdd/review-526b7b4d..6f55ae21.diff`.
- Style/maintainability: existing
  `style_maintainability_reviewer`, explicit `gpt-5.6-terra` / high.
- Documentation completeness: existing `documentation_reviewer`, explicit
  `gpt-5.6-luna` / medium.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, explicit
  `gpt-5.6-terra` / high.
- Performance/reliability: existing
  `performance_reliability_reviewer`, explicit `gpt-5.6-terra` / high.
- Final full-milestone re-review within each original concern, focused on the
  accepted Wave 4 bounds and seeded query workflow. Preserve the recorded
  app-owned-relative-import adjudication unless new repository evidence changes
  ownership. Read-only; no Git mutation, installs, duplicate test runs, or
  subagents; superseded historical text is inactive.
- Explicit dispatch and immutable Desktop metadata agree for Wave 5:
  style agent `019f6283-1a67-7883-8fc7-76b9321806dc` is actual
  `gpt-5.6-terra` / high; documentation agent
  `019f6283-163c-7c10-a45f-abe13cc808c7` is actual `gpt-5.6-luna` / medium;
  TypeScript/API docs agent `019f6283-2196-7922-b9f6-cbc712949656` is actual
  `gpt-5.6-terra` / high; performance/reliability agent
  `019f6283-2a12-77a3-aaa5-cd116b4e846f` is actual `gpt-5.6-terra` / high.

## Skill Applicability

- Reviewers use session inventory, expected-skill manifest, readable installed
  metadata/lock, `requesting-code-review`, and specialty guidance. No reviewer
  may edit files, mutate Git, install, or spawn subagents.
