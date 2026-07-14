# T-0039a: Canonical Specification And Status Reconciliation

Status: Author assigned

Started: `2026-07-14T09:57:00Z`

Baseline commit: `78653b9a`

Branch: `task/T-0039a-canonical-spec-status-reconciliation`

Worktree: `.worktrees/T-0039a-canonical-spec-status-reconciliation`

Dependency: T-0038 complete, integrated, post-merge verified, and pushed.

## Objective

Make canonical protocol specifications, accepted decision outcomes, and active
durable status records describe the final implemented runtime and its explicit
exclusions without rewriting public package documentation or user guidance.

## Human-Imposed Requirements Ledger

- Continue autonomously until project completion or a real protocol blocker.
- Keep this slice smaller than public package/API documentation and user-guide
  work; T-0039b and T-0039c own those surfaces.
- Preserve accepted DDD, Protobuf, type-URL, public API, generated-output,
  end-user API, review, logging, worktree, verification, and push requirements.
- Reconcile active status assertions without mass-editing historical event
  entries or treating superseded prose as current behavior.
- Preserve explicit exclusions for retry timing/backoff, monitoring/action
  policy, production topology/adapters, projection catch-up, legacy import,
  distributed transport, and production example concerns.
- Use focused checks in the inner loop and reserve full `pnpm verify` for final
  task and post-merge gates.
- Run only relevant existing review concerns and record concrete N/A reasons
  for skipped concerns; no per-task security review.
- Reviewer prompts must ignore historical superseded text unless current task
  records or changed active docs claim it as current state.
- Explicitly dispatch child model/reasoning profiles; subagents may not spawn
  subagents. Push completed task and `main` to origin.
- Never read, edit, stage, delete, or use `human-review-1-jul.md`.

## Acceptance Criteria

- Current delivery/environment/server lifecycle wording matches integrated
  T-0037f and T-0038b behavior and does not expose internal registrations,
  generations, obligations, cursors, or speculative policy.
- D-0085 and D-0086 retain their accepted decisions while recording truthful
  implementation outcomes.
- Active T-0037 parent/child, T-0038 child, and other current task/work/review
  status mirrors no longer claim completed integration is pending.
- Bootstrap-era T000/T001 headers are explicitly historical/closed without
  rewriting their event history.
- No active spec/status text promises excluded future retry, monitoring,
  topology, catch-up, supervision, or adapter policy.
- Exact changed-file scope, links, formatting, docs/status lint, and all
  relevant review concerns are clean; final and post-merge full verify pass.

## Scope

- Own canonical `build-protocol` specifications/architecture/decision outcomes
  and durable task/work/review status headers or short current-state notes.
- Exclude root/package READMEs, public TSDoc, TypeDoc/API overview,
  `docs/USER_GUIDE.md`, example docs, runtime code, tests, Protobuf, generated
  output, and task-history mass rewrites.

## Risk Assumptions

- Historical logs intentionally preserve old states; only unqualified active
  headers/current-state summaries should be reconciled.
- Lifecycle wording can accidentally expose implementation details or promise
  excluded policy, so observable behavior and ownership boundaries must remain
  narrow.
- Status inventory may be broad. Edit only concrete false active claims found
  by bounded scans and keep the review package inspectable.

## Planning Disposition

- No requirements splitter: T-0039a changes no architecture, public/serialized
  contract, domain semantics, transaction, concurrency, or idempotency rule.
  The completion plan already gives an exact reconciliation packet.
- Short outline: inventory active lifecycle/spec/decision/status claims; assign
  one Terra Medium author; run docs/status lint; review relevant concerns; run
  final task gate; integrate, verify, push, and remove the clean worktree.

## Author Assignment

- Existing role: implementer.
- Scope: canonical protocol specs/architecture/decision outcomes and concrete
  active status headers/current-state notes only; no runtime/public docs/tests/
  examples/generated/Git operations.
- Expected explicit dispatch: `gpt-5.6-terra` / medium, no subagents.
- Required handback: changed paths, every reconciled claim with evidence,
  focused commands/results, skipped candidates/reasons, uncertainty, skill
  evidence, and actual immutable runtime profile.

## Skill Applicability Check

- Session inventory, `build-protocol/skills/EXPECTED_SKILLS.md`, readable user
  skill entrypoints, and installed lock are the required evidence sources.
- Selected/read for orchestration: `subagent-driven-development`,
  `requesting-code-review`, `receiving-code-review`,
  `verification-before-completion`, and `using-git-worktrees`.
- `doc-coauthoring` is skipped because its interactive drafting flow conflicts
  with this autonomous factual reconciliation. ADR creation is N/A because
  accepted decisions are only receiving outcome annotations. Runtime/TDD/
  TypeScript implementation skills are N/A unless inventory reveals a code
  defect, which must be routed rather than absorbed here.
- No server runtime/API code changes are planned, so new Spine JVM source
  inspection is N/A; accepted T-0037/T-0038 implementation records are the
  evidence for observable lifecycle wording.

## Immediate Next Action

Dispatch the existing Terra Medium implementer after a bounded current-state
inventory. Run focused docs/status lint before any reviewer assignment.

## Bounded Current-State Inventory

- `build-protocol/RUNTIME_ARCHITECTURE.md` still presents the integrated
  T-0037 lifecycle as future work and says startup does not enumerate recovery
  scopes. Reconcile that section to observable integrated ownership/ordering,
  preserving internal names only as historical implementation attribution.
- `build-protocol/DEVELOPER_API.md` still says `ServerEnvironment` is outside
  the public surface although the package root and API docs export it. Correct
  the canonical public-lifecycle statement without absorbing T-0039b's README/
  TypeDoc rewrite.
- D-0085/D-0086 remain accepted and already contain partial active outcome
  clarifications. Add a concise final implementation outcome for T-0036 plus
  T-0037a-f/T-0038b without rewriting the decisions.
- `PROJECT_COMPLETION_PLAN.md` still names T-0037b as the active frontier.
  Advance only its current execution status/frontier; retain its dated starting
  state as historical context.
- T000/T001 retain bootstrap-era `In progress`/`Candidate` headers. Mark them
  historical/closed and add a short factual closure note without rewriting
  their original work logs.
- T-0038b task/work headers stop at accepted-for-main-integration although both
  records document merge `ac1d0f5e`, post-merge verification, and remote
  integration. Reconcile those active headers.
- The T-0038 capability matrix row 23 routes this status mismatch to T-0039.
  After the header correction, resolve that row to IMPLEMENTED, remove the
  route, and restore exact `31/25/4/0/1/1/0` counts and T-0040/T-0041-only
  routing.
- Current T-0037 parent and implementation-child task/work/review headers are
  already complete/integrated; no edit is authorized absent a concrete false
  active summary. `TECHNICAL_SPEC.md` contains no conflicting lifecycle claim
  in the bounded inventory and should remain unchanged unless the author finds
  one with exact evidence.

## Author Dispatch

- Existing implementer role, explicit `gpt-5.6-terra` / medium, no subagents.
- The author may edit only the inventoried canonical/status surfaces plus the
  three T-0039a records. It must report every changed path and every inspected
  candidate left unchanged with a reason.
