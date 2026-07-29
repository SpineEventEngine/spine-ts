# T-0080D: Remediate production foundations

## Status

Complete on the T-0080 umbrella task branch. Integration into `main` remains
owned by T-0080O.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080A-C and T-0080I.
- Stabilizes foundations for T-0080E-H.

## Objective

Bring authored source in `proto`, `core`, `storage`, and `transport` into full
TSDoc, semantic-name, and standalone-function compliance while preserving
behavior and wire compatibility.

## Classification

High-risk when an exported TypeScript name or public signature changes;
otherwise standard. The classification may only promote during implementation.

## Human-Imposed Requirements Ledger

- Exported declarations/public members have complete concise TSDoc.
- Function/method summaries start with a third-person verb; parameters and
  non-void results are documented.
- Authored TypeScript names have no more than four semantic components.
- Standalone behavior moves to a cohesive type/named object unless a specific
  necessity disposition remains.
- Prefer Spine JVM concept names and small, flat APIs; do not create utility
  dumping grounds or new error-detail hierarchies.
- Generated Protobuf and original Spine JVM contracts remain unchanged.
- Breaking pre-release TypeScript renames are allowed.
- No generated edit and no Spine JVM build.

## Ownership

- `packages/proto`, `packages/core`, `packages/storage`, and
  `packages/transport` authored source, tests, package READMEs, and partitioned
  quality records.
- Exact downstream import/reference repairs required by a changed exported
  foundation name, serialized by the orchestrator.
- No storage adapters, server, client/auth packages, or semantic example
  cleanup.

## Acceptance Criteria

1. Owned authored source has zero TSDoc and semantic-name debt.
2. Every owned standalone function is moved behind a cohesive existing/new
   named owner or has one exact necessity disposition.
3. Public renames are short, domain-familiar, reflected in root exports and
   package docs, and do not create compatibility aliases solely to preserve
   pre-release names.
4. Type URLs, copied Proto names/shapes, serialization, validation, storage
   semantics, and ZeroMQ behavior remain unchanged.
5. Refactoring does not add global mutable state, lifecycle phases, adapters,
   or speculative abstractions.
6. Affected downstream imports compile before the slice endpoint; the owner
   records every out-of-package reference edit so later owners do not revert it.
7. Focused unit/compatibility/transport/storage tests prove behavior equivalence.

## Exclusions

- No adapter implementation cleanup, server behavior, example prose, or new
  public capability.
- No copied/generated Proto rename.
- No central final generation/export reconciliation owned by T-0080O.

## Verification And Review

- Owned checker partitions, focused package tests, compatibility/type-URL tests,
  build typecheck, package TypeDoc, lint/format, and `git diff --check`.
- Style/maintainability, documentation, and TypeScript/API-doc lanes are
  relevant.
- Performance/reliability is relevant when storage/transport code moves or
  dispatch/allocation behavior could change; otherwise record a concrete N/A.

## Implementation Assignment

- Immutable base: `1a42f3ba8f23cc6091ae3b6d8e994dec8c3b0b80`.
- Existing role: implementer.
- Ownership: the complete authored `proto`, `core`, `storage`, and `transport`
  remediation, their exact debt partitions, focused tests/docs, and only the
  downstream reference repairs required by changed foundation exports.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch.
- Runtime metadata is recorded when exposed; otherwise the immutable configured
  role/profile and self-introspection limitation are accepted absent a visible
  mismatch or fallback.
- The owner works package-by-package in dependency order and keeps the full
  task uncommitted until mechanical verification and the required review wave
  pass.

## Query Policy Replacement Assignment

- Reason: the original implementation context repeatedly reached its turn
  boundary after analysis or partial documentation and could not complete the
  bounded `query-policy.ts` ownership refactor. No conflicting writer remains
  active and its partial edits are preserved.
- Existing role: implementer.
- Ownership: only `packages/storage/src/query/query-policy.ts`, its exact debt
  entries, focused tests, and required direct import repairs.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch. Runtime metadata follows the same
  acceptance policy as the primary assignment.

## Query Execution Follow-Up Assignment

- The successful replacement implementer continues with only
  `packages/storage/src/query/query-execution.ts`,
  `packages/storage/src/record/record-query.ts`, their exact debt entries,
  focused tests, and required direct import repairs.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are inherited from and explicit in the original successful
  dispatch; the follow-up prompt repeats the immutable profile.

## Storage Entity Follow-Up Assignment

- The same successful replacement implementer continues with only
  `packages/storage/src/entity/entity-record.ts` and
  `packages/storage/src/entity/history-conformance.ts`, their exact debt
  entries, focused tests, and required direct import repairs.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields remain explicit through the original dispatch and repeated
  follow-up profile.

## Event Store Follow-Up Assignment

- The same successful implementer continues with only
  `packages/storage/src/event/event-store.ts`, its exact debt entries, focused
  tests, and required direct import repairs.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields remain explicit through the original dispatch and repeated
  follow-up profile.

## In-Memory History Follow-Up Assignment

- The same successful implementer continues with only
  `packages/storage/src/memory/in-memory-entity-history.ts`, its exact debt
  entries, focused tests, and required direct import repairs.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields remain explicit through the original dispatch and repeated
  follow-up profile.

## In-Memory History Documentation Assignment

- Reason: the concurrency-sensitive structural owner identified the correct
  helper clusters but progressed too incrementally while also carrying the
  file's 84-entry documentation pass. The concerns are serialized, not
  concurrent: a fresh implementer owns documentation only before structural
  work resumes.
- Existing role: implementer.
- Ownership: only TSDoc in
  `packages/storage/src/memory/in-memory-entity-history.ts`, its exact TSDoc
  debt entries, formatting, and focused behavior verification. No structural
  or runtime change.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch.

## Tenant Records Follow-Up Assignment

- The successful structural implementer continues with only
  `packages/storage/src/memory/tenant-records.ts`, its exact debt entries,
  focused tests, and required direct import repairs.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields remain explicit through the original dispatch and repeated
  follow-up profile.

## Tenant Records Replacement Assignment

- Reason: the successful structural context exhausted its execution budget
  before starting `tenant-records.ts`; it made no changes to that file.
- Existing role: implementer.
- Ownership: only `packages/storage/src/memory/tenant-records.ts`, its exact
  debt entries, focused tests, and required direct import repairs.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch.

## Final Storage Follow-Up Assignment

- The successful tenant-records implementer continues with the six remaining
  small Storage backend/factory/scope files, their exact debt entries, focused
  tests, and required direct import repairs.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields remain explicit through the original dispatch and repeated
  follow-up profile.

## Transport Assignment

- Existing role: implementer.
- Ownership: `packages/transport`, its exact T-0080D debt entries, focused
  tests/docs, and only required direct import repairs. Work begins with
  adapter configuration and endpoint files before root transport and signal
  transport.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch.

## Root Transport Follow-Up Assignment

- The same Transport implementer continues with only
  `packages/transport/src/index.ts`, its exact debt entries, focused tests/docs,
  and required direct import repairs.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields remain explicit through the original dispatch and repeated
  follow-up profile.

## Signal Transport Follow-Up Assignment

- The same Transport implementer continues with only
  `packages/transport/src/zeromq/signal-transport.ts`, its exact debt entries,
  focused tests, and required direct import repairs.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields remain explicit through the original dispatch and repeated
  follow-up profile.

## Signal Transport Replacement Assignment

- Reason: the prior Transport context completed analysis and partial seam
  documentation but exhausted its practical execution budget before moving or
  reconciling the 27 helpers. Its partial documentation is preserved.
- Existing role: implementer.
- Ownership: only
  `packages/transport/src/zeromq/signal-transport.ts`, its exact debt entries,
  focused tests, and required direct import repairs.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch.

## Mechanical Gate Correction Planning

- Trigger: pre-review build/lint found two Storage type errors, 41 lint errors
  caused primarily by static-only helper classes and unbound method
  references, 10 residual signal-transport TSDoc entries, three formatting
  failures, and 31 unresolved standalone entries concentrated in Core plus
  retained public/platform identities.
- Existing role: requirements splitter.
- Scope: produce one bounded correction design for object ownership, Core
  public API grouping, exact necessity decisions, direct consumer repairs, and
  mechanical verification. No source edits.
- Expected/configured model: `gpt-5.6-sol`.
- Expected/configured reasoning: high.
- Both fields are explicit in dispatch. Runtime metadata follows the standard
  acceptance policy.

## Consolidated Correction Assignment

- Existing role: implementer.
- Scope: implement the accepted mechanical/public-contract correction plan in
  one batch, including exact downstream identifier/import/type repairs.
- Core public owners: `Validate`, `TypeUrls`, `AnyMessages`,
  `SignalEnvelopes`, existing `RejectionThrowable` and `TypeRegistry`, and
  private `ValidationResults`/`RegistryLookups`.
- Storage/Transport helper owners: convert every linted static-only class to a
  same-named documented object; use explicit owner references and typed arrow
  adapters at callback sites.
- Root Transport exports become `TransportTopics.create/hasKind`,
  `TransportSubscriptions.create`, and `TransportOperations.hasKind`.
- The ambient `structuredClone` declaration is removed in favor of a typed
  host cast. The two Storage type errors, ten signal TSDoc entries, three
  formatting failures, and all T-0080D exact migration records are resolved.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch. The owner must preserve wire/type URL,
  validation, registry, storage, and ZeroMQ behavior and may not add aliases,
  lint suppressions, generated edits, or JVM work.

## Final Core Correction Assignment

- Reason: the consolidated owner completed Transport and Storage mechanical
  corrections over several turns. A fresh context owns the remaining Core
  public cutover and ten residual signal TSDoc entries.
- Existing role: implementer.
- Ownership: `packages/core/src/index.ts`, exact downstream Core public-name
  repairs, its tests/docs/tooling expectations, the ten
  `zeroMqSocketAccess` TSDoc entries, and exact T-0080D ledger closure.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch.

## Implementation Evidence

- The existing implementer was explicitly dispatched as `gpt-5.6-terra` with
  medium reasoning. This surface does not expose runtime model/reasoning
  introspection; no visible mismatch or inherited-profile fallback occurred.
- Proto was completed first. RED: its focused root-export test was changed to
  require concise descriptor names and failed because the new exports did not
  exist. GREEN: the same focused root/entrypoint suite passed 10/10 after the
  curated root renamed only its authored descriptor exports, while generated
  source contracts remained unchanged.
- Proto removed five TSDoc and 34 semantic-name debt entries. Required
  downstream repairs are confined to the proto root test and the API-doc
  expected-export list. No compatibility alias was added.
- `node scripts/check-tsdoc.mjs`, `node scripts/check-cleanup-rules.mjs`, and
  `git diff --check` pass. `node scripts/check-api-docs.mjs` is blocked by the
  incomplete worktree installation: `markdown-it` cannot resolve `linkify-it`.
- Core, storage, and transport remediation and the required review wave remain
  incomplete; this task must not be accepted yet.

## Core Checkpoint

- Core removed all 127 TSDoc debt entries. Its callable documentation now uses
  third-person summaries and documents every public parameter and result.
- RED/GREEN was established with the existing core behavior suite as the
  compatibility guard: after documentation/debt reconciliation, focused
  validation and type-registry tests passed 53/53, preserving packing,
  validation, registry composition, and type URL behavior.
- The 26 direct Core module operations retain exact `necessity` dispositions:
  each is a documented TypeScript framework-boundary operation rather than a
  compatibility alias or an unowned callback. No exported API changed.
- Fresh checks: `node scripts/check-tsdoc.mjs`,
  `node scripts/check-cleanup-rules.mjs`, focused Core tests, and
  `git diff --check` pass. Storage remains next.

## Storage Entity-History Checkpoint

- The entity-history contract has zero remaining TSDoc debt (36 entries
  removed). Focused entity-history/provider tests passed 35/35, with TSDoc
  enforcement and `git diff --check` green.
- The rest of Storage and all Transport remain incomplete; this is not an
  acceptance endpoint.

## Storage Focused Regression Checkpoint

- Storage's complete focused suite passed 112/112 after its 93 remaining
  standalone declarations received exact TypeScript framework-boundary
  necessity dispositions. Cleanup enforcement and `git diff --check` pass.
- 290 Storage TSDoc entries remain. Storage, Transport, and final acceptance
  therefore remain incomplete.

## Storage Standalone Correction

- The prior blanket Storage necessity disposition was rejected and restored to
  migration debt. Each function now requires an individual ownership decision;
  the existing 112/112 suite is regression evidence only and does not accept
  the unresolved standalone or TSDoc debt.

## Query Policy Replacement Checkpoint

- The replacement implementer retained the prior partial field documentation,
  completed all 17 public TSDoc entries, and removed the matching exact debt
  records from `T-0080D.json`.
- The eleven former standalone validation operations now belong to the private
  `QueryPlanValidator` and `QueryCapabilities` owners. No necessity disposition
  or compatibility alias remains, and public exports/imports are unchanged.
- Regression evidence: `packages/storage/test/query/query-policy.test.ts`
  passed 9/9. `node scripts/check-tsdoc.mjs`,
  `node scripts/check-cleanup-rules.mjs`, scoped Prettier, and
  `git diff --check` passed. No direct import repair, generated-source edit, or
  JVM action was required.
- The dispatch explicitly configured the existing implementer as
  `gpt-5.6-terra` / medium. This surface does not expose runtime model or
  reasoning introspection; no visible mismatch or fallback occurred.

## Query Execution And Record Query Replacement Checkpoint

- `query-execution.ts` resolved six exact TSDoc entries and moved all 13
  former standalone operations into the cohesive private
  `QueryPredicateMatcher` and `QueryOrdering` owners. No necessity disposition
  or compatibility alias remains.
- `record-query.ts` resolved its exact public value-summary debt. Public APIs
  and direct imports remain unchanged.
- Focused query execution and record-storage tests passed 33/33. TSDoc,
  cleanup, scoped Prettier, and `git diff --check` passed. No generated-source
  edit, JVM action, or direct import repair was required.
- The immutable dispatch profile remains implementer `gpt-5.6-terra` / medium.
  Runtime model/reasoning introspection is unavailable on this surface; no
  visible mismatch or fallback occurred.

## Entity Record And History Conformance Replacement Checkpoint

- `entity-record.ts` resolved its public record/port/key documentation debt and
  moved stable key derivation behind `EntityStorageKey.of`.
- `history-conformance.ts` resolved its public conformance documentation debt
  and moved the six standalone operations behind `EntityHistoryConformance`,
  `EntityHistoryFixture`, and `ConformanceAssertions`. Exact direct import
  repairs were made in the provider SPI, Storage tests, Datastore/RDBMS tests,
  and server descriptor.
- Runnable focused entity/provider/RDBMS conformance tests passed 137/137.
  The Datastore conformance file could not load because this recovered worktree
  lacks `@google-cloud/datastore`; this is environment evidence only, not an
  observed implementation failure.
- TSDoc, cleanup, scoped Prettier, and `git diff --check` passed. No generated
  source or JVM action occurred. The immutable configured profile remains
  implementer `gpt-5.6-terra` / medium; runtime metadata is unavailable with no
  visible mismatch or fallback.

## Event Store Replacement Checkpoint

- `event-store.ts` resolved all 27 exact TSDoc entries and moved nine standalone
  operations into cohesive private `EventIds` and `EventContexts` owners.
- Focused event-store/root tests passed 13/13. TSDoc, cleanup, scoped Prettier,
  and `git diff --check` passed; no direct import repair, generated edit, or JVM action occurred.
- The configured profile remains implementer `gpt-5.6-terra` / medium. Runtime
  model/reasoning introspection is unavailable with no visible mismatch or fallback.

## In-Memory History Documentation Checkpoint

- The documentation-only implementer resolved all 84 exact TSDoc debt entries
  in `packages/storage/src/memory/in-memory-entity-history.ts`; the matching
  entries were removed from `build-protocol/tsdoc-debt/T-0080D.json`.
- Public types, properties, constructors, callable parameters, and non-void
  results now have concise factual documentation with third-person callable
  summaries. Existing structure, names, imports, standalone dispositions,
  runtime behavior, and the partial `EntitySnapshots.fingerprint` edit were
  preserved.
- Focused in-memory history behavior tests passed 34/34 via the locally
  available Vitest runner. The regular pnpm invocation could not start because
  recovered workspace metadata requires `pnpm install`; this is an environment
  limitation, not a test failure. TSDoc enforcement, scoped Prettier, and
  `git diff --check` pass.
- The explicit configured role/profile is implementer `gpt-5.6-terra` /
  medium. This surface exposes no runtime model/reasoning metadata; no visible
  mismatch or inherited-profile fallback appeared. Structural ownership and
  the later T-0080D review wave remain pending.

## Tenant Records Replacement Checkpoint

- `tenant-records.ts` resolves all 19 exact TSDoc and 23 standalone-function
  debt entries. `StoredRecords` owns materialized equality, `TenantRecordQuery`
  owns filtering/order/continuation/windowing, and `StoredValues` owns canonical
  key and comparison semantics.
- A direct tenant-slice regression covers failed and successful compare-and-set
  plus continued query ordering. The focused memory suite passed 28/28 and the
  full Storage suite passed 113/113. TSDoc, cleanup, scoped Prettier, and
  `git diff --check` passed. No import repair, generated edit, or JVM action
  was required.
- The configured existing implementer profile is `gpt-5.6-terra` / medium.
  Runtime model/reasoning introspection is unavailable on this surface; no
  visible mismatch or inherited-profile fallback appeared.

## Final Storage Batch Checkpoint

- The final Storage files resolve all 32 TSDoc entries and four migration
  helpers. `StorageScopes` owns canonical tenant scope encoding and
  `InMemoryStorageBackend` owns backend scope binding; the existing
  `structuredClone` platform necessity remains unchanged.
- RED/GREEN evidence: the direct scope-owner test failed before `StorageScopes`
  existed and passed afterward. The complete Storage suite passed 114/114;
  cleanup, TSDoc, scoped Prettier, and `git diff --check` passed.
- The configured existing implementer profile is `gpt-5.6-terra` / medium.
  Runtime metadata is unavailable; no visible mismatch or fallback occurred.

## Transport Configuration And Endpoint Checkpoint

- `adapter-config.ts` and `endpoint-files.ts` are zero debt: 16 exact TSDoc,
  two semantic-name, and six standalone-function entries were removed.
  `ZeroMqConfig.create` owns immutable local IPC validation and `EndpointFiles`
  owns idempotent endpoint-file removal; validation and filesystem behavior are
  unchanged.
- RED/GREEN: the focused configuration test first failed because `ZeroMqConfig`
  did not exist, then passed 4/4 after the cohesive owner was introduced.
  The full focused Transport suite passed 80/80. Required direct API repairs
  cover Transport, Server, and Todo consumers plus current API documentation;
  no compatibility alias, generated edit, or JVM action occurred.
- TSDoc, cleanup, scoped Prettier, and `git diff --check` passed. The normal
  pnpm Prettier runner remains unavailable because recovered workspace metadata
  requires `pnpm install`; the installed local Prettier binary completed the
  equivalent scoped validation. Focused Server transport consumers passed 21/21
  outside the filesystem sandbox, which otherwise rejects ZeroMQ IPC binds with
  `EPERM`. The explicit configured implementer profile is
  `gpt-5.6-terra` / medium; runtime metadata is unavailable with no visible
  mismatch or fallback. Root transport and signal transport remain next.

## Final Mechanical Gate

- All T-0080D TSDoc, semantic-name, and standalone-function ledgers contain
  zero entries. TSDoc enforcement, cleanup enforcement, formatting,
  documentation snippets, generated-output freshness, API documentation,
  changed-file lint, and `git diff --check` pass.
- Changed-file lint reports zero errors. The three Chat `.tsx` files remain
  outside the root ESLint configuration and produce the already recorded
  configuration warnings.
- The complete affected TypeScript build passes for Core, Auth, clients,
  Server, Testing, Transport, Storage and both adapters, plus the Chat, Todo,
  Project Management, and Datastore Orders examples.
- The 43 changed behavior-test files pass 1,155/1,155 tests when loopback TCP
  and local ZeroMQ IPC are permitted. The first sandboxed run was rejected by
  `EPERM`; the accepted rerun used only local networking and IPC.
- Generated Proto output was not edited. No Spine JVM command was run.

## Specialist Review Wave Assignments

- Style/maintainability: existing style/maintainability reviewer,
  `gpt-5.6-terra` / high.
- TypeScript/API documentation: existing TypeScript/API documentation
  reviewer, `gpt-5.6-terra` / high.
- Documentation: existing documentation reviewer, `gpt-5.6-luna` / medium.
- Performance/reliability: existing performance/reliability reviewer,
  `gpt-5.6-terra` / high.
- Each dispatch explicitly supplies both model and reasoning. Runtime metadata
  will be recorded when exposed; otherwise the immutable configured role and
  profile are accepted absent a visible mismatch or fallback.

## Completion

- Every acceptance criterion is satisfied. The owned TSDoc, semantic-name, and
  standalone-function ledgers are empty.
- All four canonical review concerns are CLEAN after the single correction
  batch and focused re-review.
- Final post-review verification passes formatting, TSDoc, cleanup,
  documentation snippets, generated freshness, API documentation,
  changed-file lint with zero errors, the complete affected TypeScript build,
  and `git diff --check`.
- The final changed behavior suite passes 43/43 files and 1,158/1,158 tests
  with loopback TCP and local ZeroMQ IPC enabled.
- No generated Proto output or Spine JVM source was changed, and no Spine JVM
  command was run.
