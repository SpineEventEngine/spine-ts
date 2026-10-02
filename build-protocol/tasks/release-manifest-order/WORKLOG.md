# Work log

- 2026-10-01: Read supplied publishing logs. Preparation passed; publishing
  failed in `assertReleaseOrder()` before any npm invocation.
- Updated local master from origin and created `fix-release-manifest-order`
  from merge commit `230985421fe33a264c58a5e2d5a935faf791c741` in the existing
  clean worktree. No new chat or worktree was created.
- Investigation: release entries store dependencies as arrays, whereas
  `dependencyFirstOrder()` accepts package.json dependency maps. Confirm with
  a failing regression before changing production code.
- Skills: systematic debugging and test-driven development for reproduction;
  subagent-driven development for bounded implementation; worktree skill for
  reusing the existing isolated checkout; verification-before-completion for
  final evidence. Project protocol overrides generic skill commit/review rules.
- Native child dispatch reached the surface thread limit. Dispatched the
  existing implementer function through the bundled Desktop CLI with explicit
  `gpt-6-sol`, `medium`, Standard speed, memories disabled, and child delegation
  disabled. Session: `01a0f8a5-beee-7b50-8adf-02d466054306`; the CLI exposes the
  configured dispatch, not independent runtime model introspection.
- npm exact-version reads returned 404 for snapshot.20 for all 19 public
  packages. All 31 workspace manifests advance to `2.0.0-snapshot.20`.
- Version-only commit `1c41f4bc7` was pushed immediately to origin. Internal
  dependency pins, lockfile specifiers, generated-source manifests, and current
  version-sensitive fixtures are aligned separately.
- Skill discovery used the session catalog, expected-skill manifest, bounded
  `rg --files /Users/armiol/.agents/skills -g SKILL.md`, and the installed
  `.skill-lock.json` entries. Review uses requesting-code-review. General
  debugging-strategies is redundant with the selected systematic-debugging
  skill; no new library selection or server/JVM investigation is required.
- Implementation reproduced the exact CI error using the real workspace
  dependency graph, then passed 31 focused tests after correction. Preparation
  now writes and reloads the saved manifest in both modes. Existing PR
  `prepare --check` therefore reaches the publishing loader.
- Frozen install, tooling typecheck, targeted ESLint, cleanup/TSDoc/audience
  checks, and both dependency audits passed. No known vulnerabilities found.
- Main aligned remaining version-sensitive script fixtures after implementation
  handoff and clarified the existing release runbook. Full release and actual
  archive preparation remain pending after the three requested review rounds.
- Broader focused testing caught a version-sensitive rollback fixture: after
  advancing the tested release to snapshot.20, its newer tag also had to move
  from snapshot.20 to snapshot.21. Corrected that deterministic fixture.
- Fix and aligned references committed and pushed as `c5d2196b7`. All 117
  focused tests pass. `node scripts/release-cli.mjs prepare --check` passed
  with Node 24.18.0 and npm 11.16.0: packed all 19 archives, installed/typechecked/
  ran a fresh consumer, then validated the saved release using the real loader.
  No package was published. Review round 1 returned no findings.
- Three independent technical review rounds completed sequentially, without
  memory or inherited chat history; all returned no findings. The separate
  Luna/medium documentation review also returned no findings.
- Final preflight passed: repository formatting, tooling typecheck, cleanup,
  TSDoc, audience checks and diff check. Changed script branches are exercised
  by the real graph regression, prepare/load tests, default-loader rejection,
  and actual archive preparation. Scripts are outside the repository runtime
  coverage denominator; the release profile will verify global runtime limits.
- Final mechanical verification assignment: orchestrator-dispatched function,
  explicit `gpt-6-luna` / `low`, Standard speed, no memory/delegation. Run
  `pnpm verify:release` once, using its existing single-worker configuration.
  Do not publish, mutate source, or retry a failing full suite.

## Final verification and handoff

- Mechanical verification session `01a0f8b1-988f-7f60-bef4-bec5433fd526` used the
  explicitly configured Luna/low profile and exited. Runtime model
  self-introspection was not exposed; dispatch flags match the assignment.
- `pnpm verify:release` passed once, exit 0: 308 test files and 5,168 tests
  passed; one file/test skipped. The skipped test is the existing opt-in
  `SPINE_ENTITY_DELIVERY_BENCH` measurement, not a release regression.
  External-provider suites remain outside this standard profile; no storage
  implementation changed in this task.
- Coverage: statements 93.27%, branches 90.04%, functions 93.09%, lines 94.47%.
  Vitest elapsed time 608.62 seconds; complete gate approximately 12.5 minutes.
- `node --test scripts/npm-rekor-recovery.repro.mjs` passed with pinned Node
  24.18.0/npm 11.16.0 against its local test server. It made no real publication.
- After the full gate, `node scripts/release-cli.mjs preflight` passed against
  the public registry. `node scripts/release-cli.mjs prepare --check` passed
  again using freshly rebuilt output: all 19 archives, fresh consumer install,
  consumer typecheck/runtime, saved manifest and archive validation.
- Full evidence is in `/tmp/release-manifest-full.log`; final archive evidence
  is in `/tmp/release-manifest-final-prepare.log`. The durable results are above.
- Production code at `c5d2196b7` is unchanged after the three reviews and full
  verification. Final edits only record task/review evidence, with formatting
  and diff checks before their immediate push.
- GitHub reports no open PR for `fix-release-manifest-order`. Build triggers
  only for pull requests, so remote CI is pending a human-created PR. No code
  was committed to master, no workflow was rerun, and no package was published.
- Implementation, three reviews, local release verification, version alignment,
  and branch synchronization are complete. Remaining step: open a PR and check
  its final-SHA CI before merging. No unresolved code findings or questions.

## 2026-10-02: Extend PR checks to the full local publication flow

The user expanded this same unmerged task: regular CI must run all publication
procedures except real publication-service calls. Fresh fetch confirms master
unchanged. Requirements, comparison, plan and assignments are in `CI_PARITY.md`;
the standing requirement is also recorded in `BUILD_PROTOCOL.md`.

Resumed the existing implementer session `01a0f8a5-beee-7b50-8adf-02d466054306`
with explicit Sol/medium, Standard speed, memories and delegation disabled.
Only that context changes workflows, release scripts/tests and release docs.
Main manages task/protocol records. No additional version bump is needed for
this continuation; snapshot.20 remains this branch's intended release.

PR #15 now exists and is attached to this chat. The implementer confirmed that
the previous high-level registry/invoke test substitutions bypass HTTP parsing
and npm argument/config construction. New substitutions belong at fetch and
subprocess I/O instead. One expected-red subprocess test reached real npm with
a missing local archive (no publication); acceptance additionally requires
guards that reject real I/O even if injection is accidentally ignored.

Local persistent preparation passed for all 19 actual archives at
`/tmp/spine-ci-release-check-20261002`; it includes fresh consumer installation,
typechecking/runtime proof and the saved manifest/archive loader. Main will
run the trial against that directory after subprocess fallback is blocked.
Initial changed-file formatting found only the new plan table; fixed with
Prettier. The expensive release gate will run once in PR CI after review,
not both locally and remotely.

Before independent review, return these concrete draft findings to the same
implementer: add an independent real-process guard (HTTP already guarded),
preserve the existing PR `verify` check name, save trial reports under a
distinct always-uploaded artifact, reject missing CLI option names, and avoid
overwriting the simulated selected tag for stable releases. These corrections
do not change actual publication policy or add a production fake mode.

Independent review assignments for the expanded changeset, after cheap
preflight, all fresh sessions with memory and delegation disabled:

1. Existing performance/reliability reviewer, explicit Sol/medium: actual
   release entrypoints, saved archive transfer, I/O isolation, report recovery,
   failure handling, and focused tests. Fix accepted findings before round 2.
2. Existing style/maintainability reviewer, explicit Sol/medium, with the
   existing documentation reviewer on Luna/medium in parallel. Review current
   code and public claims against the full human ledger; collect both results
   before corrections. TypeScript/public API concern is N/A: no framework
   declarations, package APIs, Protobuf or application examples changed.
3. Existing performance/reliability reviewer, explicit Sol/medium, plus final
   security reviewer, explicit Sol/high, on isolated publication-service I/O
   and real publishing defaults. Collect both before the final correction batch.

Each dispatch must explicitly set its model and reasoning, Standard speed,
and no inherited conversation. The bundled Desktop CLI provides these
profiles; actual runtime introspection is unavailable, so configured flags
and session IDs are recorded. Full release verification and the fresh-job
trial then run in PR #15 for the exact pushed commit. No real publication is
part of this task.

### Expanded implementation and review evidence

- The same implementer completed the correction batch. Real I/O fallback is
  blocked independently of injection, `verify` keeps its check name, trial
  reports have a separate artifact, missing CLI paths fail clearly, selected
  tags are preserved correctly, and trial publication order is checked.
- Main reran the six focused release test files: 79 tests passed. Tooling
  typecheck, scoped ESLint, cleanup, TSDoc, documentation audience, formatting,
  and diff checks passed. The guarded CLI trial passed against all 19 real
  archives, including a saved partial report and successful recovery. The
  implementation report gives exact commands and output locations.
- Round 1: fresh session `01a0fbb4-50f6-7a50-b580-f1d4beefd24d`, explicit
  Sol/medium performance/reliability profile. No P0/P1/P2 findings. Reviewed
  complete branch release code plus the uncommitted CI extension and ledger.
  No corrections required before round 2. CLI profile flags match assignment;
  separate runtime model introspection was not exposed.
- Round 2: fresh style session `01a0fbb6-e00e-71f2-b4f2-bc3cdcac0ab7`
  used explicit Sol/medium; independent documentation session
  `01a0fbb6-e496-71a3-aac6-f6e236e32b24` used explicit Luna/medium. Both
  reported no P0/P1/P2 findings. Accepted the style review's P3 suggestion to
  strengthen the existing subprocess test with working-directory and removed
  token-variable assertions; returned this small batch to the same implementer
  before round 3. Real publication behavior remains unchanged.
- The round-2 assertion correction passed; main reran all 79 focused tests
  and scoped lint successfully. The local npm/Rekor loopback fixture also
  passed without external publication-service traffic.
- Round 3: fresh reliability session `01a0fbbb-99db-7b20-854c-3f00fa9647c1`
  used explicit Sol/medium, and final security session
  `01a0fbbb-9e61-73b1-8919-27818c47b4f6` used explicit Sol/high. Both
  returned no P0/P1/P2 findings. Runtime profiles were explicitly dispatched;
  no contrary runtime metadata was exposed. All review sessions have exited.
  The security advisory notes that a future change from the current guarded
  `spawnSync` publishing call to another process primitive must update its
  guard/test; no such alternative publication call exists in this changeset.
  External service availability remains intentionally outside offline proof.
- Review dispositions: style clean (advisory test improvement incorporated),
  documentation clean, reliability clean, final security clean; TypeScript/API
  concern N/A for unchanged public framework declarations and contracts.
- Ready to push the CI extension on the existing snapshot.20 branch. Required
  full release verification and fresh-runner trial are pending PR #15 for
  the pushed commit; local focused evidence is not substituted for that result.
  Do not add a follow-up commit solely to record this commit's SHA: Git history
  and the PR's exact-head checks provide that evidence.
