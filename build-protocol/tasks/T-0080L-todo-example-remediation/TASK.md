# T-0080L: Remediate the to-do example

## Status

Planned.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080H.
- May run in parallel with T-0080M/N.

## Objective

Bring the flat to-do example's authored TypeScript and Proto into full
documentation, naming, and behavior-ownership compliance without changing its
accepted black-box proof.

## Classification

High-risk if an authored Proto/public example contract changes; otherwise
standard.

## Human-Imposed Requirements Ledger

- The example remains flat and uses `@spine-event-engine/example-todo`.
- Every authored Proto declaration/field and exported TypeScript API is
  documented.
- Authored Proto/TypeScript names have at most four semantic components.
- Standalone functions require cohesive ownership or exact necessity
  dispositions.
- End-user API prohibitions and the existing user workflow remain intact.
- Copied Spine Proto and generated output are unchanged by hand.
- No Spine JVM build.

## Ownership

- `examples/todo` authored Proto/TypeScript, docs, tests, and quality
  partitions only.
- No shared root script/workspace/API-manifest edit.

## Acceptance Criteria

1. Authored Proto and TypeScript have zero comment/TSDoc/name debt.
2. Every remaining standalone function has a specific necessity disposition.
3. Proto renames preserve field numbers/wire types and update generated
   consumers from clean generation.
4. Server, command acknowledgement, delivery, query, subscription,
   validation/refusal, local multi-process, and shutdown acceptance remain
   green.
5. README/USER_GUIDE commands and package coordinate remain accurate.
6. End-user API prohibition scans remain clean.

## Exclusions

- No new example/framework feature or package move.
- No shared tooling/generation aggregation change.

## Verification And Review

- Clean package generation/build, full to-do focused suite including black-box
  and local multi-process acceptance, docs commands/links, end-user API scan,
  TypeDoc/lint/format, checker partitions, generated cleanliness, and
  `git diff --check`.
- Style/maintainability, documentation, and TypeScript/API docs are relevant.
- Performance/reliability is relevant for any moved server/IPC/subscription
  ownership; otherwise record N/A.

## Planning Dispatch

- T-0080L starts after pushed T-0080K commit `af192912`.
- Because authored Proto/public example contracts may change, the existing
  requirements splitter is explicitly assigned `gpt-5.6-sol` / high.
- The splitter is read-only, may not spawn, and must inventory the exact 39
  TSDoc, six standalone-function, 34 Proto-comment, and zero semantic-name rows;
  freeze copied/generated/wire/package/workflow invariants; propose bounded
  ownership and exact focused gates.
- Both model and reasoning fields are explicit. Runtime metadata or its honest
  limitation is required.

## Accepted Bounded Plan

- Exact debt is 39 TSDoc rows in two TypeScript files, six standalone-function
  rows, 34 Proto-comment rows in six authored files, and zero semantic-name
  rows. There is no copied Proto inside the to-do root and no rename is
  justified.
- L1 owns only the six authored Proto files and adds the 34 leading comments
  without changing declarations, imports, options, packages, filenames, field
  layouts, type URLs, or wire behavior.
- L2 owns only `src/index.ts`: 30 TSDoc rows, private task-ID/entrypoint
  ownership, and exact package-boundary dispositions for the established
  `createTodoContext`/`startTodoServer` callable exports.
- L3 owns smoke row source plus its script/test consumers: nine TSDoc and two
  standalone rows move to one cohesive bounded inspection/sanitization owner.
- L4 runs after integration and owns README, USER_GUIDE, and the four exact L
  ledgers. It targets empty TSDoc/Proto/name debt and only exact necessity
  dispositions for deliberately preserved root callables.
- L1-L3 use separate branches/worktrees with non-overlapping ownership. Every
  writer is an existing implementer, explicitly `gpt-5.6-terra` / medium, may
  not spawn, and preserves frozen wire/type-URL/package/export/registry,
  command/Projection/query/subscription/rejection, smoke bounds, IPC,
  multi-process, and shutdown behavior.
- Baseline generation/workspace build and four focused files/56 tests pass.
  Package/workspace/lock/manifests/config/generated output and
  `src/entity-columns.ts` remain frozen.
- All four canonical review concerns apply after the complete implementation
  wave. Security is N/A until release readiness.
- Splitter runtime self-introspection was unavailable for explicit Sol/high,
  with no visible mismatch.
