# T-0038: Accepted Capability Audit

Status: Framed; audit implementation assigned

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

## Immediate Next Action

Dispatch the single Terra Medium implementer to produce the matrix and update
the synchronized records, then run focused local audit checks before review.
