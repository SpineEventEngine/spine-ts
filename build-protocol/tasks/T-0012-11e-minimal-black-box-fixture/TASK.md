# T-0012.11e: Minimal Black-Box Test Fixture

Status: opened
Branch: `task/T-0012-11e-minimal-black-box-fixture`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11e-minimal-black-box-fixture`
Baseline commit: `6b5dd07`

## Goal

Replace the testing-package skeleton with the smallest framework-owned
black-box fixture needed to write the example's bounded-context tests.

## Scope

- Expose a minimal typed OOP/generic fixture over built bounded contexts.
- Drive commands and inspect query/subscription outcomes through real framework
  seams needed by the to-do example.
- Keep the fixture in-process and narrow.
- Do not add multi-process orchestration, browser tooling, a broad client DSL,
  or speculative server lifecycle APIs.
- Update package README and API docs because this slice creates public testing
  package behavior.

## Expected Write Scope

- `packages/testing/**`
- `packages/server/test/**` only for shared helpers or fixture coverage
- `docs/**` only when API docs or user-guide text needs a public testing
  package note
- this task's durable logs and the parent `T-0012.11` logs

## Evidence To Inspect

- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/DEVELOPER_API.md`
- `packages/testing/README.md`
- `packages/testing/src/index.ts`
- `packages/testing/test/index.test.ts`
- `packages/server/src/context/bounded-context.ts`
- `packages/server/src/services/spine-services.ts`
- `packages/server/src/stand/stand.ts`
- relevant JVM docs under `spine-jvm-docs`, especially
  `spine-client-api-queries-subscriptions-and-tests.md`

## Acceptance Criteria

- `packages/testing` exposes one small typed fixture class or object that can be
  constructed from a built bounded context.
- The public testing API avoids exported standalone helper sprawl.
- Tests can use the fixture to post commands through the real command path and
  observe query/subscription outcomes required by the to-do example.
- Fixture tests include one cross-package smoke test against built framework
  context behavior.
- Package README and API docs describe the public testing surface.
- Required verification passes: focused fixture tests, `pnpm typecheck`,
  `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, `git diff --check`, and
  `pnpm test:coverage`.
