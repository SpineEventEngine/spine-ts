# T-0085 Review Record

## Documentation — wave 1

- Reviewer: `/root/t0085_docs_review`.
- Existing role and expected profile: `documentation_reviewer`,
  `gpt-5.6-luna` / medium.
- Runtime metadata: unavailable; the immutable configured role/profile is the
  available evidence.
- P1 accepted: `verify:task` and `verify:release` were named but not executable.
- P1 accepted: present-tense single-pass `pnpm verify` wording contradicted the
  existing repeated build/test/generation chain.
- P2 accepted: the task record lacked explicit preflight dispositions and the
  selected verification profile.
- Resolution: promoted to standard; executable profiles, a single-pass release
  chain, and complete preflight/profile records were added. Scoped re-review is
  pending.

## Canonical dispositions

- Style/maintainability: CLEAN after scoped re-review by
  `/root/t0085_style_review`; immutable `style_maintainability_reviewer`,
  `gpt-5.6-terra` / high. Runtime metadata unavailable.
- Documentation: CLEAN after scoped re-review by `/root/t0085_docs_review`;
  immutable `documentation_reviewer`, `gpt-5.6-luna` / medium. Runtime metadata
  unavailable.
- TypeScript/API docs: N/A; no product API, declaration, Proto, or end-user API
  snippet changes.
- Performance/reliability: CLEAN after scoped re-review by
  `/root/t0085_reliability_review`; immutable
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high. Runtime metadata
  unavailable.

## Wave 2 findings and correction

- Documentation P1 accepted: aligned the task-profile contract with its
  machine-enforced focused test/coverage inputs and documented exact commands.
- Reliability P1 accepted: the task runner now requires explicit focused tests
  and a coverage choice, with changed-source includes for focused coverage.
- Reliability/style companion-generation finding accepted: every Buf path now
  resolves relative to the supplied repository root, including Todo companion
  generation.
- Style P2 accepted: common generated gates are composed once and reused by
  task and release profiles.
- Reliability P2 accepted: fake Buf launchers and PATH construction are
  cross-platform.
- Invocation correction: the runner accepts one conventional leading pnpm `--`
  separator; its strict validation remains unchanged.
- Documentation evidence P2 accepted: the task record now explicitly records
  command/link evidence and N/A audience dispositions for unchanged README,
  REFERENCE, package-name, example-path, and beginner-document surfaces.
- Style P2 accepted: no-coverage mode now rejects `--source` instead of silently
  discarding an invalid argument.
- Independent correction evidence: the complete `verify:task` command passed
  shared deterministic gates and 75 focused tests.
- Documentation contract, performance/reliability, and maintainability
  re-reviews are clean. Review is converged.
- Post-convergence `pnpm verify:release` passed: 3,235 tests and 90.04% branch
  coverage, with all release gates clean.

## Implementation supplied for review

- Existing `implementer` role was explicitly dispatched as `gpt-5.6-terra` /
  medium. Runtime self-metadata is unavailable; the immutable configured
  profile is the available evidence.
- Review surface: `package.json` and `scripts/package-metadata.test.mjs`.
  `scripts/check-api-docs.mjs` remains behaviorally unchanged; the duplicate
  TypeDoc invocation was removed by making `docs:check:generated` call its
  existing single-generation checker directly.
- Focused behavior test passed: `../../node_modules/.bin/vitest run
scripts/package-metadata.test.mjs` (9 tests). `git diff --check` passed.
- Review questions: verify that the delegated generated-output commands retain
  deterministic sequencing and non-zero failure propagation, and that using
  direct Buf lint after the generation preflight preserves the existing Proto
  quality gates without repeating source checksums.

## Confirmed correction batch

- Corrected P1: `proto:check-generated` staged a second generation. Profiles
  now call `proto:check-generated:current`, whose current-output mode preserves
  ignored, untracked, and path-safety policy for the outputs generated earlier
  in the same sequential profile without re-staging them. The standalone
  checker remains the independent freshness-comparison gate.
- Corrected P1: `check-api-docs.mjs` no longer overrides TypeDoc's configured
  `docs/api/reference` output. It supplies only a temporary JSON destination
  for API assertions.
- Focused correction tests passed (18 tests), as did changed-file formatting
  and `git diff --check`. Re-review remains pending for the existing applicable
  style, documentation, and performance/reliability concerns.
- End-to-end TypeDoc output generation was not available for this focused
  correction run because the fresh worktree is missing generated/build
  artifacts; a direct invocation stopped at 683 pre-existing resolution errors.
  The release profile supplies its required generation/build predecessors.

## Focused preflight finding resolved

- The stale Chat-registry fixture was not isolated after a real build installed
  local Buf: staging honored the caller's output root but selected and launched
  Buf from the source worktree. `stageGeneratedTargets()` now resolves and runs
  Buf from its supplied root, making the fixture deterministic without changing
  generated-cleanliness policy. The 18 focused tests pass.

## Accepted review batch applied

- P1 task-profile contract resolved: `verify:task` machine-enforces focused
  paths and an explicit coverage decision. Coverage requires changed sources
  and supplies scoped Vitest includes; `--no-tests` is reserved for
  documentation/record-only tasks.
- P1 composition resolved: common generated gates are centralized; release adds
  exactly one full coverage run and task execution adds a required focused run.
- P2 portability resolved: Todo companion Buf uses its supplied root; fixture
  fake launchers and PATH construction are cross-platform.
- Dispositions remain pending only for scoped re-review of the updated batch.
