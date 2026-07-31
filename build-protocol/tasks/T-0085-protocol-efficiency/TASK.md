# T-0085: Faster autonomous development protocol

Status: In review

## Classification And Scope

- Classification: standard, promoted from micro after documentation review
  proved that the accepted single-pass verification rule requires shared build-
  tooling changes.
- Baseline: `main` at `9d8c2c76`.
- Branch and worktree: `task/T-0085-protocol-efficiency`;
  `.worktrees/T-0085-protocol-efficiency`.
- Scope: governing protocol, executable verification-profile scripts, and the
  smallest TypeDoc-check adjustment needed to avoid duplicate generation.
- Exclusions: product runtime, package APIs, dependencies, generated sources,
  and coverage thresholds.

## Acceptance Criteria

- All ten accepted efficiency changes are binding in the canonical protocol.
- Every feature-branch commit is pushed immediately without history rewriting.
- `verify:task` and `verify:release` are executable package scripts.
- `pnpm verify` aliases the release profile.
- One release invocation builds TypeScript once, runs tests once with coverage,
  generates TypeDoc once, and avoids repeated Proto source/checksum validation.
- Task verification keeps focused tests/coverage as explicit task-owned
  commands and runs common deterministic gates once.

## Human-Imposed Requirements Ledger

- Apply all ten accepted efficiency improvements now.
- Add frequent feature-branch pushes, specifically after every commit.
- Commit, push, merge, and push these changes before resuming T-0084.
- Re-read the merged protocol from scratch before continuing autonomous work.
- After re-reading, finish T-0084 autonomously under the updated protocol.

## Skills And Ownership

- Selected skills: `implement`, `requesting-code-review`, and
  `verification-before-completion`; all were read before governed action.
- Implementation assignment: existing `implementer` role; expected immutable
  profile `gpt-5.6-terra` / medium. The dispatch states both fields explicitly;
  runtime self-metadata was unavailable, so the configured profile is the
  available evidence.
- Documentation review: existing `documentation_reviewer` role; expected
  immutable profile `gpt-5.6-luna` / medium. Runtime metadata was unavailable.

## Verification Profile

- Selected profile: `verify:release`, because package verification scripts are
  shared build tooling.
- Mandatory preflight: changed-file formatting and diff integrity, tooling
  typecheck, focused script tests, and a dry inspection of command expansion.
- Coverage inspection is N/A before implementation because no production code
  changes; the release profile must still prove the unchanged global threshold.

## Implementation Record

- 2026-07-31: the assigned implementer added executable `verify:task` and
  `verify:release` profiles. `verify` aliases the release profile. Both profiles
  generate Proto once, then reuse generated outputs; the release profile builds
  TypeScript once, runs Vitest once with coverage, and invokes the TypeDoc/API
  check once. The generated-output Buf lint keeps the existing lint gate without
  rerunning the Proto source checksum preflight that generation already ran.
- `verify:task` intentionally excludes test and coverage commands: focused task
  tests and coverage remain explicitly selected and recorded by the task owner.
- Assignment acceptance: existing `implementer` role, explicitly dispatched as
  `gpt-5.6-terra` / medium. Runtime self-metadata is not exposed in this
  surface, so the immutable configured profile is the available evidence.
- TDD evidence: the focused metadata test first failed because `verify` was
  still the old generated-chain command, then passed after the minimal profile
  composition was added.
- Focused validation: `../../node_modules/.bin/vitest run
scripts/package-metadata.test.mjs` passed (9 tests); `git diff --check`
  passed. The direct `pnpm exec` route was unavailable because the isolated
  worktree has no local `node_modules`; the shared parent executable was used.
- Next: run the mandatory preflight and the release profile once after the
  orchestrator has collected and resolved the applicable review wave.

## Review-correction Record

- 2026-07-31: confirmed review found two single-pass gaps. The full generated
  cleanliness checker stages a comparison generation, and the API checker
  overrode TypeDoc's configured HTML output with a temporary directory.
- Added `proto:check-generated:current`, which verifies the immediately
  preceding generated outputs are present, ignored, untracked, and safe without
  staging another generation. Both verification profiles use it; the standalone
  `proto:check-generated` retains its independent stale-output comparison.
- The one TypeDoc invocation now retains `typedoc.json`'s `docs/api/reference`
  output and writes only its assertion JSON to a temporary file.
- Focused correction validation passed: `scripts/package-metadata.test.mjs` and
  `scripts/check-generated-clean.test.mjs` (18 tests), changed-file Prettier,
  and `git diff --check`.
- A direct TypeDoc invocation with the checker argument shape could not reach
  output generation in this fresh worktree: 683 pre-existing missing generated
  module/dependency and build-resolution errors stopped TypeDoc first. The
  release profile's preceding Proto generation and TypeScript build are the
  required environment for that end-to-end assertion.

## Focused preflight correction

- 2026-07-31: a real build made the stale Chat-registry fixture nondeterministic
  by installing worktree-local Buf. `stageGeneratedTargets({ repoRoot })` still
  resolved Buf and its default working directory from the source worktree, so
  the fixture accidentally used ambient tooling instead of its fake fixture
  executable.
- Corrected the staging boundary to resolve and run Buf relative to its supplied
  repository root. This keeps production behavior unchanged for the default
  root and makes isolated generated-cleanliness fixtures deterministic.
- The complete 18-test focused suite passed after the correction.
