# T-0098: Clean first installation

Status: Ready for integration
Start: `2026-08-03`
Baseline: `af72de4b`
Branch: `task/T-0098-clean-install`
Worktree: `.worktrees/T-0098-clean-install`

Classification: Standard. The defect is bounded to workspace installation and
the published Proto CLI entry point, but it affects the first command run by
every contributor and the package-build contract.

## Objective

Makes the documented fresh-clone installation complete without broken
`spine-proto` executable-link warnings or misleading repeated policy output,
while preserving deterministic dependency checks and the published CLI.

## Human-Imposed Requirements Ledger

- The root README's first installation command must work cleanly in a fresh
  clone.
- Explain the observed warnings in ordinary language and remove their causes.
- Preserve the build-once application and Proto-package workflows established
  before Wave 5.
- Do not build or modify Spine JVM, publish packages, or touch protected
  human-review files.
- Use an isolated worktree and immediately push every feature-branch commit.

## Acceptance Criteria

1. A clean `pnpm install --frozen-lockfile` creates all workspace links without
   a missing `spine-proto` target warning.
2. Dependency-policy enforcement remains enabled and successful without
   repeating misleading install summaries.
3. The installed workspace CLI and packed external-consumer CLI retain their
   documented behavior after the normal build step.
4. Focused regressions, the cheap preflight, relevant specialist review, and
   the final `verify:release` profile pass.
5. The reviewed branch is merged into `main`, post-merge evidence passes, and
   both refs are pushed.

## Planning Disposition

No requirements-splitter pass is needed. This is a reproduced build-tooling
defect with no new subsystem, domain model, or serialized contract.

## Skill Applicability

- `systematic-debugging`: selected to reproduce and trace both output classes
  before changing code.
- `test-driven-development`: selected to establish failing clean-install and
  package-entry regressions before the fix.
- `using-git-worktrees`: selected because the coordination checkout contains
  unrelated user work; this task owns only its isolated worktree.

## Implementation Owner Dispatch

- Existing role: `implementer`.
- Scope: clean-install reproduction, Proto CLI package entry, dependency-policy
  output, focused tests, and directly affected documentation only.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: medium.
- Both fields must be explicit. The owner must not spawn subagents, touch
  protected files, publish, or broaden the task.

## Review Assignments

- Style/maintainability: existing reviewer, `gpt-5.6-terra` / high.
- Documentation: existing reviewer, immutable `gpt-5.6-luna` / medium if
  human-facing prose changes; otherwise record N/A.
- TypeScript/API: existing reviewer, `gpt-5.6-terra` / high because the package
  executable is a public package contract.
- Performance/reliability: existing reviewer, `gpt-5.6-terra` / high because
  fresh installation and package lifecycle are reliability boundaries.
- Final security: N/A unless the implementation changes dependencies, command
  resolution, or executable trust boundaries.

Runtime metadata is recorded when exposed. Otherwise the immutable configured
role/profile and the surface limitation are recorded honestly.

## Verification Strategy

First capture the exact output of a fresh frozen install and a deterministic
failing regression. After the smallest root-cause correction, rerun the clean
install and focused Proto CLI/package tests, then the cheap preflight. Run one
complete relevant review wave and one final `verify:release` after convergence.
