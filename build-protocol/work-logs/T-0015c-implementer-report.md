# T-0015c Implementer Report

Status: DONE

## Summary

Implemented the scoped build-time handler analyzer in
`packages/server/src/handler/build-time-handler-analyzer.ts`.

The analyzer uses the TypeScript compiler API to inspect configured source
files and returns structured records for later generated registry rendering. It
does not write generated registry files, does not add runtime discovery, does
not migrate examples, and does not invoke handlers.

Supported behavior:

- Discovers bare `@Assign`, `@Command`, `@React`, and `@Subscribe` method
  decorators imported from `@spine-ts/server`, including named aliases and
  namespace imports.
- Rejects schema-bearing handler decorators and `@Apply`.
- Requires public instance string-named methods on entity classes with inferred
  state schema references.
- Infers state schema references from `Aggregate`, `Projection`, and
  `ProcessManager` base-class generics shaped like
  `extends Aggregate<Id, typeof TaskSchema, Version>`.
- Maps generated message type imports to schema references in the same generated
  module, for example `type TaskCreated` to `TaskCreatedSchema`.
- Supports singular returns, `Type[]`, `ReadonlyArray<Type>`, `readonly Type[]`,
  and readonly/regular tuple returns.
- Allows explicit `void` no-emission `@React` handlers.
- Requires command assignees and command reactors to emit at least one schema.
- Requires `@Subscribe` to return explicit `void` and emit none.
- Rejects framework `Event`/`Command` envelope returns.
- Emits deterministic diagnostics instead of throwing.

The analyzer is intentionally not exported from the package root in this slice,
so `@spine-ts/server` runtime imports do not acquire a `typescript` load path.

## Changed Files

- `build-protocol/reviews/T-0015c-build-analyzer.md`
- `build-protocol/tasks/T-0015c-build-analyzer/TASK.md`
- `build-protocol/work-logs/T-0015c.md`
- `build-protocol/work-logs/T-0015c-implementer-report.md`
- `packages/server/src/handler/build-time-handler-analyzer.ts`
- `packages/server/test/handler/build-time-handler-analyzer.test.ts`

## Verification

- `corepack pnpm vitest run packages/server/test/handler/build-time-handler-analyzer.test.ts`
  - Exit status: 0
  - Result: 1 test file passed, 3 tests passed.
- `corepack pnpm typecheck:build`
  - Exit status: 0
  - Result: proto generation completed and `tsc -b` passed.
- `corepack pnpm lint`
  - Exit status: 0
  - Result: typecheck, ESLint, and cleanup enforcement passed.
- `corepack pnpm format:check`
  - Exit status: 0
  - Result: all matched files use Prettier style.
- `git diff --check`
  - Exit status: 0
  - Result: no whitespace errors reported.

`corepack pnpm docs:check` was not run because no package-root public exports
or API documentation surfaces changed.

## Concerns

- Import-equals aliases and deeper shadowing rules are not implemented in the
  analyzer. Named import aliases and namespace imports are supported, which
  covers the practical app-source decorator patterns in this slice.
- `git diff --check` does not inspect untracked files, but the changed untracked
  Markdown and TypeScript files were covered by `corepack pnpm format:check`.

## Round 1 Fix Report

Status: DONE

Fixes applied after review round 1:

- Updated `build-protocol/TECHNICAL_SPEC.md`,
  `build-protocol/DEVELOPER_API.md`, and `build-protocol/DECISION_LOG.md` so
  source-of-truth docs state that T-0015c implements the build-time analyzer,
  while package generation, runtime discovery, and example migration remain
  later slices.
- Corrected durable handler role docs: `@Assign` emits events, `@Command` emits
  commands, `@React` emits events or nothing, and `@Subscribe` emits nothing.
- Added `Array<T>` return support alongside `T[]`, `readonly T[]`,
  `ReadonlyArray<T>`, and tuples.
- Required decorated entity classes to be exported so later generated registry
  source can import/reference `entityType`.
- Added guarded alias walking for state schema, signal, return, and framework
  envelope checks so cyclic aliases fail closed with deterministic diagnostics.
- Replaced generated message role/name heuristics with generated module source
  inspection for imported message exports and companion `NameSchema` exports.
- Allowed generated event inputs for `@Command` while preserving command-emitted
  return validation.
- Validated emitted return schema roles for `@Assign`, `@Command`, and `@React`.
- Removed the unused `sawHandler` flow and shortened cleanup-guarded helper
  names.

Additional changed files in round 1:

- `build-protocol/DECISION_LOG.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/TECHNICAL_SPEC.md`

Round 1 verification:

- `corepack pnpm vitest run packages/server/test/handler/build-time-handler-analyzer.test.ts`
  - Exit status: 0
  - Result: 1 test file passed, 7 tests passed.
- `corepack pnpm typecheck:build`
  - Exit status: 0
  - Result: proto generation completed and `tsc -b` passed.
- `corepack pnpm docs:check`
  - Exit status: 0
  - Result: TypeDoc/check-api-docs passed with the existing invalid-origin
    source-link warning and zero errors.
- `corepack pnpm lint`
  - Exit status: 0
  - Result: typecheck, ESLint, and cleanup enforcement passed.
- `corepack pnpm format:check`
  - Exit status: 0
  - Result: all matched files use Prettier style.
- `git diff --check`
  - Exit status: 0
  - Result: no whitespace errors reported.

Round 1 concerns:

- The analyzer still intentionally does not implement package-level generation,
  runtime discovery, example migration, or handler invocation.
- `.superpowers/sdd/review-T-0015c-staged.diff` is an unrelated untracked
  review artifact left untouched.

## Round 2 Fix Report

Status: DONE

Fixes applied after review round 2:

- Updated `build-protocol/BUILD_PROTOCOL.md` and
  `build-protocol/TODO_EXAMPLE_SPEC.md` to use the corrected role matrix:
  `@Assign` emits events, `@Command` emits commands, `@React` emits events or
  nothing, and `@Subscribe` emits nothing.
- Removed the unimplemented rest tuple form from `build-protocol/DEVELOPER_API.md`.
- Added a `TECHNICAL_SPEC.md` note that T-0015c verifies generated message and
  schema exports, recognizes command/event roles by generated command/event
  module names for now, and fails closed for neutral generated modules.
- Tightened generated module inspection so message exports may be type or value
  exports, but schema companions and namespace state schemas must be runtime
  value exports.
- Rejected `export default class Entity` for decorated entity classes and
  accepted named export lists such as `class Entity ...; export { Entity };`.
- Added TypeScript syntax diagnostics to `BuildHandlerAnalysis` with
  `TYPESCRIPT_SYNTAX_ERROR`, and skipped semantic handler analysis for malformed
  source files.

Additional changed files in round 2:

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/TODO_EXAMPLE_SPEC.md`

Round 2 verification:

- `corepack pnpm vitest run packages/server/test/handler/build-time-handler-analyzer.test.ts`
  - Exit status: 0
  - Result: 1 test file passed, 10 tests passed.
- `corepack pnpm typecheck:build`
  - Exit status: 0
  - Result: proto generation completed and `tsc -b` passed.
- `corepack pnpm docs:check`
  - Exit status: 0
  - Result: TypeDoc/check-api-docs passed with the existing invalid-origin
    source-link warning and zero errors.
- `corepack pnpm lint`
  - Exit status: 0
  - Result: typecheck, ESLint, and cleanup enforcement passed.
- `corepack pnpm format:check`
  - Exit status: 0
  - Result: all matched files use Prettier style.
- `git diff --check`
  - Exit status: 0
  - Result: no unstaged whitespace errors reported.
- `git diff --cached --check`
  - Exit status: 0
  - Result: no staged whitespace errors reported.

Round 2 concerns:

- The analyzer still intentionally does not implement package-level generation,
  runtime discovery, example migration, handler invocation, or descriptor-based
  command/event role inspection.
- Unrelated `.superpowers/sdd/` review artifacts remain untouched.
