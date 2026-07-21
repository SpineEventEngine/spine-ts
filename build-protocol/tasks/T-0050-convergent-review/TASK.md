# T-0050: Risk-tiered convergent review protocol

Status: Completed, merged, and post-merge verified; closure record requires
`origin/main` push

## Objective

Reduce per-task autonomous-development latency by implementing the eight
human-approved protocol changes while preserving Spine TS's existing roles,
high-risk correctness safeguards, durable integration, and remote closure.

## Classification

Standard governance-documentation task. It changes more than three governing
files and therefore does not qualify as micro. It changes no runtime, package,
public TypeScript, Protobuf, persistence, dependency, generated, or build
behavior.

## Human-Imposed Requirements Ledger

- Implement every approved recommendation numbered 1 through 8.
- Introduce micro, standard, and high-risk task classes.
- Preserve existing roles and dispatch only relevant specialist concerns.
- Use severity-based convergence, aggregated corrections, targeted re-review,
  and a maximum of two complete waves without waiving high-risk defects.
- Accept immutable configured role/profile evidence when child
  self-introspection is unavailable; retain explicit dispatch fields.
- Cache stable skill-applicability discovery by task and role context.
- Make full verification and post-merge verification change-sensitive.
- Prevent record-only changes from reopening specialist review or causing
  self-referential closure commits.
- Preserve the current safeguards identified in the approved proposal.
- Commit and push after implementation, then merge and push `main`.
- Preserve unrelated files and do not read, edit, stage, move, or delete
  `human-review-1-jul.md`.

## Acceptance Criteria

1. `AGENTS.md`, `BUILD_PROTOCOL.md`, `CODE_QUALITY.md`, and the Fast Execution
   Protocol agree on task classification, reviewer relevance, convergence,
   metadata, skills, verification, and record cadence.
2. A reusable micro-task record template exists and is linked from protocol
   navigation.
3. Existing specialist roles, model allocation, final security review,
   high-risk escalation, focused regression evidence, worktree safety, and
   remote synchronization remain intact.
4. Deterministic documentation, formatting, whitespace, link, and consistency
   checks pass.
5. The task branch and integrated `main` are committed and pushed.

## Assignment And Skills

- Baseline: `92a0ab98ec536bf34f3068fcda543b0b7d0983c5`.
- Branch/worktree: `task/T-0050-convergent-review` at
  `.worktrees/T-0050-convergent-review`.
- The orchestrator owns the documentation edits. The current execution policy
  does not permit child dispatch unless the human requests delegation, so no
  subagent result or runtime metadata is claimed for this task.
- Selected and fully read: `doc-coauthoring`, `using-git-worktrees`, and
  `verification-before-completion`. Runtime TDD and TypeScript implementation
  skills are N/A because no runtime or source contract changes.

## Acceptance Evidence

- All eight approved changes are implemented across the authoritative protocol,
  quality rules, fast execution packet, contributor workflow, templates, and
  accepted D-0097 decision.
- Existing roles and model allocation remain unchanged. Selective planning,
  Terra Medium implementation, risk-specific Terra High review, final security
  review, focused regression evidence, worktree safety, the requirements
  ledger, JVM-source guardrails, and remote synchronization remain active.
- Documentation review found no P0-P3 defect. Style/maintainability,
  TypeScript/API, performance/reliability, and security have the concrete N/A
  dispositions recorded in the review log.
- Focused verification passed Prettier, `git diff --check`, cleanup enforcement,
  current-diff/new-file line length, release readiness at 59 package imports and
  119 relative Markdown links, and TypeDoc/API expected-export checks.
- No full coverage gate is required: this standard documentation task changes
  no runtime, test, public contract, generated artifact, dependency, or shared
  build behavior. Recent verified `main` evidence remains authoritative.

## Integration Closure

- Accepted task endpoint `5564729d` is pushed to
  `origin/task/T-0050-convergent-review`.
- Merge commit `fb1b9088` is pushed to `origin/main`.
- The verified task and merged `main` trees are byte-identical at tree
  `b569d834176ceb293ab63820ee8d94bcec6aa5db`.
- Fresh post-merge focused verification passed Prettier, `git diff --check`,
  cleanup enforcement, release readiness at 59 imports / 119 links, and all
  TypeDoc/API expected-export checks.
- The commit containing this closure record must be pushed to `origin/main`.
  Its content-addressed SHA is intentionally not embedded in itself; the remote
  ref and Git history are the durable evidence required by D-0097.
