# Review Log: T-0015c Build-Time Handler Analyzer

Status: complete

Task log: `build-protocol/tasks/T-0015c-build-analyzer/TASK.md`
Branch: `task/T-0015c-build-analyzer`
Baseline commit: `4b802fc`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0015c-build-analyzer`

Required review lanes:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability;
- JVM alignment and ADR 0001 compliance.

## Human-Imposed Requirements Under Review

- Generated registry analysis is framework-owned build-time work.
- End-user apps must not supply `...Schema` decorators or materialize handlers.
- Analyzer rejects generated `@Apply` records.
- Analyzer feeds the existing T-0015b generated registry contract rather than a
  parallel runtime registry.
- No package generator, runtime discovery, to-do migration, or handler
  invocation in T-0015c.
- Generated output remains ignored and uncommitted.

## Implementation Snapshot

- `2026-07-07 20:44 WEST`: Implementation sub-agent completed the scoped
  analyzer in `packages/server/src/handler/build-time-handler-analyzer.ts` with
  focused tests in
  `packages/server/test/handler/build-time-handler-analyzer.test.ts`.
- Scope stayed within T-0015c: no generated registry file writing, no package
  generator, no runtime discovery, no to-do example migration, and no handler
  invocation changes.
- The analyzer is not exported from the package root in this slice, so API docs
  were not changed.

## Rounds

- Round 1 found documentation, TypeScript/API, security/reliability, JVM/ADR,
  and style issues in the initial analyzer implementation.
- `2026-07-07 21:00 WEST`: Implementation sub-agent applied round 1 fixes:
  source-of-truth docs now describe T-0015c as the analyzer slice and record
  `@React` as event-emitting or no-emission; analyzer supports `Array<T>`;
  decorated entity classes must be exported; alias walking is guarded; generated
  imports are verified against generated module exports and companion schema
  exports; `@Command` accepts event input; emitted schema roles are validated;
  and the unused `sawHandler` flow was removed.
- Round 2 found remaining documentation, generated schema value-export,
  entity export, role-compatibility documentation, rest tuple documentation, and
  syntax-diagnostic issues.
- `2026-07-07 21:12 WEST`: Implementation sub-agent applied round 2 fixes:
  `BUILD_PROTOCOL.md` and `TODO_EXAMPLE_SPEC.md` now match the corrected role
  matrix and implemented return shapes; `DEVELOPER_API.md` no longer documents
  rest tuple returns; generated schema companions and namespace state schemas
  must be runtime value exports; default-exported entity classes are rejected
  while `class Foo; export { Foo };` is accepted; malformed source files surface
  `TYPESCRIPT_SYNTAX_ERROR`; and `TECHNICAL_SPEC.md` documents the current
  command/event generated-module-name role limitation.
- `2026-07-07 21:16 WEST`: Round 3 returned clean documentation, TypeScript/API,
  security, performance/reliability, and JVM/ADR reviews. Style reported one P3
  unreachable subscriber emitted-schema branch; the main orchestrator removed
  the unreachable branch and diagnostic code for final cleanup.
- `2026-07-07 21:18 WEST`: Narrow final style re-review returned clean after
  the unreachable branch cleanup. All participating reviewer sub-agents were
  closed.
