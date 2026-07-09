# T-0017e Third Review-Fix Report

Worker: `T-0017e-third-review-fix-sub-agent`
Date: `2026-07-09`
Status: `DONE`

## Scope

Addressed only the two remaining findings:

- Docs drift in `packages/server/README.md`, `docs/api/README.md`, and
  `docs/architecture/README.md`.
- Coordinated shutdown reliability for command work that produces events while
  `BoundedContext.close()` is already in progress.

`human-review-1-jul.md` was left untouched. No commit was made.

## Changes

- Updated public docs to state that `@Assign`, `@Command`, `@Subscribe`, and
  `@React` are bare-only public decorators.
- Clarified that schema-bearing handler metadata is generated/internal tooling
  and framework materialization state only, not a public decorator
  compatibility surface.
- Added package-owned runtime drain access and bus close-coordination hooks.
- Added a command-bus internal post path for framework-produced commands.
- Changed `BoundedContext.close()` to close public command/event intake first,
  then drain command and event bus work in a loop until cross-bus work counts
  stabilize, and only then finish bus/resource close.
- Added a regression proving accepted command work that commits an event during
  close still dispatches that event before shutdown resolves.

## Verification

- Red check before fix:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/repository/repository-routing.test.ts -t "dispatches events committed by accepted command work before close resolves"`
  failed because no produced event was dispatched.
- Green regression:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/repository/repository-routing.test.ts -t "dispatches events committed by accepted command work before close resolves"`
  passed; 1 test passed, 88 skipped.
- Focused shutdown sweep:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/runtime/runtime.test.ts packages/server/test/bus/event-bus.test.ts packages/server/test/context/bounded-context.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed; 4 files, 160 tests.
- `pnpm --config.verify-deps-before-run=false typecheck:build:generated`:
  passed with `tsc -b`.
- `pnpm --config.verify-deps-before-run=false docs:check`: passed; TypeDoc
  reported the existing invalid `origin` remote warning only.
- `pnpm --config.verify-deps-before-run=false format:check`: passed.
- `pnpm --config.verify-deps-before-run=false lint`: passed after local style
  cleanup, with proto generation, `tsc -b`, ESLint, and cleanup enforcement.
- `git diff --check`: passed.

## Result

`DONE`
