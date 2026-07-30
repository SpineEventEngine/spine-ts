# T-0080N: Remediate the datastore-orders example

## Status

Planned.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080E and T-0080H.
- May run in parallel with T-0080L/M.

## Objective

Bring the flat datastore-orders example's authored TypeScript and Proto into
full documentation, naming, and behavior-ownership compliance while preserving
its Datastore-backed workflow.

## Classification

High-risk if an authored Proto/public example contract or persistence-sensitive
behavior changes; otherwise standard.

## Human-Imposed Requirements Ledger

- The example remains flat and uses
  `@spine-event-engine/example-datastore-orders`.
- Authored Proto declarations/fields and exported TypeScript APIs have concise,
  complete documentation.
- Authored names have at most four semantic components.
- Standalone functions require cohesive ownership or exact necessity
  dispositions.
- Existing Datastore adapter/load behavior and end-user API guardrails remain
  intact.
- Copied Spine Proto and generated output are not hand-edited.
- No Spine JVM build.

## Ownership

- `examples/datastore-orders` authored Proto/TypeScript, docs, tests, and
  quality partitions only.
- No shared root script/workspace/API-manifest edit.

## Acceptance Criteria

1. Owned authored Proto and TypeScript have zero comment/TSDoc/name debt.
2. Every remaining standalone function has a specific necessity disposition.
3. Proto renames preserve field numbers/wire types and update generated
   consumers through clean generation.
4. Datastore adapter composition, command/entity/query/load behavior, package
   payload, and cleanup remain equivalent.
5. README environment variables/commands/package coordinate remain accurate and
   end-user API scans remain clean.
6. Focused example tests pass without requiring live external Datastore access
   beyond the repository's existing test contract.

## Exclusions

- No Datastore feature/schema migration, new example behavior, or package move.
- No shared tooling/generation aggregation change.

## Verification And Review

- Clean package generation/build, full datastore-orders focused tests/load
  smoke under existing fixtures, docs commands/links, end-user API scan,
  TypeDoc/lint/format, checker partitions, generated cleanliness, and
  `git diff --check`.
- Style/maintainability, documentation, TypeScript/API docs, and
  performance/reliability are relevant when persistence/load ownership moves.

## Planning Dispatch

- T-0080N starts after completed and pushed T-0080M commit `28c0f379`.
- Authored Proto/public contracts plus persistence/load lifecycle make planning
  high-risk. The existing requirements splitter is explicitly assigned
  `gpt-5.6-sol` / high.
- The splitter is read-only, may not spawn, and must inventory the exact 79
  TSDoc, 13 standalone-function, 54 Proto-comment, and one structural row;
  freeze wire/package/generated/Datastore/query/load/cleanup invariants; and
  propose bounded non-overlapping ownership and exact gates.
- Both model and reasoning fields are explicit. Runtime metadata or its honest
  limitation is required.

## Accepted Bounded Plan

- Exact debt is 79 TSDoc rows, 13 standalone-function rows, 54 Proto-comment
  rows, and one semantic-name row.
- N1 owns the command/entity/event Proto files and adds 18 comments. N2 owns
  `read_models.proto` and adds 36 comments. Neither changes a non-comment token.
- N3 owns `src/index.ts` and its topology test only if required. It resolves 57
  TSDoc rows and renames only
  `startDatastoreOrdersDatastoreServer` to `startOrdersDatastoreServer`;
  no compatibility alias remains.
- N4 owns `src/load-runner.ts`, its script, and its test. It resolves 22 TSDoc
  rows, retains exported `runDatastoreOrdersLoad`, and moves nine private
  helpers into the existing run/user owners without generic utilities.
- N5 follows integration and owns README plus the four exact ledgers. It targets
  zero TSDoc/Proto/name debt and exactly four necessities for the three public
  composition/server boundaries plus the exported load runner.
- Package, Proto package/type URLs/wire/options/generated paths, exact 2/10/2
  topology and 14 repositories, storage-factory composition, Datastore adapter
  creation, server defaults, load levels, 16-session pool, 10-user waves,
  correlation, timings, all-settled failure messages, percentiles,
  zero-elapsed throughput, timeout aborts, cleanup, and CLI shutdown are frozen.
- Baseline clean generation/project build and all three focused files/10 tests
  pass. The required CLI gate is the real 10-user in-memory loopback run; it is
  not Datastore emulator/cloud evidence.
- All four canonical review concerns apply. Security is N/A until final release
  readiness.
- Splitter runtime self-introspection was unavailable for explicit
  `gpt-5.6-sol` / high, with no visible mismatch.

## Implementation Dispatch

- N1, N2, and N3 use isolated non-overlapping ownership. Each writer is the
  existing implementer role, explicitly `gpt-5.6-terra` / medium, with both
  fields explicit in dispatch.
- Writers may not edit another track, shared tooling, package/workspace files,
  generated output, ledgers, or records; may not commit, push, build Spine JVM,
  or spawn; and must report runtime metadata or its limitation.
- N1/N2 prove comment-only token identity. N3 proves the single exact rename,
  unchanged topology/storage/server behavior, and complete TSDoc.
- N4 is dispatched when an implementation slot returns. N5 follows complete
  integration and review.

## N4 Implementation Dispatch

- After N2 returns, its existing implementer context is reassigned to N4 with
  explicit `gpt-5.6-terra` / medium configuration.
- N4 owns `src/load-runner.ts`, `scripts/load.mts`, and
  `test/load-runner.test.ts`. It resolves 22 TSDoc rows, preserves exported
  `runDatastoreOrdersLoad`, and moves nine private helpers into the existing
  load-run and user-run owners.
- Exact 16-session pooling, 10-user waves, unique identities, Ack/query/
  subscription correlation, timings, failure messages, percentiles,
  zero-elapsed throughput, per-RPC abort signals, timeout abort/clear,
  rejection observation, user cleanup, outer session abort, and CLI shutdown
  are frozen.
- No generic utility or new public helper is allowed. The writer may not edit
  Proto/index/docs/ledgers/records/package/shared/generated files, commit, push,
  build Spine JVM, or spawn. Runtime metadata or its limitation is required.

## Implementation Wave Completion

- N1 adds exactly 18 comments to core Proto; N2 adds exactly 36 comments to
  read-model Proto. Both preserve normalized non-comment hashes, expose only
  exact stale ledger rows, and pass protected checksum/diff gates.
- N3 resolves 57 application TSDoc rows and changes exactly one non-comment
  token: the approved `startOrdersDatastoreServer` export rename. Full
  workspace build, ESLint, Prettier, four topology tests, and diff integrity
  pass.
- N4 resolves 22 load-runner TSDoc rows and moves nine private helpers into the
  existing load/user owners. Full workspace build, ESLint, Prettier, five
  pooled-session/cancellation tests, zero live TSDoc findings, and diff
  integrity pass.
- Every writer was the existing implementer role, explicitly
  `gpt-5.6-terra` / medium. Runtime self-introspection was unavailable, with no
  visible mismatch.

## Complete Review Wave Assignments

- Style/maintainability uses the existing reviewer, explicitly
  `gpt-5.6-terra` / high, across helper ownership, method size, four-part
  naming, exact rename, and absence of generic utilities.
- Documentation uses the immutable reviewer configured
  `gpt-5.6-luna` / medium, across 54 Proto comments, 79 TSDoc rows, and eventual
  README evidence boundaries.
- TypeScript/API documentation uses the existing reviewer, explicitly
  `gpt-5.6-terra` / high, across the public rename, declarations, Proto/wire
  identity, generated consumers, and package boundaries.
- Performance/reliability uses the existing reviewer, explicitly
  `gpt-5.6-terra` / high, across storage composition, session pool/waves,
  correlations, timings, failure accounting, percentiles, timeout aborts,
  cleanup, and shutdown.
- Reviewers are read-only, inspect N1-N4 as one complete wave, may not spawn,
  and must report runtime metadata or its limitation. Security remains N/A.

## Complete Review Wave Result

- Documentation accepts all Proto/TSDoc and finds only M5 README work: replace
  the incomplete test command, document timing/timeout/cleanup/shared-session
  ownership, remove the unsupported sustained-traffic claim, and keep
  in-memory evidence boundaries explicit.
- Style/maintainability is clean for naming, exact rename, comment accuracy,
  load/user ownership, compact methods, and absence of generic utilities.
- TypeScript/API/Proto confirms identical Proto tokens, exact public rename,
  unchanged signatures/package/generated/topology/runner boundaries, and finds
  one wording defect: p50 is nearest-rank fiftieth percentile, not conventional
  median.
- Reliability accepts storage composition, pool/waves, uniqueness, RPC
  signals, timeout abort/clear, correlation, failure accounting, cleanup, and
  shutdown. It requests deterministic non-empty varied nearest-rank coverage.
- Reviewer profiles were Luna/medium documentation and explicit Terra/high
  style/API/reliability. Runtime self-introspection was unavailable with no
  mismatch.

## Consolidated Correction Batch

- N4 moves percentile calculation into a cohesive internal module absent from
  package exports, corrects p50 wording, and adds direct exact varied/empty
  percentile tests without changing the public type/runner signatures.
- N5 later updates README to the final focused test count and all accepted
  storage/load/timing/cleanup/evidence wording while closing exact ledgers.
- Only API documentation and reliability reopen for N4; documentation reopens
  for final README. Style needs confirmation only if extraction broadens
  ownership or method structure.

## Correction Completion And Re-review

- N4 extracts a documented internal `LatencyDistribution` absent from package
  exports, re-exports the unchanged public percentile type, removes percentile
  methods from the load owner, and corrects p50 wording.
- Direct unsorted values assert exact nearest-rank p50/p95/p99 and empty zeroes
  without live timing. Existing pooled-session/cancellation behavior remains
  covered.
- Independent project build, ESLint, Prettier, all three example files and 11
  tests, scoped TSDoc/cleanup expectations, package-export absence, and diff
  integrity pass.
- Focused API/Proto and reliability re-review reopen. Documentation waits for
  M5 README; style remains closed unless re-review identifies broadened
  ownership.

## Implementation Review Acceptance

- Reliability re-review is clean: exact varied/empty nearest-rank evidence and
  unchanged aggregation, pool/waves, correlation, timeout abort/clear,
  rejection observation, user cleanup, and outer-session cleanup.
- API/Proto re-review is clean: public percentile shape and runner signature
  remain compatible; the implementation class/internal path is absent from
  package exports; the exact server rename and Proto token identity remain
  accepted.
- All implementation lanes are accepted for scoped commit, immediate push, and
  integration. N5 then owns README accuracy and exact ledger closure.

## N5 Documentation Closure Dispatch

- The existing implementer role owns only
  `examples/datastore-orders/README.md` and the four exact T-0080N ledger files
  under `build-protocol/tsdoc-debt`,
  `build-protocol/example-proto-debt`,
  `build-protocol/typescript-structure-debt`, and
  `build-protocol/standalone-function-necessities`.
- The dispatch explicitly uses `gpt-5.6-terra` with medium reasoning. The
  implementer may not edit authored source, generated code, tests, package
  metadata, shared protocol records, or spawn another agent.
- The README must give the complete three-file/11-test command and accurately
  explain provider-neutral composition, the Datastore convenience path, fixed
  topology, shared session pool and waves, timing origins, per-RPC aborts,
  500 ms iterator cleanup, shared-pool shutdown without a cancellation RPC,
  and the limits of in-memory versus live Datastore evidence.
- Exact closure requires empty TSDoc, Proto-comment, and TypeScript-structure
  debt ledgers plus exactly four justified standalone functions:
  `createDatastoreOrdersContext`, `startDatastoreOrdersServer`,
  `startOrdersDatastoreServer`, and `runDatastoreOrdersLoad`.

## N5 Deterministic Correction Batch

- Exact ledger closure exposed six authored-source TSDoc findings previously
  hidden by the N ledger: the `runDatastoreOrdersLoad` callable summary and the
  `LatencyDistribution.from()`/`percentiles()` summaries, parameter, and return
  documentation.
- The same existing implementer context receives only those two source files
  as a deterministic correction. It must preserve behavior and signatures,
  rerun the scoped TSDoc checker, formatting, diff checks, and all three
  focused files/11 tests, and may not change the completed README/ledgers.
- Documentation and API review reopen only if the correction changes claims or
  declarations beyond checker-conforming TSDoc.

## N5 Pre-review Verification And Review Dispatch

- Exact example Proto-quality and cleanup/structure enforcement pass with
  empty TSDoc, Proto-comment, and TypeScript-structure debt and exactly four
  approved standalone necessities.
- Prettier passes for all seven changed README/source/ledger files, and
  `git diff --check` is clean.
- The isolated worktree cannot execute the focused Vitest suite because its
  workspace dependency links resolve outside this branch; zero tests were
  collected. The same exact three-file/11-test command must run after
  integration into the dependency-equipped umbrella worktree.
- The existing documentation reviewer is dispatched explicitly with
  `gpt-5.6-luna` and medium reasoning over README factual accuracy, command
  usability, and the six corrected TSDoc rows. Style, API/Proto, and
  reliability remain closed because this batch changes only checker-conforming
  documentation and exact ledgers.

## N5 Documentation Review Acceptance

- Documentation review is clean for the README's composition, topology,
  command, load-level, pooling/wave, timing, abort/cleanup, and evidence-limit
  claims and for all corrected TSDoc.
- The reviewer confirms three empty debt ledgers and exactly four accurate
  standalone necessities.
- The immutable reviewer profile is `documentation_reviewer`,
  `gpt-5.6-luna` / medium. Runtime self-introspection is unavailable, with no
  visible profile mismatch.
- N5 is accepted for commit and immediate push. The focused 11-test runtime
  gate remains due after integration into the dependency-equipped umbrella.
