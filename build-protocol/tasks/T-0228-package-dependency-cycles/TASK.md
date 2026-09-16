# T-0228: Package Dependency Cycles

Status: Complete
Start: `2026-09-14`
Closure: `2026-09-14`
Baseline commit: `65332b525ea38a965e6a5cf90e1a404720ebffc8`
Branch: `fix-package-dependency-cycles`
Worktree: current checkout at
`/Users/armiol/development/experiments/spine-ts`; the human explicitly required
no separate worktree
Task classification: High-risk
Verification profile: `verify:release`, because this changes shared release
tooling and the package graph used immediately before publication

## Objective

Remove false development/test edges from Lerna's temporary publication graph
and correct the Proto package test boundary that introduced direct development
dependencies on `core` and `server`. Prove the correction by running the pinned
Lerna executable against a generated publication workspace. Do not publish.

## Estimate

Expected active agent work is 1.5–3 hours, plus approximately 15–25 minutes for
the final release gate. This includes a Lerna-backed regression test, the
minimal workspace and test-boundary corrections, focused checks, one relevant
review wave, corrections, versioning, release verification, pushes, and the
final report. The range covers uncertainty in relocating the mixed Proto/server
integration assertions without weakening their coverage.

## Required Inputs Read

- `AGENTS.md`
- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/PROJECT_COMPLETION_PLAN.md`
- `build-protocol/skills/EXPECTED_SKILLS.md`
- `build-protocol/DECISION_LOG.md`, especially D-0115 through D-0118
- the current release CLI, publication workflow, package manifests, and tests
- the installed pinned Lerna 10.0.1 implementation

## Human Requirements Ledger

- Do not add Lerna `--reject-cycles`.
- Fix the package/publication graph instead of suppressing or converting its
  warning into a failure.
- Reproduce and verify the behavior with Lerna itself.
- Do not invoke `lerna publish`, `npm publish`, or otherwise mutate NPM.
- Start from fresh `origin/master` on a plainly named feature branch.
- Work in this chat and checkout; do not create a separate task or worktree.
- Push every coherent feature-branch commit to official `origin` immediately.
- Do not create or merge a pull request and do not change `master`.

## Evidence And Root Cause

- The 18 public packages have an acyclic runtime dependency graph, already
  enforced by `expectedReleaseModel()`.
- `pnpm exec lerna list --toposort --all` reports cycles because Lerna includes
  local `devDependencies` when constructing its project graph.
- `createPublicationWorkspace()` currently copies complete source manifests to
  the temporary outer workspace. Those manifests exist only to let Lerna find
  packages, but their development/test edges influence publication ordering.
- The actual publishable package lies under each outer package's `.publish`
  directory and must remain unchanged.
- `packages/proto/test/integration-broker-contract.test.ts` mixes descriptor
  contract checks with server wrapper behavior. That causes the low-level
  `proto` package to import `core` and `server/testing` and declare both as
  development dependencies.

## Acceptance Criteria

1. The temporary outer manifests used for Lerna ordering contain runtime
   dependency information but no development-only graph edges.
2. The `.publish` payloads and their manifests are copied unchanged.
3. A regression test runs the repository's pinned Lerna executable against a
   generated workspace and fails if Lerna emits `ECYCLE`.
4. The same Lerna proof uses the real public-package manifest selection, not an
   invented package sorter or mocked graph.
5. Proto descriptor/binary compatibility tests remain in `proto`; server
   wrapper behavior is tested in the server package.
6. `@spine-event-engine/proto` no longer needs development dependencies on
   `@spine-event-engine/core` or `@spine-event-engine/server`.
7. No Lerna `--reject-cycles` option is added and no publication command runs
   during tests or verification.
8. Focused tests, relevant review, `verify:release`, and final branch CI pass.

## Skill Applicability

| Skill                     | Source                                              | Application                                                                    |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `systematic-debugging`    | `~/.agents/skills/systematic-debugging/SKILL.md`    | Reproduce Lerna's actual graph behavior and establish the cause before editing |
| `test-driven-development` | `~/.agents/skills/test-driven-development/SKILL.md` | Add and observe the Lerna-backed regression test failing before correction     |
| `monorepo-management`     | `~/.agents/skills/monorepo-management/SKILL.md`     | Keep runtime, development, and publication dependency graphs distinct          |
| `git-advanced-workflows`  | `~/.agents/skills/git-advanced-workflows/SKILL.md`  | Preserve the fresh-master feature-branch workflow without rewriting history    |

The expected-skill inventory and `/Users/armiol/.agents/.skill-lock.json` were
read. `using-git-worktrees` is not applied because the human explicitly
prohibited a separate worktree. The review and verification skills will be
read before those gates.

## Execution And Agent Routing

1. Add the real-Lerna regression and observe RED.
2. Correct temporary publication manifests and the Proto/server test boundary.
3. Run focused mechanical checks and inspect the resulting Lerna graph.
4. Collect one complete relevant reviewer wave and return accepted findings to
   the existing implementation context.
5. Apply the next unused common package version in the repository-required
   isolated commits, run `verify:release`, push every commit, and confirm CI.

Implementation assignment: existing implementer role; bounded scope is
`scripts/release-cli.mjs`, its release tests, the mixed Proto/server integration
test, affected manifests/lockfile, and this task record. Expected and explicitly
dispatched profile: `gpt-5.6-terra`, medium reasoning. The implementer may not
spawn sub-agents and must not revert unrelated changes.

Planned review concerns:

- Style/maintainability: `gpt-5.6-terra`, high reasoning, because production
  release-tool structure changes.
- Performance/reliability: `gpt-5.6-terra`, high reasoning, because Lerna's
  dependency ordering directly precedes publication.
- Documentation: N/A unless public claims change; the task record is evidence,
  not user-facing package documentation.
- TypeScript/API docs: N/A because no TypeScript public API, declaration, wire,
  or serialized framework contract changes.
- Security: N/A at this task boundary; no credential, provenance, registry
  authorization, or publication invocation changes.

The Desktop dispatch surface supports explicit model and reasoning fields.
Runtime self-introspection may be unavailable; the configured role/profile is
then the acceptance evidence.

## Work Log

- `2026-09-14`: Fetched `origin/master`, created
  `fix-package-dependency-cycles` at the exact fresh baseline, and confirmed a
  clean same-checkout branch.
- `2026-09-14`: Reproduced 14 cycle paths among the selected public packages
  with pinned Lerna 10.0.1. Confirmed the repository's runtime-only release
  model remains acyclic.
- `2026-09-14`: Recorded the human's rejection of `--reject-cycles` and the
  requirement to prove the correction through Lerna itself.
- `2026-09-14`: Existing implementer role was explicitly dispatched as
  `gpt-5.6-terra` / medium with no inherited turns. The immutable role profile
  is the available runtime evidence. It observed RED from pinned Lerna 10.0.1
  (`ECYCLE`, including `core -> proto -> core`), then GREEN after correcting
  the outer workspace manifests.
- `2026-09-14`: Focused preflight passed: 17 release-CLI tests and 39
  Lerna/Proto/server tests, plus formatting, ESLint, cleanup, TSDoc, and diff
  hygiene. The first release-CLI run exposed a missing `sql-escaper@1.5.2`
  tarball in the local pnpm store; after filling that cache, all 17 cases
  passed without a repository change.
- `2026-09-14`: Review wave prepared against baseline
  `65332b525ea38a965e6a5cf90e1a404720ebffc8` plus the complete local diff.
  Existing style/maintainability and performance/reliability reviewer roles
  will be explicitly dispatched as `gpt-5.6-terra` / high with no inherited
  turns. Each receives one distinct concern and may not spawn sub-agents.
- `2026-09-14`: The existing implementer completed this bounded change using
  the explicitly dispatched `gpt-5.6-terra` / medium profile; runtime
  self-introspection is unavailable on this surface. Added a regression that
  builds the Lerna workspace from `readReleaseManifests()` and the real ordered
  18-package release selection. RED: pinned Lerna 10.0.1 emitted `ECYCLE`,
  including `core -> proto -> core`. The correction removes only
  `devDependencies` from outer manifests while retaining the untouched `.publish`
  directory copy.
- `2026-09-14`: Removed server-wrapper assertions from the Proto-only
  descriptor/binary contract and removed Proto's now-unused `core` and `server`
  development dependencies, with matching lockfile cleanup. GREEN focused
  evidence: the Lerna regression passed without `ECYCLE`; the Proto contract
  test passed; and the pre-existing server integration suite passed 33 tests.
  No `lerna publish`, `npm publish`, registry, or NPM mutation command ran.
- `2026-09-14`: Strengthened the disposable publication-workspace fixture with
  real copied files. It proves that the outer Lerna manifest retains a runtime
  dependency while omitting `devDependencies`, and that
  `.publish/package.json` is byte-for-byte unchanged and retains its published
  metadata. The focused test and its formatting check passed; no publication
  command ran.
- `2026-09-14`: Cheap preflight found an unused discarded destructuring binding
  in the release CLI. Replaced it with an explicit copied-manifest deletion;
  behavior is unchanged. Focused ESLint, both publication-workspace regressions,
  Prettier, and `git diff --check` passed. No publication command ran.
- `2026-09-14`: Applied the accepted review batch. Server-owned direct wrapper
  coverage now proves a valid generated domain Event round-trip, incomplete
  Event and origin rejection, malformed wrapper/type/identity rejection, and
  distinct UUID control identities. Proto retains only descriptor, binary, and
  pinned-source checks. The real-Lerna regression now rejects `ECYCLE` in the
  combined stdout/stderr output. Focused server, Proto, and Lerna tests passed;
  ESLint, Prettier, cleanup, TSDoc, and `git diff --check` passed. No
  publication command ran.
- `2026-09-14`: The first full release gate stopped at strict TypeScript
  compilation in the new server wrapper test. The test intentionally passed an
  absent required origin and spread generated `Any` values, which violates
  `exactOptionalPropertyTypes`; production code was unaffected. The invalid
  origin now uses an explicit test-only cast and malformed `Any` values use
  explicit `typeUrl` and `value` fields. `typecheck:build:generated` and the
  tooling typecheck passed, as did focused server/Proto/Lerna tests, ESLint,
  Prettier, cleanup, TSDoc, and `git diff --check`. No publication command ran.
- `2026-09-14`: Completed review wave. Existing performance/reliability
  reviewer `/root/package_cycles_reliability_review`, explicitly dispatched as
  `gpt-5.6-terra` / high, returned CLEAN. Existing style/maintainability
  reviewer `/root/package_cycles_style_review`, explicitly dispatched as
  `gpt-5.6-terra` / high, reported one P1: direct external-message wrapper
  contracts were deleted rather than moved to a server test; and one P2: the
  Lerna regression checked only stderr for `ECYCLE`. The configured immutable
  reviewer profiles are the available runtime metadata. Both accepted findings
  return together to the existing implementer.
- `2026-09-14`: Implementer corrected both findings. Added a focused
  server-package `external-messages` suite with domain Event fixtures for the
  direct wrapper contracts, and made the Lerna regression inspect combined
  stdout/stderr. Focused evidence passed: 38 server/Proto tests, the pinned-
  Lerna regression, ESLint, Prettier, cleanup, TSDoc, and diff hygiene. The P1
  test-boundary correction reopens only the style/maintainability lane; the P2
  combined-output assertion is deterministic and does not reopen reliability.
- `2026-09-14`: Narrow style/maintainability re-review by
  `/root/package_cycles_style_review` returned CLEAN. It confirmed the direct
  wrapper contracts now live in the server package with an Event-domain
  fixture, the Proto test retains only compatibility concerns, and the Lerna
  assertion checks combined command output.
- `2026-09-14`: Confirmed `2.0.0-snapshot.12` is absent from the NPM registry
  for all 18 public packages. Commit `0a665fd2e` changes only the top-level
  `version` in all 30 workspace manifests with the required exact commit
  message. Commit `061bdf006` separately aligns internal dependency pins and
  the lockfile. Both commits were pushed immediately to official `origin`.
- `2026-09-14`: Selected the mandatory `verify:release` profile because the
  correction changes shared packaging and release preparation behavior. Read
  the `verification-before-completion` skill before this gate; no completion
  claim will precede fresh full-command evidence.
- `2026-09-14`: The first `verify:release` invocation stopped before building
  because the workspace version change required a fresh `pnpm install`. After
  the install, version-dependent generated Proto manifests and assertions were
  aligned in separately pushed commit `641452403`.
- `2026-09-14`: After strict-test correction commit `a46c6dcb4`, the complete
  cheap preflight passed both typechecks, formatting, ESLint, cleanup, TSDoc,
  Proto verification, and 84 focused tests. Fresh `pnpm verify:release` then
  passed at exact SHA `a46c6dcb44952b60e85929cda662ef14bf8054b6`:
  290 test files and 4,723 tests passed; branch coverage was 90.09%. The final
  closure commit changes only this evidence record. Final branch CI remains the
  remote acceptance proof for that record-only SHA.

## Scheduled Security Workflow Correction — 2026-09-15

Status: Complete. The human approved this correction in the same branch.
Classification: Standard; a bounded CI invocation correction, without changing
the security audit policy or application behavior.
Estimate: 0.2–0.4 hours active work for implementation, focused verification,
review, and reporting, plus the full release verification gate.

Root cause: the scheduled workflow runs `pnpm audit:release` without an install.
The repository's `verifyDepsBeforeRun: error` setting rejects this package
script before its built-in audit commands begin. At the failing run's exact
commit, Node 24.18.0 and pnpm 11.9.0 reproduce exit 1 in a clean checkout.
The scoped `--config.verify-deps-before-run=false` invocation reproduces exit 0
with both audit scopes reporting no known vulnerabilities.

Acceptance: retain the global dependency-state guard and both low-threshold
audit scopes; disable only the irrelevant dependency-state check for this
workflow invocation; update the exact workflow regression test; verify from a
clean checkout; do not publish, create a PR, or change master.

Dispatch: existing implementer role, explicit `gpt-5.6-terra` / `medium`,
responsible only for `security.yml` and its regression test. Independent
style/maintainability review will use explicit `gpt-5.6-terra` / `high` with no
conversation history. Desktop supports both explicit profiles. Runtime
self-introspection is not exposed; configured dispatch fields are the evidence.
Other review concerns: API/TypeScript and domain correctness N/A because no
public, serialized, or domain contracts change; documentation N/A beyond this
task evidence; final security review not reopened because audit policy and
credentials are unchanged. Verify that no audit failure is suppressed.

Implementation evidence: the exact workflow test failed first (1 failed,
6 passed), rejecting the old unqualified script invocation. After the one-line
workflow correction and explanatory comment, all 7 workflow tests passed.
The orchestrator independently ran workflow and package-metadata suites:
21 tests passed. Tooling typecheck, focused ESLint, changed-file Prettier,
and diff integrity passed. No runtime source changes require coverage or
package-specific typechecks. A clean archive of HEAD with no `node_modules`,
Node 24.18.0, pnpm 11.9.0, and `CI=true` ran the corrected command: both audit
scopes reported no known vulnerabilities and exited 0. The global guard and
the package script remain unchanged. The implementer dispatch explicitly
matched its required Terra/medium profile.

Independent no-history style/maintainability review returned CLEAN. The explicit
Terra/high dispatch was confirmed. It verified pinned pnpm accepts the scoped
override, the global setting remains `error`, the two audit commands remain
fail-fast, and no credentials or failure suppression were added. Performance/
lifecycle/persistence review is N/A: no such components change; invocation
correctness and fail-fast behavior were checked by this bounded review.
The full `verify:release` profile is required for the existing release-tooling
branch. After preflight and review converged, it passed: 290 test files and
4,723 tests; branch coverage 90.09%. All build, documentation, formatting,
lint, Proto, production-dependency, and release-readiness gates passed.
The test suite took 721 seconds with one worker. No publication was invoked.
Only the workflow, its exact regression assertion, and this task record change.
The existing version-only commit remains sufficient for the same branch.
GitHub's scheduled proof requires this workflow to reach master through the
human-managed merge; no scheduled run on master is claimed green here.
