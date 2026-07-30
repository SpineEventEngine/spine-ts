# T-0080L: Remediate the to-do example

## Status

Accepted.

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

## Implementation Wave Completion

- L1 changes only six authored Proto files, adds exactly 34 leading comments,
  and preserves every non-comment token. Protected source checksums, formatting,
  and diff integrity pass; generation waits for L4 to remove exact stale ledger
  rows.
- L2 changes only `src/index.ts`, resolves 30 TSDoc rows, and moves private ID
  and entrypoint behavior to named owners while preserving established public
  callable exports. Generation/build, 33 black-box tests, exports, lint, format,
  and diff checks pass.
- L3 changes only smoke row source/script/test, resolves nine TSDoc and two
  standalone rows with one `SmokeTaskLists` owner, and preserves all bounds and
  session abort behavior. Build, 3 tests, real start+smoke, formatting, diff,
  and process cleanup pass.
- Only exact stale L rows remain for L4. No writer changed package/workspace/
  lock/manifests/config/entity-column/generated or another writer's ownership.
- Every writer was explicitly `gpt-5.6-terra` / medium. Runtime introspection
  was unavailable, with no visible mismatch.

## Complete Review Wave Assignments

- Style/maintainability: existing reviewer, explicitly
  `gpt-5.6-terra` / high, across private owners, preserved callables, smoke
  structure, naming, and exact scope.
- Documentation: existing immutable reviewer configured
  `gpt-5.6-luna` / medium, across 39 TSDoc rows and 34 Proto comments.
- TypeScript/API docs: existing reviewer, explicitly
  `gpt-5.6-terra` / high, across public exports, Proto/wire contracts, generated
  consumer compatibility, and package boundaries.
- Performance/reliability: existing reviewer, explicitly
  `gpt-5.6-terra` / high, across handler/state semantics, smoke bounds, IPC/
  multi-process behavior, subscriptions, and shutdown.
- All reviewers are read-only, inspect the three isolated endpoints as one
  complete wave, may not spawn, and must state runtime metadata or its
  limitation.

## Complete Review Wave Result

- Documentation is clean across all 34 Proto comments and 39 TSDoc rows.
- Style/maintainability is clean for private owners, preserved public callables,
  smoke cohesion, names, comment placement, and exact scope.
- TypeScript/API/Protobuf is clean: public exports/signatures and emitted
  declarations are preserved, all Proto non-comment tokens are identical, and
  generated/package boundaries remain unchanged.
- Performance/reliability is clean across handler/state/rejection behavior,
  server defaults/lifecycle, subscriptions, smoke bounds/redaction/session
  abort, IPC/multi-process shutdown, and runtime-neutral Proto changes.
- Reviewer runtime introspection was unavailable for configured Luna/medium and
  Terra/high profiles, with no visible mismatch.
- L1, L2, and L3 are accepted for scoped commit, immediate push, and integration
  into `task/T-0080L-todo`; L4 then owns exact ledgers and docs.

## L4 Reconciliation Dispatch

- Reviewed commits `a7eee4af`, `142fb167`, and `27812934` are merged into
  pushed integration commit `ddb6b05f`.
- One existing implementer, explicitly `gpt-5.6-terra` / medium, owns only
  `examples/todo/README.md`, `examples/todo/USER_GUIDE.md`, and the four exact
  T-0080L debt partitions.
- L4 regenerates exact ledgers, targets empty TSDoc/Proto/name arrays, and keeps
  only checker-valid declaration-specific necessities for deliberately
  preserved `createTodoContext`/`startTodoServer` standalone exports.
- Docs change only where final ownership syntax or command verification
  requires it; all accepted workflows and limitations stay intact.
- The implementer may not edit source/Proto/tests/package/generated/shared
  tooling, commit, push, build JVM, or spawn. Runtime metadata or its limitation
  is required.

## L4 Source Correction Dispatch

- L4 reaches empty TSDoc/Proto/name ledgers and two exact public-callable
  necessities, but correctly refuses to suppress three live TSDoc findings:
  `renameTask`, `reopenTask`, and `onTaskRenamed`.
- Their accurate summaries begin with verbs outside the deterministic checker
  allowlist. The original L2 existing implementer, explicitly Terra/medium,
  changes only those summaries to equally accurate checker-recognized
  third-person verbs and reruns scoped checks.
- L4 then reruns exact checkers. Documentation re-review reopens only for the
  three summaries; API/style/reliability remain closed absent contract or
  behavior change.

## Final Acceptance

- L4 records empty TSDoc, Proto-comment, and semantic-name partitions. The
  standalone partition contains only the two checker-valid necessities for the
  intentionally public `createTodoContext` and `startTodoServer` package
  boundaries.
- The three source-summary corrections are documentation-only. The reopened
  documentation lane reports clean, with immutable `gpt-5.6-luna` / medium
  configuration and unavailable runtime self-introspection.
- Final integrated verification passes example Proto quality, cleanup rules,
  scoped TSDoc, 40 protected Proto checksums, 49 frozen descriptors, generated
  cleanliness, clean generation, package build/prepack, all four focused test
  files and 56 tests, and diff integrity.
- No README or USER_GUIDE change is required because public ownership syntax,
  commands, package coordinates, workflows, and limitations did not change.
- T-0080L is accepted for commit, immediate push, umbrella integration, and
  post-integration verification.
