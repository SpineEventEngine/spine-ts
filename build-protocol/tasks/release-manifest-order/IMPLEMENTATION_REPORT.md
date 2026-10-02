# Implementation report: prepared release validation

## Scope and cause

The Publish run failed in `loadPrepared()` before npm publication. Release
entries carry internal dependencies as arrays of package names, while
`dependencyFirstOrder()` reads package.json dependency maps. Passing release
entries directly to that function sorted by name without traversing their
edges, so a correctly prepared workspace manifest was rejected.

The correction converts each saved dependency array into the map shape at the
`assertReleaseOrder()` call. The existing checks for inventory, checksums,
source commit, dependency contract, and ordering remain in place. Preparation
now saves its manifest and calls `loadPrepared()` before success for persistent
output and `prepare --check`; `--check` removes the temporary directory after
validation. The existing Build pull-request workflow runs `prepare --check`,
so that workflow exercises the saved archive handoff without publishing.

## Red and green evidence

1. Added a regression built from `readReleaseManifests()` and
   `expectedReleaseModel()` over the actual workspace graph. It asserts that
   the graph has an internal dependency edge, creates a release manifest, and
   validates it.
2. `pnpm exec vitest run scripts/release-artifacts.test.mjs -t 'actual workspace dependency graph'`
   stopped before Vitest with `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` because pnpm
   detected workspace changes since installation. No install or network write
   was performed.
3. `node_modules/.bin/vitest run scripts/release-artifacts.test.mjs -t 'actual workspace dependency graph'`
   was red: 1 failed, 13 skipped; validation threw `Release manifest is not
dependency ordered`.
4. After converting the array edges to maps,
   `node_modules/.bin/vitest run scripts/release-artifacts.test.mjs` was green:
   14 passed. Its existing tamper cases still reject wrong order, altered
   dependency contracts, unknown dependencies, bad checksums, and inventory.
5. Added preparation tests requiring the `pack`, `prove`, `persist`, `load`
   sequence and a saved `--check` manifest. Before the handoff change,
   `node_modules/.bin/vitest run scripts/release-cli.test.mjs -t 'persists one manifest|reopens a saved check archive'`
   was red: both selected tests failed because `load` was not called; the
   `--check` path also skipped persistence.
6. After preparation invoked `loadPrepared()` following persistence, the
   focused test command passed. A further test confirms the default loader
   rejects an incomplete saved release and cleans up the output before any
   publication step.

## Final focused verification

- `node_modules/.bin/vitest run scripts/release-artifacts.test.mjs scripts/release-cli.test.mjs scripts/release-workflows.test.mjs`
  passed: 3 files, 31 tests. The workflow test confirms regular pull requests
  run `node scripts/release-cli.mjs prepare --check`.
- `node_modules/.bin/prettier --check scripts/release-artifacts.mjs scripts/release-artifacts.test.mjs scripts/release-cli.mjs scripts/release-cli.test.mjs`
  passed after formatting two test files.
- `node --check scripts/release-artifacts.mjs && node --check scripts/release-cli.mjs && git diff --check`
  passed.

I did not run the full release suite, execute artifact packing, publish, or make
network writes. The regular pull-request workflow will run the full saved
archive handoff with actual packed artifacts. The shared worktree contains
concurrent version and fixture edits by main; these were preserved.

## Changed files

- `scripts/release-artifacts.mjs`: adapt saved dependency arrays for graph
  ordering.
- `scripts/release-artifacts.test.mjs`: actual workspace graph regression.
- `scripts/release-cli.mjs`: validate saved preparation output through
  `loadPrepared()` in both preparation modes.
- `scripts/release-cli.test.mjs`: preparation handoff and cleanup regressions.
- `build-protocol/tasks/release-manifest-order/IMPLEMENTATION_REPORT.md`: this
  record.

The assignment specified the existing implementer role with configured
`gpt-6-sol` and `medium` reasoning. The execution surface did not expose
runtime model/reasoning self-introspection to this implementer; the configured
dispatch is the available profile evidence.
