# T-0080M: Remediate the project-management example

## Status

Planned.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080H.
- May run in parallel with T-0080L/N.

## Objective

Bring the flat project-management example's authored TypeScript and Proto into
full documentation, naming, and behavior-ownership compliance.

## Classification

High-risk if an authored Proto/public example contract changes; otherwise
standard.

## Human-Imposed Requirements Ledger

- The example remains flat and uses
  `@spine-event-engine/example-project-management`.
- Authored Proto declarations/fields and exported TypeScript APIs have concise,
  complete documentation.
- Authored names have at most four semantic components.
- Standalone functions require cohesive ownership or exact necessity
  dispositions.
- Existing load/example behavior and end-user API guardrails remain intact.
- Copied Spine Proto and generated output are not hand-edited.
- No Spine JVM build.

## Ownership

- `examples/project-management` authored Proto/TypeScript, docs, tests, and
  quality partitions only.
- No shared root script/workspace/API-manifest edit.

## Acceptance Criteria

1. Owned authored Proto and TypeScript have zero comment/TSDoc/name debt.
2. Every remaining standalone function has one specific necessity disposition.
3. Proto renames preserve field numbers/wire types and update generated
   consumers through clean generation.
4. Existing command/entity/query/load behavior, Proto module composition, and
   package payload remain equivalent.
5. README commands/package coordinate remain accurate and end-user API scans
   remain clean.
6. Focused example tests pass.

## Exclusions

- No new example/framework feature or package move.
- No shared tooling/generation aggregation change.

## Verification And Review

- Clean package generation/build, full project-management tests/load smoke,
  docs commands/links, end-user API scan, TypeDoc/lint/format, checker
  partitions, generated cleanliness, and `git diff --check`.
- Style/maintainability, documentation, and TypeScript/API docs are relevant.
- Performance/reliability is relevant only if moved behavior affects load,
  query, resource, or lifecycle semantics.

## Planning Dispatch

- T-0080M planning runs read-only in parallel with T-0080L reconciliation.
- Because authored Proto/public contracts and load/query behavior are high-risk
  boundaries, the existing requirements splitter is explicitly assigned
  `gpt-5.6-sol` / high.
- The splitter may not edit or spawn and must inventory the exact 130 TSDoc,
  12 standalone-function, 117 Proto-comment, and zero semantic-name rows;
  freeze wire/package/generated/load/query/lifecycle invariants; and propose
  bounded non-overlapping ownership and exact gates.
- Both model and reasoning fields are explicit. Runtime metadata or its
  limitation is required.

## Accepted Bounded Plan

- Exact debt is 130 TSDoc rows, 12 standalone-function rows, 117 Proto-comment
  rows, and zero semantic-name rows. No rename is justified.
- M1 owns the command, entity, and event Proto files and adds 27 comments. M2
  owns `read_models.proto` and adds 90 comments. Neither changes a non-comment
  Proto token.
- M3 owns `src/index.ts`, resolves 108 TSDoc rows, and preserves the established
  public `createProjectManagementContext` and
  `startProjectManagementServer` callables while moving only private behavior
  behind cohesive owners.
- M4 owns `src/load-runner.ts`, resolves 22 TSDoc rows, preserves the exported
  `runProjectManagementLoad` boundary, and moves nine private helpers behind
  cohesive per-user-load and latency owners.
- M5 runs after integration and owns README plus the four exact M ledgers. It
  targets zero TSDoc/Proto/name debt and exactly three necessities for the
  deliberately public package boundaries.
- The Proto package, type URL, npm package, aggregate/projection/process-manager
  topology, repository count, load levels, per-user resource model, command
  acknowledgement, exact-ID query, correlated subscription, all-settled
  failure accounting, nearest-rank percentiles, zero-elapsed throughput,
  iterator cleanup, and server shutdown are frozen.
- M1-M4 use non-overlapping isolated ownership. Each implementation writer is
  an existing implementer, explicitly `gpt-5.6-terra` / medium, and may not
  spawn.
- The focused suite contains eight tests and includes one mandatory real
  10-user loopback load run.
- All four canonical review concerns apply. Security is N/A until release
  readiness.
- Splitter runtime self-introspection was unavailable for explicit
  `gpt-5.6-sol` / high, with no visible mismatch.

## Implementation Dispatch

- M1 owns only `commands.proto`, `entities.proto`, and `events.proto`; M2 owns
  only `read_models.proto`; M3 owns only `src/index.ts`.
- Each writer uses the existing implementer role, explicitly
  `gpt-5.6-terra` / medium. Both model and reasoning fields are explicit in
  every dispatch.
- Writers may not edit another track, shared tooling, package/workspace files,
  generated output, ledgers, or records; may not commit, push, build Spine JVM,
  or spawn subagents; and must report runtime metadata or its limitation.
- M1 and M2 add comments only and prove non-comment token identity. M3 resolves
  the 108 TSDoc rows without changing declaration kinds, public exports,
  topology, handlers, or behavior.
- M4 is dispatched after one implementation slot returns. M5 follows complete
  integration and review.

## M4 Implementation Dispatch

- After M2 returns, its existing implementer context is reassigned to M4 with
  explicit `gpt-5.6-terra` / medium configuration.
- M4 owns `src/load-runner.ts` and may adjust its load script/tests only where
  compatibility verification requires it. It resolves 22 TSDoc rows, preserves
  exported `runProjectManagementLoad`, and moves nine private helpers behind
  cohesive per-user-load and latency owners.
- Exact concurrency, correlation, timing, percentile, zero-elapsed,
  all-settled, cancellation, iterator, session, and server-shutdown behavior is
  frozen. No generic utility container or new public helper is allowed.
- The writer may not edit Proto, topology source, docs, ledgers, records,
  package/shared/generated files, commit, push, build Spine JVM, or spawn.
  Runtime metadata or its limitation is required.

## Implementation Wave Completion

- M1 adds exactly 27 comments to the three core Proto files. M2 adds exactly 90
  comments to `read_models.proto`. Both prove identical non-comment tokens,
  pass 40 protected checksums and diff integrity, and expose only their expected
  stale ledger rows.
- M3 resolves all 108 `src/index.ts` TSDoc rows without changing non-comment
  tokens, declarations, exports, topology, handlers, or behavior. Full build,
  ESLint, Prettier, and 3 topology tests pass.
- M4 resolves 22 load-runner TSDoc rows, retains only the exported standalone
  runner, and moves nine helpers into cohesive per-user and latency owners.
  Full build, ESLint, Prettier, 4 load-runner tests, zero live TSDoc findings,
  exactly nine stale necessities, and diff integrity pass.
- The clean integration baseline passes generation, full TypeScript build, all
  three focused files and eight tests, and the real 10-user loopback run with
  zero failed users and complete acknowledgement/query/subscription counts.
- Every writer was the existing implementer role, explicitly
  `gpt-5.6-terra` / medium. Runtime self-introspection was unavailable, with no
  visible mismatch.

## Complete Review Wave Assignments

- Style/maintainability uses the existing reviewer, explicitly
  `gpt-5.6-terra` / high, across helper ownership/cohesion, name limits, exact
  scope, and absence of generic utility dumping.
- Documentation uses the immutable existing reviewer configured
  `gpt-5.6-luna` / medium, across 117 Proto comments, 130 TSDoc rows, and
  eventual README accuracy requirements.
- TypeScript/API documentation uses the existing reviewer, explicitly
  `gpt-5.6-terra` / high, across exported declarations, emitted contracts,
  Proto/wire identity, and generated consumers.
- Performance/reliability uses the existing reviewer, explicitly
  `gpt-5.6-terra` / high, across concurrency, correlations, timing,
  zero-elapsed and percentile behavior, failure accounting, cancellation,
  iterator/session cleanup, and shutdown.
- Reviewers are read-only, inspect M1-M4 as one complete wave, may not spawn,
  and must report runtime metadata or its limitation. Security remains N/A
  because the slice changes no trust boundary.
