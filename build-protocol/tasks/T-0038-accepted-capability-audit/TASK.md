# T-0038: Accepted Capability Audit

Status: Independent review assigned

Started: `2026-07-14T00:59:38Z`

Baseline commit: `75340852`

Branch: `task/T-0038-accepted-capability-audit`

Worktree: `.worktrees/T-0038-accepted-capability-audit`

Dependency: T-0037f complete, merged, post-merge verified, and pushed.

This `Status` header is canonical for T-0038. Its work and review logs are
derived mirrors and must agree before review.

## Objective

Prove that the integrated framework satisfies the accepted initial-release
contract and classify every remaining contract statement as implemented,
documented exclusion, stale documentation/status, example-only gap,
security-owned gap, or mandatory framework defect.

## Human-Imposed Requirements Ledger

- Continue autonomously until the project is complete or a real protocol
  blocker occurs; do not pause for routine audit classifications.
- Keep this audit bounded to traceability and classification. A mandatory
  framework defect creates the smallest numbered T-0038 child with one behavior
  owner and regression evidence; do not absorb runtime fixes into this parent.
- Route documentation/status mismatches to T-0039, example-only gaps to T-0040,
  and security findings to the final T-0041 gate.
- Preserve accepted DDD, Protobuf, type-URL, public API, generated-output,
  end-user API, review, logging, worktree, and verification requirements.
- Do not add or expose framework lifecycle internals, `Event` envelopes,
  manual transactions, `@Apply`, schema-bearing decorators, or app-owned
  handler materialization in end-user examples or guide snippets.
- Keep generated Protobuf and handler-registry outputs out of VCS.
- Use focused inner checks; reserve full `pnpm verify` for final task acceptance
  and post-merge verification.
- Run only relevant existing reviewer concerns, recording a concrete N/A for
  every skipped concern. Do not run per-task security review.
- Reviewer prompts must ignore superseded historical text unless current task
  records, the matrix, or changed active docs claim it as current state.
- Explicitly dispatch every child model/reasoning profile and accept only
  matching immutable runtime-role metadata. Subagents must not spawn subagents.
- Push the completed task branch and integrated `main` to `origin`, then remove
  the clean merged worktree and local branch.
- Never read, modify, stage, or delete the user-owned
  `human-review-1-jul.md` file.

## Acceptance Criteria

- `build-protocol/release/INITIAL_RELEASE_CAPABILITY_MATRIX.md` maps the active
  requirements in `TECHNICAL_SPEC.md`, `PROTOBUF_CONTRACT.md`,
  `DEVELOPER_API.md`, `RUNTIME_ARCHITECTURE.md`, `TODO_EXAMPLE_SPEC.md`, and
  `CODE_QUALITY.md` to concrete implementation, tests, and current docs.
- Every matrix row has one explicit classification and sufficient file/test or
  durable-exclusion evidence to be independently checked.
- The audit covers package-root exports and `scripts/check-api-docs.mjs`, wire
  message compatibility and type URLs, forbidden end-user APIs, accepted
  exclusions, and the completion plan's known capability list.
- Stale historical wording is not misclassified as active product scope.
- Every real gap is routed to T-0039, T-0040, or T-0041, or becomes a minimal
  numbered T-0038 framework child. No unresolved mandatory framework defect is
  hidden in an audit note.
- Focused audit checks and all relevant review concerns are clean; the final
  task and post-merge `pnpm verify` gates pass before closure.

## Scope

- Own the release-readiness matrix and T-0038 task/work/review records.
- Read implementation, tests, package roots, scripts, public docs, and accepted
  protocol decisions as evidence.
- Permit audit-only status corrections only when they do not pre-empt T-0039's
  canonical documentation reconciliation.
- Exclude runtime, public API, Protobuf, example, user-guide, package-doc, and
  security fixes from this parent task.

## Risk Assumptions

- Governing documents contain historical sections. Only active non-superseded
  requirements and current completion-plan claims belong in the release
  contract.
- Test presence alone is insufficient evidence when runtime/public behavior
  cannot be traced to the asserted contract.
- A matrix may expose a real framework defect; classification must remain
  conservative and create a child rather than weakening the contract.

## Planning Disposition

- No requirements-splitter invocation: the accepted completion plan already
  defines this audit, and the parent changes no architecture, public contract,
  serialization, transaction, concurrency, or idempotency rule.
- Short outline: inventory active requirements; trace implementation/tests/docs;
  run public/wire/prohibition scans; classify and route gaps; review the matrix;
  run the final gate and integrate.

## Author Assignment

- Existing role: implementer.
- Scope: write the release matrix and update only T-0038 durable records; read
  the repository for evidence; do not edit production, tests, public docs,
  examples, generated output, or unrelated task history.
- Expected and explicit dispatch: `gpt-5.6-terra` / medium, no subagents.
- Required handback: changed paths, matrix coverage summary, exact scans/checks,
  classified gaps and routing, remaining uncertainty, and actual runtime profile.

## Skill Applicability Check

- Session inventory exposed workflow, review, TypeScript, Node, DDD, testing,
  documentation, and planning skills. The repo manifest and full readable
  `/Users/armiol/.agents/skills` entrypoint inventory were checked; the lock
  manifest contains all eight expected entries.
- Selected and read for orchestration: `subagent-driven-development`,
  `using-git-worktrees`, `requesting-code-review`, and
  `verification-before-completion`.
- `planning-with-files` is skipped because this repository's task, work, review,
  and release-matrix files are the canonical persistent plan; parallel scratch
  ledgers would duplicate active state. `architecture-decision-records` is N/A
  because no architecture decision is owned. `typescript-advanced-types` and
  `nodejs-backend-patterns` are N/A unless the audit creates a code child.
- `doc-coauthoring` is not selected because its interactive human drafting flow
  conflicts with this autonomous evidence audit. No server runtime/API edit is
  planned, so Spine JVM source inspection is N/A for the parent.

### Implementer Recheck (`2026-07-14`)

- Evidence: the session inventory exposed the currently available skills; the
  task-relevant user entrypoints were enumerated with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`,
  and `build-protocol/skills/EXPECTED_SKILLS.md` plus
  `/Users/armiol/.agents/.skill-lock.json` were read. All eight expected
  manifest entries are present in the readable inventory/lock evidence.
- Selected and fully read: `verification-before-completion`
  (`/Users/armiol/.agents/skills/verification-before-completion/SKILL.md`),
  because this audit must make evidence-backed completion claims after focused
  checks.
- Skipped: `subagent-driven-development` and `requesting-code-review` require
  dispatching subagents, which this assignment forbids; `using-git-worktrees`
  is N/A because the assigned worktree already exists and may not be recreated;
  `planning-with-files` would duplicate the task/work/review/matrix durable
  records; ADR, TypeScript-advanced-types, Node-backend, TDD, and JVM-server
  skills are N/A because this parent changes only audit records, not runtime or
  public contracts. The project protocol remains governing if any advisory
  skill differs from it.

## Immediate Next Action

Hand the corrected matrix and synchronized records to the existing relevant
reviewer concerns. T-0039 remains a planned documentation completion pass, not
a mismatch found by this audit.

## Coordinator Pre-review Finding

- `2026-07-14T01:10:13Z`: immutable implementer-role metadata confirms actual
  `gpt-5.6-terra` / medium matching explicit dispatch; the author is closed and
  used no subagents. The four-path handback scope is correct.
- After generated output plus `typecheck:build:generated`, TypeDoc/API checks
  pass with 100 proto, 28 core, 205 server, 19 storage, 17 transport, and 3
  testing exports; the focused capability suite passes 5 files / 64 tests and
  cleanup rules pass.
- Correct two pre-review record issues before reviewer dispatch: row 23 cannot
  be `STALE_DOC_STATUS` while its evidence establishes no specific false
  current claim; classify the current-doc separation truthfully and leave
  T-0039 as a planned closure pass. Replace the now-resolved generated/build
  precondition wording with the coordinator's executable green evidence and
  update counts/routed-gap text consistently.

## Final Pre-review Classification Finding

- `2026-07-14T01:13:45Z`: strict classification lint counts 22 exact
  `IMPLEMENTED` cells because row 29 says `IMPLEMENTED (tooling)` despite the
  matrix declaring exact classifications. Move its qualifier into evidence and
  use exact `IMPLEMENTED`; keep the stated 23/4/1/1 totals truthful.
- `pnpm --config.verify-deps-before-run=false proto:check-generated` passes;
  the earlier direct-node PATH failure is not a repository defect.

## Independent Review Assignment

- `2026-07-14T01:15:54Z`: accept and close the existing implementer, actual
  `gpt-5.6-terra` / medium from explicit dispatch plus immutable spawn-role
  metadata, no subagents. Author scope is exactly the matrix and three T-0038
  records.
- Coordinator checks pass: 29 exact rows (23 implemented, four exclusions, one
  T-0040 example gap, one T-0041 security gate), 5 files / 64 focused tests,
  TypeDoc/API exports at 100/28/205/19/17/3, cleanup rules, generated-clean,
  Prettier, status synchronization, and diff integrity.
- Assign all four relevant existing concerns concurrently: documentation at
  explicit `gpt-5.6-luna` / medium; style/maintainability, TypeScript/API docs,
  and performance/reliability at explicit `gpt-5.6-terra` / high. No reviewer
  may edit or spawn subagents. Security remains deferred to T-0041.

## Implementer Correction Handback

- Row 23 is `IMPLEMENTED`: the focused scan found no specific false current
  documentation claim. T-0039 remains planned and is not listed as a routed
  audit gap.
- Executable evidence supersedes the initial setup-only failures:
  `docs:check:generated` passed with 100/28/205/19/17/3 package exports, the
  focused proto/core/testing/example/local-IPC suite passed 5 files / 64 tests,
  and cleanup enforcement passed.
- The matrix now records 23 IMPLEMENTED, four DOCUMENTED_EXCLUSION, one
  EXAMPLE_GAP, and one SECURITY_GATE classifications, with no
  STALE_DOC_STATUS or FRAMEWORK_DEFECT finding.
- Final classification correction: row 29 now uses the exact `IMPLEMENTED`
  token; its tooling and final T-0038 execution qualifier is retained in the
  evidence cell. The matrix is ready for independent review.
