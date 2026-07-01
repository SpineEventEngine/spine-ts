# Review Log: T-0012.1 Cleanup Enforcement Baseline

Task log:
`build-protocol/tasks/T-0012-1-cleanup-enforcement-baseline/TASK.md`
Branch: `task/T-0012-1-cleanup-enforcement-baseline`
Baseline commit: `a65ac4d`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-1-cleanup-enforcement-baseline`
Status: Implementation verified; commit pending.

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
