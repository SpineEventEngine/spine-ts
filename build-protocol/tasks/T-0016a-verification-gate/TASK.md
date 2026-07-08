# T-0016a: Verification Gate Normalization

Status: review complete; ready for final verification
Start: `2026-07-08 02:13 WEST`
Baseline commit: `f8a95d5`
Task log path: `build-protocol/tasks/T-0016a-verification-gate/TASK.md`
Branch: `task/T-0016a-verification-gate`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0016a-verification-gate`
Requirements splitter: inherited from `T-0016`
Authoring sub-agent: `019f3f4c-09d9-74c1-bcae-133f0ba857d0` completed and closed
Reviewer sub-agents: all required lanes clean; see
`build-protocol/reviews/T-0016a-verification-gate.md`
Implementation commit: `277a6a2`

## Objective

Normalize the repository verification gate so later autonomous tasks can rely on
one repeatable command instead of hand-built shell workarounds.

This task is intentionally tooling-only. It must not change framework runtime
behavior, server APIs, Protobuf contracts, generated application code, or the
to-do domain model.

## Human-Imposed Requirements Ledger

- Continue autonomously until all tasks are done or a real blocker appears.
- Keep `human-review-1-jul.md` untouched.
- Use one implementation sub-agent for this task and separate reviewer
  sub-agents for style, docs, TypeScript/API docs, security, and
  performance/reliability.
- Close every participating sub-agent once its role is complete.
- Update durable task, work, and review logs before or alongside changes.
- Keep the implementation small and practical. Do not introduce a build system
  or orchestration framework unless a concrete need is proven.
- Generated output must remain ignored, regenerated, and uncommitted.
- `pnpm verify` must work without manual tracked-file formatting workarounds.
- Verification must have one normalized generation boundary for full checks.
  Nested scripts must not repeatedly publish generated output or race the same
  ignored generated directories.
- Formatting checks must exclude ignored generated output and untracked human
  notes without requiring ad hoc shell workarounds.
- `proto:check-generated` must compare against the same effective generation
  inputs used by the full verification command, so generated-clean evidence is
  meaningful.
- Verification must report coverage at or above 90%.

## Scope

In scope:

- Root package scripts and small verification helper scripts.
- Focused tests for changed verification helpers.
- Documentation/log updates for the normalized verification workflow.

Out of scope:

- Runtime/server behavior changes.
- New external dependencies unless a reviewed decision proves they are needed.
- Generated Protobuf output commits.
- To-do example API or domain behavior changes.

## Skill Applicability

Canonical checklist evidence:

- Session skill inventory is available in the root session.
- Selected and read before task actions:
  `subagent-driven-development`, `using-git-worktrees`,
  `verification-before-completion`, `resolving-merge-conflicts`,
  `monorepo-management`, and `javascript-testing-patterns`.
- Repo-local expected-skill manifest checked at
  `build-protocol/skills/EXPECTED_SKILLS.md`.
- Bounded installed-skill entrypoint evidence collected with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`;
  task-relevant entries include workflow, worktree, review, verification,
  monorepo, testing, TypeScript, Node, and debugging skills.
- Later implementer and reviewer sub-agents must run their own canonical skill
  applicability checks before task actions.
- No Spine JVM source inspection is required because this task is tooling-only
  and does not change `@spine-ts/server` runtime/API code.
- Implementation sub-agent re-check on `2026-07-08 02:17 WEST`:
  - Required task, work, review, protocol, package, proto workflow, generated
    clean, and formatting/check-script sources read before edits.
  - Task-provided skills from the implementation prompt:
    `monorepo-management`, `javascript-testing-patterns`, and
    `verification-before-completion`.
  - Selected and fully read before edits:
    `monorepo-management`
    (`/Users/armiol/.agents/skills/monorepo-management/SKILL.md`),
    `javascript-testing-patterns`
    (`/Users/armiol/.agents/skills/javascript-testing-patterns/SKILL.md`),
    and `verification-before-completion`
    (`/Users/armiol/.agents/skills/verification-before-completion/SKILL.md`).
  - Also read `implement`
    (`/Users/armiol/.agents/skills/implement/SKILL.md`) after focused script
    edits because this is an implementation assignment; its guidance matched
    the planned focused tests, full verification, review, and commit workflow.
  - Checked `build-protocol/skills/EXPECTED_SKILLS.md`.
  - Enumerated installed skill entrypoints with
    `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`;
    relevant entries included monorepo, JavaScript testing, verification,
    implementation, worktree, review, and cleanup/debugging skills.
  - Checked relevant lock-manifest entries with
    `rg -n '"(monorepo-management|javascript-testing-patterns|verification-before-completion|subagent-driven-development|using-git-worktrees|requesting-code-review|nodejs-backend-patterns|typescript-advanced-types)"' /Users/armiol/.agents/.skill-lock.json`.
  - Skipped `using-git-worktrees` because the task worktree was already
    provisioned and this sub-agent was instructed to own only that worktree.
    Skipped `resolving-merge-conflicts` because no merge or conflict state was
    present.

## Acceptance Criteria

- `pnpm verify` performs one generation/publish step for the full verification
  run and avoids nested generated-output publishing.
- Typecheck, lint, tests, coverage, docs, proto lint, generated-clean, and
  cleanup guard still run under the normalized gate.
- Formatting checks ignore generated output and untracked files such as
  `human-review-1-jul.md` without requiring a custom command outside
  `package.json`.
- Generated-clean verification uses the same generation inputs as `verify`.
- Focused tests cover any new or changed verification helper behavior.
- Full verification passes, including coverage at or above 90%.
- No generated output or user-owned untracked files are committed.

## Implementation Notes

- Prefer a tiny script or existing script extension over adding a task runner.
- If changing the root script graph, avoid broad renames that force users to
  relearn common commands.
- If full verification needs sandbox escalation for local HTTP/IPC listeners,
  record the sandbox failure and escalated pass in this task log.

## Verification Plan

- Focused helper tests for changed scripts.
- `corepack pnpm verify`.
- `git diff --check`.
- `git status --short` to confirm generated output and `human-review-1-jul.md`
  are not staged or committed.

## Implementation Result

- Root verification scripts now keep standalone public commands self-sufficient
  while `pnpm verify` performs exactly one `proto:generate` publish step before
  running `*:generated` helper scripts.
- `format` and `format:check` now use `scripts/format-files.mjs`, which formats
  tracked repository paths only and excludes generated output paths.
- `proto:check-generated` now stages expected output through the same
  `proto-workflow` generation templates and handler-registry generation path
  used by `proto:generate`, without publishing generated output again.
- Focused helper and package-metadata tests cover the normalized script graph,
  staged generation without publishing, generated-clean safety, and tracked-file
  formatting selection.
- Narrow type-test fixture repairs keep `typecheck:tooling` clean under the
  current exact-optional-property and generated-descriptor types.
- Coverage remains above the required threshold after adding focused analyzer
  edge-case tests and documenting the build-time analyzer exclusion from the
  global runtime coverage threshold.
- Implementation was committed as `277a6a2` (`Normalize verification gate`).
- All required reviewer lanes reported clean against branch head `b962ba1`.

## Verification Evidence

- Focused helper tests:
  `corepack pnpm exec vitest run scripts/proto-workflow.test.mjs scripts/check-generated-clean.test.mjs scripts/package-metadata.test.mjs scripts/format-files.test.mjs`
  passed with 4 files / 14 tests.
- Focused analyzer tests:
  `corepack pnpm exec vitest run packages/server/test/handler/build-time-handler-analyzer.test.ts`
  passed with 1 file / 13 tests.
- Sandboxed `corepack pnpm verify` failed during local listener/IPC tests with
  `listen EPERM: operation not permitted 127.0.0.1` and ZeroMQ
  `Operation not permitted`; this was recorded and rerun escalated as required.
- Final escalated `corepack pnpm verify` passed on `2026-07-08 02:39 WEST`:
  node check, one proto generation/publish step, typecheck, lint plus cleanup
  guard, formatting, tests, coverage, docs/API check, proto lint, and
  generated-clean all passed.
- Final coverage summary: 95.12% statements, 90.33% branches, 98.08% functions,
  and 95.12% lines.
- `git diff --check` passed.
- `corepack pnpm format:check` passed.
- `git status --short` showed only intended staged tracked/log/config/test
  changes and no staged generated output or user-owned untracked notes.
