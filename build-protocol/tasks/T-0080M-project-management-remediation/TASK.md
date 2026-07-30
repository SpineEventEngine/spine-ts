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

## Complete Review Wave Result

- Documentation reports one README command/claim mismatch and semantic
  overclaims in placeholder projection/read-model and process-manager
  summaries. Core Proto and load-runner documentation are otherwise clean.
- Style/maintainability confirms the semantic overclaims and reports the
  73-line `ProjectManagementUserLoad.execute()` above the repository's 35-line
  target.
- TypeScript/API/Proto confirms identical normalized Proto tokens, exports,
  declaration kinds, package/generated paths, the 3/20/10/33 topology, and the
  public runner boundary. Its only finding is the same documentation
  overclaim.
- Performance/reliability accepts all-settled execution, user isolation,
  correlation, timing, zero-elapsed behavior, bounded cleanup ordering, and
  load-script shutdown. It requests a direct non-empty varied nearest-rank
  percentile test.
- Reviewer profiles were immutable Luna/medium for documentation and explicit
  Terra/high for style, API/Proto, and reliability. Runtime self-introspection
  was unavailable, with no mismatch.

## Consolidated Correction Batch

- M2 revises only affected `read_models.proto` summaries to describe the actual
  fixed-topology ID/name state or generic update counters, without changing
  non-comment tokens.
- M3 mirrors those accurate placeholder semantics in `src/index.ts` TSDoc only,
  preserving all non-comment tokens and public/behavioral contracts.
- M4 splits `execute()` into cohesive private lifecycle steps below the
  35-line method target and adds one focused varied-value nearest-rank test
  without exposing private helpers or changing behavior.
- M5 corrects the README command/claim and all accepted timing/limitation
  wording while closing exact ledgers after integration.
- Only documentation/style/reliability concerns affected by the corrections
  reopen. API/Proto needs confirmation only that Proto non-comment tokens and
  exported contracts remain unchanged.

## Correction Completion And Re-review

- M2 revises all 20 projection and 10 process-manager Proto summaries to
  describe only fixed-topology ID/name rows or generic handled-event update
  counters. The normalized non-comment hash remains identical; 40 protected
  checksums and diff integrity pass.
- M3 mirrors those factual semantics in TSDoc. All non-comment tokens remain
  identical; zero live TSDoc findings, project build, ESLint, Prettier, three
  topology tests, and diff integrity pass.
- M4 reduces `execute()` to a short lifecycle orchestrator with cohesive
  subscription, command, query, correlation, and cleanup steps. A fifth
  load-runner test exercises ten varied acknowledgement samples through the
  public runner without exporting private latency machinery.
- M4 project build, ESLint, Prettier, all five tests, zero live TSDoc findings,
  exactly nine stale necessities, and diff integrity pass. Cleanup still aborts
  controller and session before bounded iterator return.
- Focused re-review reopens documentation for M2/M3 and eventual README, style
  for M4 method cohesion, reliability for the percentile test and lifecycle,
  and API/Proto only to confirm unchanged tokens/exports. The same configured
  reviewer profiles apply.

## Focused Re-review Result

- Documentation accepts corrected M2/M3 semantics and retains only the expected
  M5 README command/claim finding.
- Style/maintainability accepts all method lengths, cohesion, naming, test
  structure, and absence of generic utilities or accidental exports.
- API/Proto confirms all tokens, exports, declarations, topology, and package
  boundaries, but finds nine task-triggered projection field comments too
  generic: handlers map project ID to `id` and task ID to `name`.
- Reliability accepts lifecycle sequencing and cleanup, but rejects the
  varied-live-delay percentile test as non-deterministic and insufficient to
  prove exact nearest-rank selection.
- The final narrow correction returns to the original M2/M4 context: make those
  nine Proto mappings explicit, and replace live timing assertions with exact
  deterministic p50/p95/p99 evidence through an internal module that is not
  exposed by package exports.

## Implementation Review Acceptance

- M2 explicitly documents project ID to `id` and task ID to `name` for all nine
  task-triggered projections. API/Proto final confirmation is clean and
  normalized Proto tokens remain identical.
- M4 extracts a documented latency distribution into an internal source module
  absent from package exports. Direct unsorted input proves exact p50=5,
  p95=100, p99=100 and empty zeroes without live timing.
- Reliability final confirmation is clean for deterministic percentile proof,
  aggregation, sequencing, correlation, rejection observation, and cleanup.
- A final deterministic documentation correction removes the contradictory
  `@internal` tag from the re-exported percentile type; API confirmation is
  clean while the implementation class remains internal.
- All implementation lanes are accepted for scoped commit, immediate push, and
  integration. M5 then owns README accuracy and exact ledger closure.
