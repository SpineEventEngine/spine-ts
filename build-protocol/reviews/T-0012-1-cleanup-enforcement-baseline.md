# Review Log: T-0012.1 Cleanup Enforcement Baseline

Task log:
`build-protocol/tasks/T-0012-1-cleanup-enforcement-baseline/TASK.md`
Branch: `task/T-0012-1-cleanup-enforcement-baseline`
Baseline commit: `a65ac4d`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-1-cleanup-enforcement-baseline`
Status: Round 1 follow-up verified; ready for re-review
Reviewed commit/diff basis: `147d496..8349abc`
Review package: `.superpowers/sdd/review-147d496..8349abc.diff`

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Current Notes

Reviewers must enforce `D-0047`, `CODE_QUALITY.md`, and the reset constraints:

- no tracked generated output under package `src`;
- tests outside package `src`;
- generated output ignored and regenerated;
- new automated checks cover the forbidden old patterns;
- no new framework behavior is introduced;
- any public API/path changes are documented.

Implementation note: generated Protobuf-ES output is now regenerated under
ignored `packages/proto/generated`; package tests moved under
`packages/<package>/test`; `pnpm lint` runs the cleanup checker. The checker
allows explicitly listed inherited pre-reset long semantic names so this
enforcement task does not redesign runtime APIs outside scope, but it rejects
new long semantic names.

## Round 1 Review

Reviewer lanes:

- Code style/maintainability: comments remain. Important findings: inherited
  long-name exceptions are name-only and allow new debt; callback parameter
  detection misses inline function callbacks such as `done: () => void`; the
  checker does not enforce the flat `src` growth guardrail. Minor finding:
  line-length enforcement excludes package tests.
- Documentation: comments remain. Important findings: public docs do not
  explain `packages/*/test` or cleanup checks through `pnpm lint`/`pnpm
verify`; older decision history still says generated output lives under
  `packages/proto/src/generated`. Minor findings: stale review-log pointer and
  task/report/work-log statuses.
- TypeScript/API docs: comments remain. Important finding:
  `@spine-ts/proto/generated/*` supports extensionless generated imports but
  not natural `.js` ESM subpath imports after build.
- Security: comments remain. Important finding: generated cleanliness does not
  prove ignored output is freshly regenerated and does not reject symlinked
  generated directories.
- Performance/reliability: comments remain. Critical finding: `pnpm verify`
  typechecks before generating ignored Protobuf-ES output, so a fresh clone can
  fail before generation. Important finding: generated cleanliness allows stale
  or orphaned ignored files. Minor finding: line-length enforcement excludes
  package tests.

All Round 1 reviewer agents are closed. Author follow-up must address the
Critical/Important findings before re-review; the line-length test coverage
minor should be fixed in the same batch if it stays small.

## Round 1 Author Follow-up

Follow-up fixes are authored for all Round 1 findings:

- Fresh-clone reliability: generation now runs before build/typecheck/docs
  consumers, with focused package-metadata regression coverage.
- Generated cleanliness: generation cleans the output directory, rejects
  symlinked generated output, and `proto:check-generated` compares against a
  clean generation to catch stale and orphaned files.
- Cleanup enforcement: inherited long-name exceptions are anchored to exact
  current occurrences, inline function callback parameters are checked, flat
  package `src` growth is guarded, and package tests are included in line-length
  enforcement.
- Documentation/API: public docs cover package tests and cleanup gates, stale
  D-0023 generated-path history is explicitly superseded by D-0047, task/log
  statuses and the review-log path are refreshed, and generated `.js` ESM
  subpath imports are exported.

Focused RED/GREEN evidence is recorded in
`build-protocol/tasks/T-0012-1-cleanup-enforcement-baseline/IMPLEMENTATION_REPORT.md`.
Final required verification passed after escalation for the known ZeroMQ local
IPC sandbox restriction.
