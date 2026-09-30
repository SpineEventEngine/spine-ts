# Fix publication audits

## Scope and acceptance

Start: 2026-09-30. Branch: `fix-publication-audits`.
Baseline: `3682e9abcda2b2ac404fae14cbe89b4d1bc6ed8e` from freshly fetched
`origin/master`; local `master` was fast-forwarded to it.
Reuse the clean, merged worktree at
`/Users/armiol/.codex/worktrees/cross-context-queries/spine-ts`.

The Publish run 36717071231 passed all 5,135 tests, then failed the dependency
audit with 27 findings. Publication never started. Both audit commands also
failed locally against the same lockfile. Correct the dependencies and add the
same audits to pull-request CI before expensive verification. Preserve package
preparation, trusted publication, permissions, and snapshot-only tagging.

Acceptance: both audits return zero; focused workflow checks pass; all workspace
versions and current dependency/documentation references use one unused next
snapshot; release verification and package preparation pass; reviewed commits
are pushed to official origin. GitHub PR checks require a human-created PR;
do not claim remote CI passed when no PR has been opened.

## Human-Imposed Requirements Ledger

- Perform the approved steps 2 through 4: update local master, create a new fix
  branch, fix the confirmed cause, include failing checks in PR CI, bump versions.
- Use plain language. Do not patch third-party source or hide audit findings.
- No unrelated runtime changes, invented infrastructure, or unnecessary tests.
- No PR creation, merge, publication, tag movement, or workflow rerun.
- Never use a `codex/`, `feature/`, or task-number branch name.
- Push each feature-branch commit immediately to official origin.
- One version-only commit changes only top-level manifest versions with the exact
  message `Bump version -> <version>`. Pins and lockfile changes go separately.
- Preserve other work and use explicit model/reasoning assignments. Children do
  not spawn children; only one implementation writer operates on these files.

## Execution and verification

Standard bounded dependency/workflow correction; no runtime or public-contract
redesign. Existing failing audits are the dependency regression. Extend the
existing workflow test first to require PR auditing, observe failure, then fix.
Prefer compatible patched dependencies and the smallest lockfile change. Verify
registry metadata and the normal release-age policy before selecting versions.

The implementer handles dependencies, workflow, focused tests, current release
documentation, version-only commit, and separate pins/docs commit. The main chat
handles these task records and review coordination. Cheap preflight includes
formatting, diff checks, audits, workflow/release tests, tooling typecheck, and
documentation checks. After review convergence run `verify:release` once and
`release-cli.mjs prepare --check`; dependency changes require release coverage.

## Skills and model assignments

Session skill catalog, `skills/EXPECTED_SKILLS.md`, and selected readable local
skill files plus `/Users/armiol/.agents/.skill-lock.json` were inspected.
Selected: systematic-debugging (diagnosis), using-git-worktrees (reuse), implement,
subagent-driven-development, test-driven-development (existing workflow test),
requesting-code-review, verification-before-completion. Bodies fully read before
their actions. Project review lanes and existing record layout take precedence
over advisory skill templates; no new roles or duplicate progress files.
No architecture, new API, new subsystem, or general monorepo reorganization is
in scope, so associated design/planning skills are not needed.

## Outcome

Implemented and independently reviewed with no findings. Both audits pass with
zero known vulnerabilities. All 31 workspace versions are snapshot.18; the full
publication verification passed 5,135 tests and the package check proved all 19
archives. See the work and review logs for commands, coverage, and limitations.
The feature branch is pushed; GitHub PR checks await a human-created PR.

Desktop supports explicit GPT-6 child profiles. Implementer: `gpt-6-sol`,
`medium`. Mechanical checks: orchestrator-dispatched `gpt-6-luna`, `medium`.
Review: existing performance/reliability reviewer `gpt-6-sol`, `medium` for
dependency compatibility and workflow correctness; documentation reviewer
`gpt-6-luna`, `medium` for current prose if changed. Both fields must be explicit.
Runtime metadata limitations and actual dispatches are recorded in the review
log. No implementation changes concern security permissions or authentication;
the change repairs dependency audit failures without weakening checks.
