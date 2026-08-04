# T-0103: Wave 6 execution efficiency

Status: Active

## Classification And Scope

- Classification: standard. The task changes canonical execution policy and
  shared verification tooling, but no framework runtime or public package API.
- Baseline: `origin/main` at `17af7a0f`.
- Branch: `task/T-0103-wave6-efficiency`.
- Worktree: `.worktrees/T-0103-wave6-efficiency`.
- Scope: persist the approved lower-cost model routing, one architecture pass
  per frozen wave, deferred broad documentation/example review, and a
  deterministic change-aware `verify:task`.
- Exclusions: Wave 6 implementation, framework runtime, Protobuf contracts,
  dependencies, npm publication, and changes to the protected primary checkout.

## Acceptance Criteria

- Mechanical checks use scripts before an LLM is asked to classify a failure.
- One Sol/high planning pass is the default for an approved stable wave;
  repeated deep planning requires a material contract change or demonstrated
  architecture blocker.
- Ordinary implementation remains Terra/medium. Ordinary documentation and
  API-documentation work uses Luna/medium or Terra/medium as appropriate;
  Terra/high remains reserved for public/wire contracts and real correctness,
  persistence, concurrency, or lifecycle risk.
- Ordinary style review does not consume a high-reasoning reviewer for
  deterministic or low-risk material. Existing reviewer roles are preserved.
- Broad documentation and all-example execution occur after runtime interfaces
  stabilize, while each runtime slice keeps its narrow TSDoc and behavior
  claims current.
- `verify:task` deterministically classifies changed paths and skips Proto or
  TypeDoc work only when the diff proves those gates cannot be affected.
- Unclassifiable or shared-tooling changes fail closed to the existing complete
  task gate.
- Focused tests prove both safe skips and fail-closed escalation.
- Every commit is pushed immediately to `origin`.

## Human-Imposed Requirements Ledger

- Persist the newly accepted build-protocol speed improvements before Wave 6.
- Use simpler and faster models for ordinary stages where doing so does not
  weaken high-risk delivery, persistence, lifecycle, or public-contract review.
- Use Sol/high planning once per stable approved wave rather than once per
  implementation slice.
- Make `verify:task` deterministically change-aware.
- Do not start Wave 6 implementation yet.
- Estimate Wave 6 in hours after this protocol task is complete.
- Preserve existing roles; do not invent or merge reviewer identities.
- Push every feature-branch commit to `origin` immediately.
- Push only to `origin`, not the migration remote.

## Skills And Assignment

The session inventory, `build-protocol/skills/EXPECTED_SKILLS.md`, the complete
bounded `~/.agents/skills` entrypoint scan, and
`~/.agents/.skill-lock.json` were inspected. Selected skills:

- `implement` for bounded production work;
- `test-driven-development` for verification-script behavior;
- `using-git-worktrees` for isolation;
- `requesting-code-review` for the pre-merge review gate; and
- `verification-before-completion` for fresh acceptance evidence.

The worktree already exists on the task branch and the focused baseline passes
11 tests. The implementation assignment uses the existing `implementer` role,
expected `gpt-5.6-terra` / `medium`; both fields must be explicit in dispatch.
Runtime self-metadata will be recorded when exposed, otherwise the configured
immutable role and metadata limitation will be recorded honestly.

## Verification And Review Plan

- RED/GREEN: `scripts/verify-task.test.mjs` and package metadata tests.
- Cheap preflight: changed-file formatting, `git diff --check`, focused tests,
  and direct command-expansion inspection.
- Profile: `verify:release`, because shared verification tooling changes.
- Style/maintainability: relevant for verification-script structure.
- Documentation: relevant for canonical protocol claims.
- TypeScript/API docs: N/A unless the implementation changes a public/package
  contract; current scope changes no TypeScript package API.
- Performance/reliability: relevant for fail-closed path classification and
  avoiding skipped required gates.

## Implementation Evidence

- 2026-08-04 RED: after restoring the worktree's locked dependencies,
  `pnpm exec vitest run scripts/verify-task.test.mjs` failed 2 assertions
  because the deterministic classifier exports did not exist.
- 2026-08-04 GREEN: `pnpm exec vitest run scripts/verify-task.test.mjs
scripts/package-metadata.test.mjs` passed 13 tests. The tests prove that
  Markdown-only changes skip Proto and TypeDoc gates while package source,
  package metadata, and shared tooling retain both gates.
- The classifier combines the branch diff from the `origin/main` merge base
  with unstaged, staged, and untracked paths; rename detection is disabled so
  both paths are classified. Git failure or an empty classification fails
  closed. Release verification remains unconditional.
- 2026-08-04 correction GREEN: 16 focused tests directly prove rename-source,
  deleted-source, untracked-source, empty-classification, and Git-failure
  behavior. An executable or JSON file under `build-protocol/` fails closed.

## Current Status

Implementation, specialist review, and release verification are complete.
Integration remains. No Wave 6 implementation has started.
