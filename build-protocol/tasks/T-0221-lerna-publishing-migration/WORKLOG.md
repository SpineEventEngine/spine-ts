# T-0221 Work Log

Task log: `build-protocol/tasks/T-0221-lerna-publishing-migration/TASK.md`
Branch: `automated-publishing-and-packaging-improvements`
Worktree: `.worktrees/automated-publishing-and-packaging-improvements`
Baseline commit: `af5c897857a85b3736a9efd7490d47faef41b4ac`
Authoring sub-agent: existing `implementer` role (`gpt-5.6-terra`, medium)
Implementation commits: `59e957f6b` through `399b323d0` (see TASK record)
Current implementation HEAD: `399b323d0`; repeated cheap preflight and final
`verify:release` rerun pending

## Purpose

Record resumable migration from the custom NPM mutation engine to pinned Lerna
10.0.1 without public-registry mutation, PR creation, or any remote push.

## Entries

| Timestamp               | Agent        | Activity                                                                               | Files/Commands                                                                                                                                                                                                                                                                 | Result                                                                                                                                                                                                                          |
| ----------------------- | ------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-08-26 15:23 WEST` | Orchestrator | Framed high-risk task, acceptance, human ledger, skill gate, routing, and estimate     | Task and planning records; repository/runtime/tool documentation                                                                                                                                                                                                               | Ready for focused baseline and implementer dispatch; no production change or push                                                                                                                                               |
| `2026-08-26 15:27 WEST` | Implementer  | Qualified pinned Lerna against a disposable Verdaccio registry                         | Synthetic pnpm workspace; `pnpm dlx lerna@10.0.1 publish from-package --registry http://127.0.0.1:4873 --yes --concurrency 1 --ignore-scripts`                                                                                                                                 | GREEN: private package excluded, public dependency published before dependent, detached/non-git checkout accepted; no public registry mutation                                                                                  |
| `2026-08-26 15:29 WEST` | Implementer  | Recorded behavior-focused RED                                                          | `pnpm exec vitest run scripts/release-policy.test.mjs scripts/package-metadata.test.mjs scripts/release-workflows.test.mjs scripts/release-registry.test.mjs`                                                                                                                  | RED: static tag policy, custom workflow publisher, and registry preflight absent                                                                                                                                                |
| `2026-08-26 15:34 WEST` | Implementer  | Ran focused GREEN                                                                      | Same focused suite plus `pnpm exec lerna --version`                                                                                                                                                                                                                            | GREEN: 35 tests passed; Lerna reports 10.0.1; no push or public publication                                                                                                                                                     |
| `2026-08-26 15:37 WEST` | Implementer  | Cleaned disposable qualification registry                                              | Confirmed PID 3494 command and owned `/tmp/spine-verdaccio.bCMWb3`; terminated process; verified `127.0.0.1:4873` closed; moved only owned directory to Trash                                                                                                                  | Cleanup complete; recoverable directory: `/Users/armiol/.Trash/spine-verdaccio.bCMWb3-t0221`                                                                                                                                    |
| `2026-08-26 15:41 WEST` | Implementer  | Mechanical correction RED/GREEN                                                        | RED: missing `lerna.json`, non-bounded registry read, privileged install without `--ignore-scripts`; GREEN: 37 focused tests; `pnpm exec lerna list --all --json` reports 25 total / 18 public / 7 private; `node scripts/release-cli.mjs prepare --check` passed              | Ready for specialist review; no final `verify:release`, push, PR, or publication                                                                                                                                                |
| `2026-08-26 15:44 WEST` | Implementer  | Fixed cheap-preflight generated version drift                                          | RED: `pnpm proto:generate` rejected stale generated `packageVersion: 2.0.0-snapshot.4`; aligned five generated manifests, then reran generation and Todo startup contract                                                                                                      | GREEN: generation passed and 17 Todo startup-contract tests passed; separate correction commit pending                                                                                                                          |
| `2026-08-26 15:46 WEST` | Implementer  | Fixed cheap-preflight ESLint globals                                                   | RED: `pnpm exec eslint scripts/release-registry.mjs` reported `AbortController`, `setTimeout`, and `clearTimeout` as undefined; changed only to `globalThis` references                                                                                                        | GREEN: 3 registry tests, targeted ESLint, and diff check passed; separate correction commit pending                                                                                                                             |
| `2026-08-26 15:49 WEST` | Implementer  | Fixed cheap-preflight JSDoc line length                                                | RED: cleanup lint reported a 134-character registry-record annotation; introduced a local JSDoc typedef without behavior change                                                                                                                                                | GREEN: cleanup lint, targeted ESLint, 3 registry tests, and diff check passed; separate correction commit pending                                                                                                               |
| `2026-08-26 15:53 WEST` | Implementer  | Applied cheap-preflight formatting correction                                          | Repository formatter rewrote exactly TASK.md, WORKLOG.md, release CLI/policy/registry/workflow test files                                                                                                                                                                      | GREEN: affected release suite passed 25 tests and diff check passed; format-check terminal evidence remains pending                                                                                                             |
| `2026-08-26 16:05 WEST` | Implementer  | Raised focused release coverage and fixed hidden artifact upload                       | Added behavior tests for checked staging/cleanup, safe CLI routing, registry outcomes, policy boundaries, and workflow artifact scope; enabled hidden files only under `$RUNNER_TEMP/release`                                                                                  | GREEN: 29 tests; scoped aggregate coverage 95.56% statements, 94.61% branches, 92.50% functions, 95.65% lines. `package-artifacts.mjs` is deletion-only and excluded.                                                           |
| `2026-08-26 16:12 WEST` | Orchestrator | Completed mandatory cheap preflight and dispatched the relevant specialist review wave | Branch-only `verify:task` with full shared gates, exact 18-package preparation/external-consumer proof, 50 focused tests, and scoped release coverage; explicit performance/reliability Terra/high, style/maintainability Terra/high, and documentation Luna/medium dispatches | GREEN: all cheap-preflight gates passed; coverage 95.56% statements, 94.61% branches, 92.50% functions, 95.65% lines; `.planning` restored untracked; no push or publication                                                    |
| `2026-08-26 16:22 WEST` | Implementer  | Applied accepted review corrections with test-first RED/GREEN evidence                 | RED: scoped CLI fixture and YAML block-scalar allowlist mismatches; GREEN: `pnpm exec vitest run` focused release, workflow, Lerna-discovery, and metadata suite                                                                                                               | Strict registry selection now emits exact missing policy names only, publish uses a guarded temporary scope file and explicit Lerna scopes, identity boundaries are enforced, and 45 focused tests pass; no push or publication |
| `2026-08-26 16:22 WEST` | Implementer  | Removed task-owned staged-test residue recoverably                                     | Inspected `/tmp/stage` (only synthetic `packages/base/.publish` and `packages/dependent/.publish` directories), then moved it to `/Users/armiol/.Trash/spine-release-stage-t0221`                                                                                              | Cleanup complete; replacement test uses a generated owned directory with guaranteed cleanup                                                                                                                                     |
| `2026-08-26 16:24 WEST` | Implementer  | Ran scoped coverage and focused mechanical preflight                                   | 25 release CLI/policy/registry tests with V8 coverage; Prettier, cleanup lint, targeted ESLint, Lerna discovery, checked staging, and diff check                                                                                                                               | GREEN: 96.00% statements, 95.23% branches, 93.18% functions, and 96.05% lines; Lerna found 25 packages; all requested gates passed                                                                                              |

## Current State

- `2026-08-26 17:42 WEST`: Affected final security re-review is clean. The
  explicit Nx denial adds no executable permission, the Buf approval remains
  unchanged, `useNx` stays false, the lockfile needs no build-policy-only
  update, and an independent fresh offline frozen install passed.

- `2026-08-26 17:38 WEST`: The first full release gate passed its build, lint,
  docs, Proto, audit, and release-readiness stages, then five tests failed in
  fresh offline installs with `ERR_PNPM_IGNORED_BUILDS: nx@23.1.1`. A one-worker
  reproduction proved this was not concurrency. `399b323d0` explicitly denies
  the unused Nx postinstall with `allowBuilds.nx: false`; it does not approve or
  execute the script. All four affected files pass together (110 tests), the
  four real-Lerna tests pass, both audits are clean, and formatting, cleanup,
  and diff checks pass.

- `2026-08-26 17:26 WEST`: Affected reliability, maintainability, and
  documentation re-reviews are clean. Final security review is also clean with
  explicit `gpt-5.6-terra` high configuration. The repeated `verify:task` cheap
  preflight passed every shared gate plus 48 focused tests; scoped coverage is
  94.25% statements, 95.03% branches, 90.19% functions, and 94.02% lines.
  Exact tarballs for all 18 packages installed and ran in the external consumer.

- `2026-08-26 17:24 WEST`: Final security review assigned to the existing
  security-reviewer role with explicit `gpt-5.6-terra` and high reasoning. The
  dispatch surface exposes the immutable configured role/profile; runtime
  self-introspection may be unavailable and is not required by the acceptance
  gate.

- `2026-08-26 17:20 WEST`: Final affected review used explicitly dispatched
  reliability and maintainability `gpt-5.6-terra` high profiles and a
  documentation `gpt-5.6-luna` medium profile. The surface exposes immutable
  configured roles/profiles rather than runtime self-introspection. The
  reliability reviewer reproduced a missing-package final-verification gap;
  `9737df292` adds the failing regression and makes complete verification reject
  any 404. Focused registry/release tests, ESLint, and diff check are green.

- `2026-08-26 16:54 WEST`: Built-in Node local registry fixture replaced the
  temporary Verdaccio qualification path. Verdaccio 6.10.0 failed on the
  resolved `js-yaml` ESM export; vulnerable 6.2.2 was removed. The narrow pnpm
  override maps only `brace-expansion@5.0.8` from Lerna/Nx to patched `5.0.9`.
  Full and production audits report no known vulnerabilities. Remove the
  override when a future Lerna/Nx graph no longer selects `5.0.8`.

- `2026-08-26 16:34 WEST`: Affected re-review proved prior `--scope` publishing
  invalid for Lerna 10.0.1. It is superseded by a generated disposable non-Git
  workspace containing only strict-selected package manifests and `.publish`
  directories. Synthetic Verdaccio qualification published selected base then
  dependent; the omitted package was absent from Lerna discovery/publish output.

- Last completed step: Final registry completeness correction and focused
  verification; qualification, focused coverage, and focused mechanical checks
  are complete.
- Previous correction: Unsupported `--scope` mechanism superseded; no longer a
  workflow, runtime, test, or runbook claim.
- Next step: repeated cheap preflight, then the final `verify:release` rerun; no
  successful final release verification yet.
- Last prior focused step: Accepted specialist-review correction batch and focused
  GREEN.
- Known risks: Lerna resume is version-based rather than integrity-based;
  static manifest tags must be removed; public NPM must never be contacted for
  mutation during tests.
- Open questions: None.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                     | Owner       | Linked Task/Decision | Disposition                                  | Next Review Point    |
| ---------------------------------- | ----------- | -------------------- | -------------------------------------------- | -------------------- |
| Old custom engine cleanup          | Future task | D-0117 pending       | Deferred until one real Lerna release        | Post-release cleanup |
| `brace-expansion` override removal | Maintenance | T-0221               | Remove when Lerna/Nx no longer selects 5.0.8 | Dependency upgrade   |
| Nx postinstall denial review       | Maintenance | T-0221               | Keep denied while `useNx` remains false      | Lerna/Nx upgrade     |
