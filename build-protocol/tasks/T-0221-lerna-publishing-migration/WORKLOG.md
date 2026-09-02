# T-0221 Work Log

Task log: `build-protocol/tasks/T-0221-lerna-publishing-migration/TASK.md`
Branch: `automated-publishing-and-packaging-improvements`
Worktree: `.worktrees/automated-publishing-and-packaging-improvements`
Baseline commit: `af5c897857a85b3736a9efd7490d47faef41b4ac`
Authoring sub-agent: existing `implementer` role (`gpt-5.6-terra`, medium)
Implementation commits: `59e957f6b` through `399b323d0` (see TASK record)
Current implementation HEAD: `399b323d0`; local implementation and verification
complete, pending human review and authorized push

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

- `2026-08-27 14:12 WEST`: PR run `33074035381`, job `98523459762`, failed
  during `pnpm verify:release` with three simultaneous timeouts: the
  delivery-client child-process readiness fixture, the To-Do black-box import
  hook, and the real release-CLI tarball/consumer proof. Local timing shows the
  release-CLI proof takes about 14 seconds alone and all three affected files
  pass together in about 15 seconds on the faster development host. The shared
  cause is four Vitest workers competing with process-heavy tests that spawn
  additional Node, pnpm, and TypeScript processes. The bounded correction is
  assigned test-first to the existing implementer role with explicit
  `gpt-5.6-terra` medium reasoning. It owns only the release worker policy and
  its policy test; no push is authorized.

- `2026-08-27 14:15 WEST`: The implementer result passed the model-allocation
  acceptance gate using the immutable configured `gpt-5.6-terra` medium
  profile; runtime self-introspection was not exposed. TDD RED proved the old
  fixed `--maxWorkers=4` command violated the new adaptive-worker policy. The
  minimal GREEN uses Vitest's supported `--maxWorkers=50%`; 12 package-policy
  tests and all 62 originally affected tests passed. Independent orchestration
  reran those with the policy suite: 74 tests passed in about 15 seconds.

- `2026-08-27 14:24 WEST`: The affected reliability review, explicitly
  dispatched to the existing `gpt-5.6-terra` high profile, found no issue with
  the adaptive worker limit. Vitest supports percentage worker limits, clamps
  the computed value to at least one worker, and preserves the full test set,
  coverage, and timeouts. The complete `pnpm verify:release` gate then passed
  all static and generated checks, both dependency audits, all 18 tarballs and
  the external consumer, 287 test files, and 4,539 tests. The separate CI
  packaging command `node scripts/release-cli.mjs prepare --check` also passed.
  `.planning` was restored unchanged and remains untracked. No push or
  publication occurred.

- `2026-08-27 17:00 WEST`: A manual rerun of PR run `33077063201`, job
  `98569591217`, failed in `scripts/check-api-docs.test.mjs` after the preceding
  run passed. The test discarded the child process diagnostics and exposed
  only status 1. A systematic scan found that the release Vitest suite still
  mixed package builds, installs, shared-output writers, and child-process
  systems across two workers on the GitHub runner. Four concurrent API checker
  reproductions also produced two real TypeDoc failures: separate processes
  cleaned and wrote the same configured `docs/api/reference` directory. Direct
  checks take about 30 seconds locally, and the Vitest file redundantly ran
  TypeDoc twice even though the generated docs gate already invokes the
  canonical checker.

- `2026-08-27 17:05 WEST`: The correction used the existing implementer role
  with its explicitly configured `gpt-5.6-terra` medium profile. TDD RED proved
  that the release policy still allowed more than one worker and that JSON-only
  TypeDoc output still targeted the shared reference tree. GREEN serializes
  only `verify:release` with `--maxWorkers=1`, sends both TypeDoc JSON and HTML
  to one unique temporary directory, and removes duplicate TypeDoc/checker
  execution from Vitest while retaining the canonical SPI export validation in
  `check-api-docs.mjs`. Sixteen focused tests passed. Two simultaneous API
  checker processes both exited 0 and left `docs/api/reference` unchanged.
  Explicit `gpt-5.6-terra` high reliability and maintainability re-reviews were
  clean: every release test and coverage file remains selected, ordinary local
  tests remain parallel, and no meaningful API verification was removed. No
  push or publication occurred.

- `2026-08-27 17:20 WEST`: Post-convergence `pnpm verify:release` passed with
  the serialized release policy: all 287 files and 4,537 non-duplicate tests,
  all 18 tarballs, and the isolated external consumer completed in the Vitest
  phase without contention. Coverage remained unchanged at 93.28% statements,
  90% branches, 92.81% functions, and 94.44% lines. Both dependency audits
  reported no vulnerabilities. The separate CI command
  `node scripts/release-cli.mjs prepare --check` also passed. The two removed
  test cases were duplicate full TypeDoc/checker executions; their API/SPI
  assertions remain in the canonical checker that passed earlier in the same
  release gate. No push or publication occurred.

- `2026-08-26 18:12 WEST`: Human requested a fresh review of the complete branch
  diff against baseline `af5c897857a85b3736a9efd7490d47faef41b4ac` and fixes
  for all findings. Two independent read-only axes were assigned in parallel:
  standards to the existing style/maintainability reviewer with explicit
  `gpt-5.6-terra` high, and specification/correctness to the existing
  performance/reliability reviewer with explicit `gpt-5.6-terra` high. The
  Desktop surface exposes immutable configured roles/profiles when runtime
  self-introspection is unavailable. Neither reviewer may edit or spawn agents.

- `2026-08-26 18:22 WEST`: Both fresh review results passed the model-allocation
  acceptance gate. The standards result came from the immutable configured
  style/maintainability role (`gpt-5.6-terra`, high), and the specification
  result came from the immutable configured performance/reliability role
  (`gpt-5.6-terra`, high); the surface exposed configured profiles rather than
  runtime self-introspection. Accepted findings are stale completion/decision
  records and missing negative proofs for selected-tag completeness and
  non-mutating registry reads. Orchestrator inspection also confirmed that a
  partial release with an existing version but a wrong/missing selected tag is
  currently accepted, so that fail-closed defect joins the single correction
  batch.

- `2026-08-26 18:25 WEST`: Focused correction checks and specification
  re-review are green. Maintainability re-review confirmed the stale records
  were corrected but found that the prior full-release result must not be
  presented as covering the revised registry tree. The task now records that
  distinction; one post-convergence `verify:release` rerun is pending. The
  correction owner was the existing implementer role, explicitly dispatched
  with `gpt-5.6-terra` medium; the returned work matched that immutable
  configured profile, while runtime self-introspection was not exposed.

- `2026-08-26 18:39 WEST`: Post-convergence `pnpm verify:release` passed on the
  corrected registry tree: 287 test files, 4,539 tests, all 18 tarballs, the
  isolated external-consumer proof, and 93.28% statement, 90% branch, 92.81%
  function, and 94.44% line coverage. Both dependency audits reported no known
  vulnerabilities. The first attempt stopped only because the release-readiness
  scanner included the preserved untracked `.planning/` notes; they were moved
  outside the checkout for the successful rerun and restored unchanged.

- `2026-08-26 18:00 WEST`: Final `pnpm verify:release` rerun passed all gates:
  287 test files and 4,538 tests with 93.28% statement, 90% branch, 92.81%
  function, and 94.44% line coverage. Full and production audits reported no
  vulnerabilities. All 18 package tarballs and the external consumer proof
  passed. `.planning` was restored untracked. No push or publication occurred.

- `2026-08-26 17:52 WEST`: The required post-correction cheap preflight is
  green: all shared gates, the external 18-tarball consumer, and 48 focused
  release tests passed with 94.25% statement coverage. The slow isolated-checkout
  correction proof remains separately green at 110 tests with a 30-second bound.

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

- `2026-08-28 11:28 WEST`: A new live advisory made unchanged PR verification
  fail after the previous local gate passed. TDD now pins Lerna's transitive
  `pacote` to patched `21.5.1`, keeps `pnpm audit:release` as a live security
  command, removes it from deterministic `verify:release`, and assigns it to a
  daily/manual non-PR Security workflow. Twenty-four focused
  policy/Lerna tests, both audits, Lerna discovery, and exact release
  preparation passed.
- `2026-08-28 11:28 WEST`: Affected review dispatched to the existing
  performance/reliability reviewer and final security reviewer. Both use their
  immutable configured `gpt-5.6-terra` high profiles; model and reasoning are
  explicit in the configured roles. Documentation/API review is N/A because no
  reader or public TypeScript contract changed. Style review is N/A because the
  implementation is declarative workflow/dependency configuration with exact
  deterministic policy tests.
- `2026-08-28 11:52 WEST`: Reliability and security re-review accepted the
  three-command split: deterministic `verify:release` for PR Build, live
  `audit:release` for scheduled/manual Security, and fail-closed
  `verify:publish` for publication. The first post-convergence full gate then
  exposed the To-Do launcher test's fixed two-second readiness assumption; the
  child needed about 3.1--3.3 seconds locally. The existing failing test is the
  RED evidence. It now waits on the actual readiness marker with a bounded
  ten-second `vi.waitFor`; two focused runs pass. Affected reliability re-review
  and the final full gate are pending.
- `2026-08-28 11:55 WEST`: Reliability re-review found that a readiness timeout
  could skip awaiting the detached launcher. The consolidated correction puts
  release-file creation and `await pending` in `finally`, so success and timeout
  paths both clean the owned process group before returning. The focused verbose
  suite passes all four launcher cases; affected re-review is pending.
- `2026-08-28 12:12 WEST`: Affected reliability re-review and final security
  re-review are clean. Post-convergence `CI=true pnpm verify:release` passed 287
  test files and 4,539 tests, all static gates, all 18 tarballs, and the isolated
  external-consumer proof with 93.28% statement coverage. The exact automation
  follow-ups also pass: `pnpm audit:release` reports no known full-graph or
  production vulnerabilities, and the release preparation check validates and
  installs the 18 tarballs without publishing.
- Last completed step: Post-convergence `pnpm verify:release` passed the
  corrected registry tree with 287 test files, 4,539 tests, all 18 tarballs,
  and the isolated external-consumer proof.
- Previous correction: Unsupported `--scope` mechanism superseded; no longer a
  workflow, runtime, test, or runbook claim.
- Next step: commit and perform the already authorized push to the existing
  SpineEventEngine feature branch, then observe its PR check.
- Last prior focused step: Accepted specialist-review correction batch and focused
  GREEN.
- Known risks: Lerna resume is version-based rather than integrity-based;
  static manifest tags must be removed; public NPM must never be contacted for
  mutation during tests.
- Open questions: None.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                     | Owner       | Linked Task/Decision | Disposition                                  | Next Review Point    |
| ---------------------------------- | ----------- | -------------------- | -------------------------------------------- | -------------------- |
| Old custom engine cleanup          | Future task | D-0117               | Deferred until one real Lerna release        | Post-release cleanup |
| `brace-expansion` override removal | Maintenance | T-0221               | Remove when Lerna/Nx no longer selects 5.0.8 | Dependency upgrade   |
| Nx postinstall denial review       | Maintenance | T-0221               | Keep denied while `useNx` remains false      | Lerna/Nx upgrade     |
