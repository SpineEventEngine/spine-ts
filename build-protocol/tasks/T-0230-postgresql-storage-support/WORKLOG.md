# T-0230 Work Log

Status: Implementation in progress
Branch: `add-postgresql-storage`
Checkout: `/Users/armiol/development/experiments/spine-ts`
Baseline: `6fffcd6102b3eff94b0f77eb6db2fbf2e02ba172`
Planning endpoint: `afbe08f242446b0a4660d6c8580bf3d798e6dcbb`
Started: `2026-09-21 09:03 WEST`

## Entry State

- The branch and `origin/add-postgresql-storage` both resolved to the planning
  endpoint before implementation framing. The working tree was clean.
- The task remains high risk because it changes persistence, transactions,
  concurrency, lifecycle, dependencies, and a public package contract.
- The selected final profile is `verify:release`: this task changes runtime,
  tests, a public API, dependencies, release inventory, and shared build
  metadata. The mandatory cheap preflight runs before the single post-review
  release profile.
- The active estimate is 32–44 hours of implementation, focused verification,
  review, correction, release verification, and reporting. Live PostgreSQL 16
  and 18 availability and final CI add elapsed waiting time.

## Library Selection

- The implementation-start registry check reports `pg` `8.23.0`, with Node
  `>=16`, and `@types/pg` `8.23.1`. The upstream node-postgres repository and
  official package metadata show active maintenance, ESM support, parameterized
  queries, pooling, transactions, and current Node support.
- Select exact `pg` `8.23.0` at the runtime boundary and exact `@types/pg`
  `8.23.1` for development. This is the established PostgreSQL driver; it
  supplies the required low-level pool/client API without adding an ORM or SQL
  abstraction.
- Rejected alternatives: an ORM/query builder, Testcontainers, a custom wire
  client, or a dependency on the MySQL package. Each adds concepts or runtime
  dependencies outside the accepted task.

## Dispatch

- Existing role: `implementer`.
- Responsibility: one continuing author for the coherent PostgreSQL package and
  its behavior-focused tests, starting with accepted slice 1. No other agent
  may edit overlapping production files.
- Explicit dispatch profile: `gpt-5.6-terra` with `medium` reasoning.
- Child spawning is prohibited. Desktop supports explicit model/reasoning
  dispatch. Runtime self-introspection is unavailable, so the immutable role
  profile and explicit dispatch fields are the acceptance evidence unless a
  visible mismatch appears.
- Applicable instructions: the complete task ledger and slice brief,
  `BUILD_PROTOCOL.md`, `CODE_QUALITY.md`, `implement`, and
  `test-driven-development`. Runtime production code must follow observed RED,
  GREEN, and refactor steps.

## Slice Progress

1. Contract and package skeleton: complete at `a9010b8f5`; independent
   mechanical verification is clean after its TSDoc correction.
2. Connection, tenancy, names, and schema: active.
3. Record operations and query pushdown: pending.
4. Entity histories and atomic operations: pending.
5. Live PostgreSQL acceptance: pending.
6. Documentation and release integration: pending.
7. Aggregated review and release verification: pending.

## Questions

No blocking question remains. Public naming, PostgreSQL compatibility floor,
package boundary, driver, and excluded concepts are resolved in `TASK.md`.

## Slice 1: Contract And Package Skeleton

- Mechanical verification assignment recorded before dispatch: orchestrator-
  dispatched read-only verification over the Task 1 endpoint, explicit
  `gpt-5.6-luna` / `low`, no child spawning. It will rerun the focused contract
  test, package/typecheck boundary, lint/TSDoc/format/diff checks, generated-
  output inspection, dependency/public-export scan, and remote-SHA check without
  editing files.

- RED (initial test correction):
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/storage-postgres/test/postgres-builder-contract.test.ts`
  first failed before test collection because the new package manifest had not
  yet supplied `@bufbuild/protobuf/wkt`. The test was corrected to avoid that
  unrelated package dependency.
- RED (missing feature): the same command then failed with `Cannot find module
'../src/index.js' imported from .../packages/storage-postgres/test/postgres-builder-contract.test.ts`.
  This established that the public PostgreSQL entrypoint and its builder
  contract were absent before production source was added.
- RED (asynchronous construction error): after adding the public-error test,
  the focused command ran three tests and failed one with `Error: PostgreSQL
storage options are required.` at `Builder.build`. The builder threw
  synchronously despite its `Promise` return contract.
- GREEN: after returning rejected promises for invalid builder state, the same
  focused command passed `3 passed (3)` in one test file. The final focused
  preflight also passed:
  `pnpm exec tsc --noEmit -p packages/storage-postgres/tsconfig.json`,
  `pnpm exec tsc --noEmit -p tsconfig.eslint.json`,
  `pnpm exec eslint packages/storage-postgres/src packages/storage-postgres/test`,
  `node scripts/check-tsdoc.mjs packages/storage-postgres`, explicit Prettier
  checking for changed source/manifest/project files, and `git diff --check`.
- Added `packages/storage-postgres` with its published manifest, package
  project, package-local contract test, PostgreSQL-named factory/options/tenant
  options/table/custom-DDL types, stable provider error classes, and Entity
  handle type. The root entrypoint exports only this declared stable surface.
  The package declares direct `pg` `8.23.0` runtime and `@types/pg` `8.23.1`
  development dependencies, without a MySQL adapter, ORM, query builder,
  Testcontainers, or patched dependency.
- Updated `pnpm-lock.yaml` and the root TypeScript project reference. No
  connection, SQL, schema, CRUD, query, history, atomic, live-provider,
  broad-documentation, or release-inventory behavior was added. Generated
  `packages/storage-postgres/dist/tsconfig.tsbuildinfo` was removed before
  recording this boundary.
- Changed tracked files: `pnpm-lock.yaml`, `tsconfig.json`,
  `packages/storage-postgres/package.json`, `packages/storage-postgres/tsconfig.json`,
  `packages/storage-postgres/src/index.ts`,
  `packages/storage-postgres/src/postgres/errors.ts`,
  `packages/storage-postgres/src/postgres/entity-history.ts`,
  `packages/storage-postgres/src/postgres/storage-factory.ts`, and
  `packages/storage-postgres/test/postgres-builder-contract.test.ts`.
- Self-review: the root has no `pg` pool/client, SQL/compiler/catalog/lock, or
  test-helper export. `PostgresStorageFactory.newBuilder()` is the sole static
  construction vocabulary, and `build()` reports configuration failure through
  its promised result. The factory stores contract configuration only; actual
  pool creation and all database behavior remain for slice 2 onward.

## Slice 1 Documentation Correction

- Mechanical verification found five `lint:tsdoc` diagnostics on
  `PostgresStorageFactory.onCreateRecordStorage()`: no semantic summary, no
  documentation for `_context`, `_recordSpec`, or `_group`, and no return
  documentation. Added accurate TSDoc describing its deliberate contract-only
  rejection without changing behavior.
- GREEN: `pnpm --config.verify-deps-before-run=false exec vitest run
packages/storage-postgres/test/postgres-builder-contract.test.ts` passed
  `3 passed (3)`; `pnpm --config.verify-deps-before-run=false lint:tsdoc`
  reported `TSDoc enforcement checks passed.`; scoped ESLint, Prettier, and
  `git diff --check` passed.
- Removed generated `packages/storage-postgres/dist/tsconfig.tsbuildinfo`
  after verification. The only committed correction is
  `packages/storage-postgres/src/postgres/storage-factory.ts` plus this log.
- Independent mechanical verification at `cd8181874` passed the 3 focused
  tests, package typecheck, ESLint, Prettier, diff, dependency/public-export,
  untracked-output, clean-tree, and remote-SHA checks. The repository-wide
  TSDoc lane found five missing documentation entries on
  `onCreateRecordStorage()` that the narrower package checker did not report.
  Task 1 remains active until the same implementation author corrects this,
  reruns the affected checks, removes ignored build output, and pushes the fix.
- The same author corrected the full-TSDoc finding in `a9010b8f5`. Fresh
  orchestrator evidence passed the 3 focused tests and complete TSDoc gate;
  local and remote SHAs matched, the checkout was clean, and no ignored package
  build output remained. Task 1 is accepted.

## Slice 2 Dispatch

- Existing `implementer` role continues as the sole production writer for the
  connection/tenancy/name/schema foundation. Explicit dispatch remains
  `gpt-5.6-terra` / `medium`; child spawning is prohibited.
- The slice brief requires strict test-first behavior and the selected TDD
  skill's complete test-double guidance. Driver doubles may isolate external
  I/O only; tests must assert provider behavior, and no test-only production
  method is permitted.
- Ordinary tests cannot start Docker or require a live database. Live
  PostgreSQL 16/18 evidence remains slice 5 work.
- The initial implementation context completed the connection, naming, ID,
  table-spec, and first initializer RED/GREEN steps, then returned
  `NEEDS_CONTEXT` twice. After the orchestrator supplied the private initializer
  boundary and an exact catalog-test batch, it returned immediately without a
  command or edit. That context is unavailable for productive continuation.
- A fresh existing `implementer` receives only the remaining Task 2 catalog,
  retry/race, tenant/configuration, lifecycle, verification, and commit work.
  The dispatch is explicit `gpt-5.6-terra` / `medium`, prohibits children, and
  preserves the current uncommitted TDD work. This is a serialized handoff;
  there is still only one production writer.

## Slice 2 In-Progress RED/GREEN Boundary

- RED: `pnpm --config.verify-deps-before-run=false exec vitest run
packages/storage-postgres/test/postgres-builder-contract.test.ts
packages/storage-postgres/test/postgres-connection.test.ts` failed the new
  connection test because the `pg` `Pool` constructor had zero calls. The
  contract-only factory had no connection behavior.
- GREEN: added validated PostgreSQL pool configuration, explicit/default schema
  proof, retired-layout inspection, probe release, partial-failure pool close,
  and idempotent contained pool draining. The same focused pair passed.
- RED: the private PostgreSQL table resolver/type-mapping module was absent;
  `postgres-table-spec.test.ts` failed to import `table-spec.js`.
- GREEN: native `BYTEA`, `TEXT`, integer, boolean, `REAL`, and `DOUBLE
PRECISION` mapping plus 63-byte lowercase physical-name validation passed in
  `postgres-table-spec.test.ts`.
- RED: `postgres-id-column.test.ts` failed to import the absent private ID
  conversion module.
- GREEN: PostgreSQL ID conversion now reads `BIGINT` through `BigInt` without
  JavaScript number precision loss. The accumulated focused suite passed six
  tests, package typecheck, scoped ESLint, full TSDoc, Prettier, and
  `git diff --check`; generated `dist/tsconfig.tsbuildinfo` was removed after
  verification.

## Task 2 Takeover Completion

- Existing role/function: continuing `implementer`; configured profile was
  `gpt-5.6-terra` / `medium`. The task surface does not expose runtime model
  metadata, so this immutable dispatch profile is the available evidence.
- The replacement author first confirmed the inherited foundation with
  `pnpm exec vitest run packages/storage-postgres/test/postgres-{builder-contract,connection,id-column,table-spec,table-initializer}.test.ts --maxWorkers=1`:
  8 tests passed before the new work.
- RED: the catalog suite failed against the count-only initializer for an exact
  compatible PostgreSQL layout, retry with a fresh client, and deterministic
  advisory-lock identity. The failure was the expected generic incompatible
  schema result, proving the initializer lacked complete catalog inspection.
- GREEN: private initialization now creates the exact table shape, reads
  complete parameterized column/primary-key/unique catalog rows, rejects
  missing or extra columns, incompatible native type/nullability/default,
  wrong ordered primary key, and non-primary unique constraints. It rolls back
  and releases on every failure and retries exactly once only for `40001` or
  `40P01`, using a new acquired client. Its transaction advisory key includes
  a fixed table-lock domain plus database/schema/table identity.
- Characterization and boundary coverage now verifies URL/pool/schema/tenant
  rejection, normalized duplicate physical targets, TLS translation, sanitized
  driver errors, partial-pool cleanup, idempotent contained drain, and no
  global `pg` type-parser mutation. `Builder.build()` now consistently returns
  a rejected promise for invalid configuration instead of throwing synchronously.
- GREEN evidence: focused Task 1+2 suite passed 25/25; package `tsc --noEmit`,
  scoped ESLint, Prettier, full `pnpm lint:tsdoc`, and `git diff --check` pass.
  Formatting was applied mechanically and the focused suite was rerun green.
- Limitation: `pnpm verify:task -- --no-coverage ...` cannot reach its tests in
  this checkout because `pnpm proto:generate` fails first with the existing
  `@spine-event-engine/proto` manifest/package-version mismatch. No generated
  files were retained, and direct package typechecking and focused tests pass.

## Task 2 TSDoc Correction

- RED: the full `pnpm lint:tsdoc` deterministic review reported eight fresh
  diagnostics: the private `PostgresTableInitializer` constructor lacked its
  semantic summary and all four parameter descriptions, while one-line TSDoc
  block openers in the initializer and table-spec source violated repository
  formatting rules.
- GREEN: documented the private constructor's lifecycle/schema/table/custom
  creation inputs and converted the three affected blocks to valid multiline
  TSDoc. No runtime behavior changed.
- Evidence: full `pnpm lint:tsdoc`, serial five-file focused suite (25/25),
  package `tsc --noEmit`, scoped ESLint, Prettier on changed package files and
  this log, `pnpm lint:cleanup`, and `git diff --check` all pass. Removed the
  ignored generated `packages/storage-postgres/dist/tsconfig.tsbuildinfo`.

## Slice 2 Mechanical Verification Dispatch

- Function: read-only mechanical verification; this is not a new project role.
- Expected profile: `gpt-5.6-luna` / `low`, passed explicitly in the dispatch;
  child spawning and file changes are prohibited.
- The verifier must independently check the focused suite, package typecheck,
  ESLint, Prettier, full TSDoc, cleanup/method-size enforcement, diff hygiene,
  ignored output, dependency boundaries, clean checkout, and local/remote SHA.
- The known `verify:task` Proto-manifest version failure is classified but not
  accepted as external debt: this branch changed package versions, so release
  integration must repair the generated manifest versions before final
  verification.

## Slice 2 Mechanical Verification Finding

- Actual verifier profile: immutable explicit dispatch `gpt-5.6-luna` / `low`;
  runtime self-introspection was unavailable. No files were changed.
- PASS: focused five-file suite (25/25), package typecheck, scoped ESLint,
  cleanup/method-size enforcement, dependency boundaries, diff hygiene,
  ignored-output scan, clean checkout, and matching local/remote SHA.
- FAIL: repository-wide `pnpm lint:tsdoc` reports an undocumented
  `PostgresTableInitializer` constructor and invalid TSDoc block openers in
  `table-initializer.ts` and `table-spec.ts`. Fresh orchestrator reproduction
  confirms the same eight diagnostics.
- The formatter wrapper could not find a bare `prettier` executable in its
  subprocess environment; this is a verification-command limitation, not a
  code finding. The correction batch must run the workspace Prettier CLI
  directly.
- `verify:task` independently reproduces the planned Proto manifest version
  mismatch before reaching tests. Release integration remains responsible for
  correcting that branch-created version inconsistency.
- Task 2 remains unaccepted. The same implementation author receives one
  correction batch: repair only the TSDoc findings, run the affected gates and
  focused suite, remove generated output, commit, and push.

## Slice 2 Acceptance

- The same implementation author corrected only the documented findings in
  `a331c5faf` and pushed it. No runtime behavior changed.
- Fresh orchestrator evidence passes full TSDoc, the serial five-file suite
  (25/25), package typecheck, cleanup enforcement, diff hygiene, clean-tree,
  generated-output, and local/remote SHA checks. Task 2 is accepted.

## Slice 3 Dispatch

- Existing role/function: continuing `implementer`, with explicit configured
  profile `gpt-5.6-terra` / `medium`; child spawning remains prohibited. The
  task surface does not expose runtime self-introspection, so the immutable
  configured role/profile is the available metadata.
- Scope is the coherent PostgreSQL record/query runtime: typed conversion,
  factory wiring and handle lifecycle, CRUD/batches/immutable writes, advisory-
  fenced CAS with exact bounded retry, and complete provider SQL pushdown.
- Strict focused RED/GREEN evidence is required. Driver doubles may isolate
  external I/O, but tests exercise production factory/storage paths and cannot
  add test-only APIs. Live PostgreSQL, histories, server atomic work, docs,
  release integration, and Proto-manifest correction remain later slices.

## Task 3 Column Conversion Checkpoint

- RED: `pnpm exec vitest run packages/storage-postgres/test/postgres-column-mapping.test.ts --maxWorkers=1`
  failed because the private `column-mapping.js` module did not exist.
- GREEN: added private PostgreSQL column conversion that preserves native
  bytes/float/double values, maps Timestamp to epoch nanoseconds and Version
  to its numeric value, and uses local schema-bound message stringifiers.
  It does not configure global `pg` type parsers.
- Evidence: the same focused test passes 4/4 and package
  `tsc --noEmit -p packages/storage-postgres/tsconfig.json` passes.

## Task 3 Implementation Handoff

- The continuing implementation context durably pushed the column-conversion
  checkpoint as `559796200`, then returned twice at the next record-runtime
  instruction without a command, edit, blocker, or new evidence. It is not a
  productive context for the remaining coherent slice.
- A fresh existing `implementer` receives the remaining factory/handle wiring,
  CRUD/batch/immutable, compare-and-set/retry, and query-pushdown work. The
  dispatch is explicitly `gpt-5.6-terra` / `medium`, prohibits children, and
  starts from the clean pushed checkpoint. This is a serialized handoff; only
  one production writer remains active.

## Task 3 Runtime Correction Handoff

- The replacement author pushed record runtime, cleanup, and batch
  characterization checkpoints through `73a2d9fc8`. Orchestrator inspection
  then found that an operation acquired a pool client before lazy table
  initialization acquired another, which can deadlock a pool limited to one
  client.
- The author corrected preparation order and added focused immutable/order
  coverage locally; typecheck, focused tests, ESLint, cleanup, formatting, and
  diff checks were reported green. Full TSDoc found 49 new documentation
  diagnostics. The author then returned repeatedly without applying that
  ordinary correction or producing the required checkpoint.
- A fresh existing `implementer` receives the preserved uncommitted runtime and
  test changes. Its first bounded responsibility is accurate TSDoc, complete
  immutable/order verification, log evidence, and a pushed checkpoint; it then
  continues CAS and query acceptance. Dispatch is explicit
  `gpt-5.6-terra` / `medium`, with no children. This remains a serialized
  handoff with one production writer.

## Task 3 Record Runtime Correction Checkpoint

- Existing role/function: continuing `implementer`, explicitly configured as
  `gpt-5.6-terra` / `medium`; no child work was dispatched and the execution
  surface does not expose runtime model metadata.
- Characterization: the inherited change moves lazy table preparation before
  operation-client acquisition. The new pool-size-one regression proves that
  `BEGIN` is not issued until the initializer has acquired and released its
  client. This prevents a handle from holding the only client while initialization
  waits for another.
- Characterization: the immutable collision test stores a Protobuf payload,
  simulates `ON CONFLICT DO NOTHING`, and returns the existing binary payload.
  A different payload rejects with the sanitized immutable-collision error.
- RED: the full `pnpm lint:tsdoc` gate failed before documentation correction,
  reporting 49 new runtime/factory contract diagnostics plus five TSDoc-format
  diagnostics. The report covered record lifecycle acquisition, constructor
  inputs, record operations, query capability/plan behavior, and the factory
  creation seam.
- GREEN: documented each affected runtime/factory contract accurately without
  suppression and corrected the TSDoc block layout. Fresh evidence passed full
  `pnpm lint:tsdoc`; `postgres-record-storage.test.ts` passed `4 passed (4)`;
  package `tsc --noEmit`; scoped ESLint; explicit Prettier; `pnpm lint:cleanup`;
  and `git diff --check`.
- Limitation: this checkpoint verifies driver-double behavior only; no live
  PostgreSQL provider is run in Task 3. CAS and normalized-query acceptance
  remain in this active task slice.

## Task 3 CAS and Query Characterization Checkpoint

- Existing role/function: continuing `implementer`, explicitly configured as
  `gpt-5.6-terra` / `medium`; no child work was dispatched.
- Fixture correction: an added CAS test initially failed because the preceding
  immutable test's custom driver implementation persisted across cases and made
  factory construction report a retired layout. Resetting the driver query
  implementation in `beforeEach` restored independent production-path fixtures;
  no runtime code changed for this correction.
- GREEN characterization: a `40001` on the first `BEGIN` rolls back, acquires a
  fresh operation client, and retries exactly once through advisory lock, row
  check, upsert, and commit. The focused test observed two client acquisitions
  and `BEGIN`, `ROLLBACK`, `BEGIN`, `COMMIT`.
- GREEN characterization: normalized ID selection compiles to one fully
  qualified SQL statement with `$1`, `$2`, and candidate-bound `$3`; 1,000 IDs
  reject at the common bind budget before client acquisition. The focused record
  suite passed `7 passed (7)`.
- Limitation: this is partial Task 3 acceptance. The declared-column comparison,
  nested predicate, continuation/null-order, RecordQuery window, immutable-race,
  and non-retry error matrices remain to be expanded before Task 3 can be
  accepted.

## Task 3 Immutable Disappearance Race

- RED: the focused record suite failed `accepts an immutable insert when a
conflicting row disappears before inspection`: `ON CONFLICT DO NOTHING`
  followed by no selected row reported an immutable collision.
- GREEN: after a non-inserting immutable insert, an absent row now has the same
  successful race disposition as the MySQL adapter; an identical row still
  succeeds and a differing decoded payload still rejects. The focused suite
  passed `8 passed (8)`, package typecheck, scoped ESLint, Prettier, and
  `git diff --check`.

## Task 3 Query and CAS Matrix Characterization

- Characterization: after aligning the test fixture's declared nullable `value`
  column with its catalog row, production-path tests verified all five normalized
  comparisons, nested `all`/`either`, a declared descending order, mask admission,
  and candidate-limit-plus-one SQL bounds. Each uses numbered PostgreSQL binds.
- Characterization: `RecordQuery` filtering with null compiles through `IS NOT
DISTINCT FROM`; an ascending null continuation emits `IS NOT NULL` rather than
  a comparison to null, and ordering emits `ASC NULLS FIRST`.
- Characterization: compare-and-set retries one complete transaction with fresh
  clients for both `40001` and `40P01`, including rollback before retry. A `23505`
  error does not retry, rolls back, releases the client once, and surfaces the
  sanitized provider operation error. The focused record suite passed `17 passed
(17)`.

## Task 3 Query Bind and Rejection Boundaries

- Characterization: 999 normalized ID parameters compile successfully with the
  candidate bound as `$1000`; 1,000 IDs continue to reject before acquisition.
  An empty `RecordQuery.ids` returns an empty result without client acquisition.
  An unknown normalized column rejects before initialization or acquisition.
- GREEN evidence: the focused record suite passed `20 passed (20)`. These tests
  exercise the factory-created runtime handle and driver boundary only.

## Task 3 CAS Outcome and Lock Identity Characterization

- Characterization: a differing stored payload returns `false` from
  compare-and-set without issuing an insert, while its transaction still
  commits. Absent-row conditional creation remains covered by the retry cases.
- Characterization: transaction advisory-lock values differ for distinct record
  IDs in the same database/schema/table identity domain. The focused record
  suite passed `22 passed (22)`.

## Task 3 Writer Completion

- The continuing implementation author completed and pushed the record/query
  slice through `25ed738e5`. The final serial Task 1-3 PostgreSQL suite passed
  58/58. Package typecheck, scoped ESLint, Prettier, full TSDoc, cleanup rules,
  diff hygiene, generated-output cleanup, clean-tree, and local/remote SHA
  checks passed.
- Coverage includes immutable identical/collision/disappearance paths,
  sanitized write failure/release, CAS mismatch/absent/retry/non-retry/second-
  retry cleanup, advisory identity, factory/handle closure and post-close
  rejection, normalized and RecordQuery bounds/null/order/continuation behavior,
  stable tie decoding, and overflow rejection.
- Live PostgreSQL behavior remains intentionally outside Task 3 and is not
  claimed by this evidence.

## Task 3 Mechanical Verification Dispatch

- Function: independent read-only mechanical verification, not a new project
  role. Explicit dispatch is `gpt-5.6-luna` / `low`; child spawning and edits
  are prohibited. Runtime self-introspection may be unavailable, so the
  immutable dispatch profile is the expected metadata.
- Verify the seven-file serial suite, package typecheck, scoped ESLint,
  Prettier, full TSDoc, cleanup/method-size/ledger enforcement, diff hygiene,
  generated output, dependency/public-export boundaries, clean checkout, and
  matching local/remote SHA. Inspect the Task 3 matrix for named acceptance
  coverage and report omissions without editing.

## Task 3 Acceptance

- Independent mechanical verification used the explicitly dispatched immutable
  `gpt-5.6-luna` / `low` profile; runtime self-introspection was unavailable.
  It made no changes.
- PASS: seven serial files and 58/58 tests, package typecheck, scoped ESLint,
  Prettier, full TSDoc, cleanup/method-size/T-0230 ledger enforcement, diff
  hygiene, generated-output scan, dependency/public-export boundaries, clean
  checkout, and matching local/remote SHA at `b1a53c4b9`.
- The verifier confirmed every named Task 3 acceptance category is represented
  by production-path driver-double evidence. It reported no finding. Task 3 is
  accepted; live PostgreSQL remains Task 5 evidence.

## Slice 4 Dispatch

- Existing role/function: continuing `implementer`, explicitly configured as
  `gpt-5.6-terra` / `medium`; child spawning remains prohibited. Runtime
  self-introspection may be unavailable, so the immutable role/profile is the
  expected metadata.
- Scope is Entity current/state/event handles with bounded 128-key provider SQL
  history, atomic Entity commit, and fenced Inbox cleanup. The binding current
  JVM history sources were freshly reread at the recorded upstream SHAs; the
  accepted PostgreSQL locking/page/close plan supplies provider mechanics not
  defined by JVM.
- Strict production-path RED/GREEN checkpoints, advisory-lock/resource evidence,
  and frequent pushed commits are mandatory. Live PostgreSQL, docs/release
  integration, Proto-manifest correction, and Task 5+ work remain excluded.

## Task 3 RecordQuery Window Characterization

- Characterization: a finite RecordQuery offset compiles to bound PostgreSQL
  `LIMIT` and `OFFSET`, and descending declared ordering explicitly emits
  `NULLS LAST`. The focused record suite passed `23 passed (23)`.

## Task 3 Remaining Record Acceptance Characterization

- Characterization: an immutable conflict with byte-identical Protobuf payloads
  succeeds. A driver write failure is sanitized to the provider operation error
  and releases the acquired client.
- Characterization: a second retryable CAS failure stops after exactly one retry,
  rolls back both transactions, and releases both clients.
- Characterization: factory close closes live record handles once, begins one
  pool drain, and the base factory lifecycle rejects later record creation.
- Characterization: decoded rows retain PostgreSQL result order under the stable
  declared-column/ID tie sort. A normalized plan requests candidate-limit-plus-one
  rows and shared evaluation rejects an overflow candidate set.
- GREEN evidence: the focused record suite passed `29 passed (29)`. This closes
  the Task 3 driver-double acceptance matrix; live PostgreSQL remains explicitly
  outside this slice.

## Task 3 Record Runtime Checkpoint

- Existing role/function: continuing `implementer`, configured explicitly as
  `gpt-5.6-terra` / `medium`; no child work was dispatched. Runtime profile
  introspection is unavailable on this surface.
- RED: `pnpm --config.verify-deps-before-run=false exec vitest run
packages/storage-postgres/test/postgres-record-storage.test.ts --maxWorkers=1`
  failed with `PostgreSQL record storage is not implemented.` from the factory
  creation seam. This proved the test reached the production factory path.
- GREEN: introduced the private PostgreSQL record handle and factory wiring.
  A factory-created handle selects its tenant database/schema, resolves the
  table spec/name, copies configured stringifiers, lazily initializes its table,
  registers/unregisters with factory close, emits fully-qualified quoted table
  names, binds record IDs and Protobuf binary payloads as `$n` parameters, and
  uses PostgreSQL upsert syntax.
- GREEN evidence: the focused test passes `1 passed (1)`; package
  `tsc --noEmit` and scoped ESLint over the changed runtime/test files pass.
  This checkpoint intentionally precedes the remaining Task 3 batch,
  immutable/CAS, and query behavior coverage.

## Task 3 Cleanup Correction

- Corrected every cleanup finding in the Task 3 runtime, including the
  PostgreSQL column-mapping test. The explicit ignored generated output was
  `packages/storage-postgres/dist/tsconfig.tsbuildinfo`; it was removed.
- Added the task-specific `T-0230` standalone-function necessity partition and
  taught the cleanup checker to route `storage-postgres` sources to that
  partition. The existing `T-0080H` ledger was restored unchanged.
- GREEN evidence: `pnpm lint:cleanup -- ...` passed, package typecheck and
  scoped ESLint passed, serial Task 1–3 PostgreSQL tests passed `30/30`, and
  `git diff --check` passed.

## Task 3 Batch Characterization

- Focused batch behavior observes one PostgreSQL transaction and preserves the
  supplied record order in bound upsert parameters. This test passed directly
  because the provisional runtime already contained the transaction path; it
  is characterization evidence rather than a new RED/GREEN implementation.
- Evidence: the focused record suite passes `2/2`; package typecheck, scoped
  ESLint, cleanup enforcement, and `git diff --check` pass.

## Task 4A Entity Handle Wiring

- Existing role/function: continuing sole `implementer`, explicitly configured
  `gpt-5.6-terra` / `medium`; no child work was dispatched.
- RED: the factory-created Entity production-path test failed with
  `TypeError: factory.createEntityStorage is not a function`.
- GREEN: added the private PostgreSQL Entity-handle seam. It creates a tracked
  current-record handle through the existing factory path and exposes disabled
  state/event ports when histories are disabled. Factory close closes and
  unregisters the current handle.
- Evidence: the focused Entity test passed `1 passed (1)`; package typecheck,
  scoped ESLint, Prettier, full TSDoc, cleanup rules, and diff hygiene passed.
- Limitation: enabled bounded state/event histories, atomic Entity commit, and
  fenced cleanup remain active Task 4 work.

## PostgreSQL Catalog INT Compatibility

- RED: the generated state-history `version` layout exposed that PostgreSQL
  `information_schema.columns.data_type` reports `integer`, while the provider
  declared canonical `INT`; literal comparison rejected the compatible layout.
- GREEN: table inspection now recognizes `integer` as PostgreSQL's catalog form
  of declared `INT`. The focused initializer suite passed `12 passed (12)`.

## Task 4A Bounded PostgreSQL State History

- RED: enabled state append rejected through the disabled SPI port. A close-race
  test also exposed synchronous post-close append failure instead of the port's
  rejected Promise behavior.
- GREEN: factory-created Entity handles now create grouped PostgreSQL state and
  event record families. State append uses shared transaction family and
  canonical Entity locks; bounded reads use entity predicates and limits;
  trim and truncate use 128-key pages, session locks, per-page transactions,
  and a bound truncate high-water key. Closing the handle closes grouped state
  storage and lets an acquired page settle without beginning another.
- Failure characterization: an injected delete failure rolls back the page,
  releases and unlocks its client, retains the operation error, and a later
  call reprocesses the same key. Event history append and bounded truncate use
  their separate family lock domain.
- Evidence: focused Entity-history suite passed `9 passed (9)`; package
  typecheck, scoped ESLint, cleanup enforcement, Prettier, and diff hygiene
  passed. Driver doubles cover provider SQL and resource behavior; live
  PostgreSQL concurrency remains outside this checkpoint.
- Full checkpoint evidence: serial `packages/storage-postgres/test` passed
  `8 files, 68 tests`; package `tsc --noEmit`, scoped ESLint, Prettier,
  full `lint:tsdoc`, `lint:cleanup`, and `git diff --check` passed. No
  generated output was retained.

## Task 4B Architecture Escalation

- RED: the internal registry rejects PostgreSQL atomic Entity commit until the
  provider registers its capability. Factory registration and a tracked handle
  made construction green; a current-record-only prototype also reached one
  PostgreSQL transaction and Entity advisory lock.
- The prototype is deliberately uncommitted and incomplete. It cannot yet bind
  the current locked read, grouped immutable state/diagnostic appends, delivery-
  event appends, and current write to one supplied client. Committing that body
  would falsely claim atomic Entity behavior.
- This is a demonstrated package-architecture blocker: the private record and
  history executor needs the smallest semantic extension for caller-managed-
  client work, while pools, clients, raw SQL, and provider helpers remain
  outside the public root and common SPI.
- Existing function: `requirements_splitter`, explicitly configured
  `gpt-5.6-sol` / `high`, no history and no child spawning. It receives a
  read-only bounded design task for executor shape, preparation/lock order,
  retry boundary, lifecycle, and TDD slices. Runtime self-introspection may be
  unavailable; immutable configured role/profile is the expected metadata.
  The sole production writer is paused during this pass.

## Task 4B Architecture Result and Handoff

- The read-only architecture pass completed with no edits. It confirmed no
  common SPI or public-root change is required and rejected the current-only
  prototype as falsely incomplete.
- It found and resolved a task-brief contradiction: atomic commit must preserve
  the accepted family → Entity → row lock order, not take Entity before family.
  State history and atomic commit also need one table-independent Entity domain
  based on database/schema/source type/logical Entity key; record CAS remains a
  separate domain.
- Accepted private shape: a generic package-local record executor with supplied-
  client read/preflight/append/write operations; a fresh-client exact-retry
  coordinator; and a per-call temporary current/state/diagnostic/delivery bundle
  prepared fully before transaction acquisition and closed in `finally`.
- The existing implementation context could not complete this refactor. A fresh
  existing `implementer`, explicitly configured `gpt-5.6-terra` / `medium`,
  receives the preserved uncommitted RED/prototype and the bounded architecture
  result. Child spawning is prohibited. This is a serialized handoff; there is
  still only one production writer.

## Task 4B Validation and Lifecycle Slice

- Existing role/function: continuing sole `implementer`, explicitly configured
  `gpt-5.6-terra` / `medium`; no child work was dispatched. Runtime profile
  introspection is unavailable on this surface.
- RED: the dedicated `postgres-entity-commit.test.ts` test passed a nonempty
  state-history array to an Entity with state history disabled. The preserved
  current-only prototype incorrectly resolved `committed`.
- GREEN: the private commit handle now rejects disabled state or diagnostic
  history, incompatible source/context boundaries, malformed Entity records,
  and blank or duplicate event IDs before creating temporary records or
  acquiring an operation client. Its close is idempotent, unregisters the
  tracked handle, and rejects later commits without a client acquisition.
- Evidence: focused serial commit coverage passed `4/4`; package
  `tsc --noEmit` passed. The fixture uses the actual packed `StringValue`
  decoder rather than a placeholder. The following prepared-family and
  transaction-order slice remains active.

## Task 4B Prepared Transaction Slices

- GREEN: temporary current and optional state families are opened per call,
  prepared sequentially, then closed in `finally`; the coordinator acquires one
  fresh operation client only after preparation and retries exactly once for
  raw PostgreSQL `40001`/`40P01` failures with rollback and release.
- GREEN: current reads use `FOR UPDATE`; complete Protobuf-byte equality makes
  a stale current result `conflict` without an insert, while an identical next
  record remains an idempotent replay.
- Evidence: focused serial commit coverage passed `8/8`; package typecheck
  passed. Full immutable append/failure-injection and two-factory close-race
  matrices remain active.

## Task 4B Lock Identity Correction

- GREEN: package-local record lock hashing now takes explicit identity parts
  after the captured database/schema. Family callers supply the qualified
  history table, and state history plus atomic commit share the
  `entity-mutation` source-type/logical-Entity identity.
- Evidence: focused commit/history serial coverage passed `17/17`; the commit
  suite directly compares advisory key parameters from a state append and an
  atomic state commit and passed `9/9` after the assertion.

## Task 4B Transaction Failure Characterization

- GREEN: an injected Entity advisory-lock failure rolls back the started
  transaction and releases the operation client. Focused commit coverage passed
  `10/10` after deterministic driver-state reset before each test.

## Task 4B Completion Handoff

- Existing role/function: serialized replacement `implementer`, explicitly
  configured `gpt-5.6-terra` / `medium`; child work is prohibited. Runtime
  profile introspection is unavailable on this surface. The author preserves
  the committed validation, current-conflict, and lock-identity slices and is
  completing the remaining transaction-failure, immutable-replay, independent-
  factory, and lifecycle evidence in the dedicated commit suite.

## Task 4B Immutable, Failure, And Lifecycle Completion

- RED: the commit suite initially covered only one advisory-lock error. It did
  not establish that any later failure discarded writes already staged by the
  transaction, that all optional record families were used, or that a factory
  close let an already-started commit release its client.
- GREEN: the same focused suite now uses a transaction-aware `pg` driver
  double. It makes writes durable only at `COMMIT`, discards staged writes at
  `ROLLBACK`, and can delay the locked-current query while factory drain is
  pending. One table-driven test injects failures at both family locks, the
  Entity lock, locked read, each immutable preflight and append, current write,
  and commit. Each case proves rollback and zero durable writes.
- GREEN: direct factory/record-executor coverage now proves successful state,
  diagnostic, and delivery writes; byte-identical immutable delivery replay;
  a divergent immutable delivery collision without a current-row update; two
  independently constructed factories agreeing on current-row replay and
  conflict; and active work releasing before the factory pool drain finishes.
- Evidence: focused serial commit suite passed `15/15`; the complete serial
  PostgreSQL package suite passed `83/83`; package `tsc --noEmit` and scoped
  ESLint, full TSDoc, cleanup/method-length enforcement, Prettier, and
  `git diff --check` passed. Commit `acbde1cec` was pushed to `origin`; local
  and remote branch heads matched and the checkout was clean.

## Task 4B Mechanical Verification Dispatch

- Function: independent read-only mechanical verification of the complete
  Task 4B endpoint; this is not a new project role.
- Expected profile: `gpt-5.6-luna` / `low`, passed explicitly in the dispatch;
  child spawning and file changes are prohibited. Runtime self-introspection
  may be unavailable, so the immutable explicit dispatch is the available
  profile evidence.
- The verifier must independently rerun the focused and full package tests,
  package typecheck, scoped ESLint, full TSDoc, cleanup/method-length,
  Prettier, diff hygiene, generated-output inspection, and local/remote SHA
  checks. It must also inspect the transaction-aware assertions for false
  positives without changing files.

## Task 4B Mechanical Verification Result

- Actual profile evidence: the immutable dispatch explicitly selected
  `gpt-5.6-luna` / `low`; runtime self-introspection was unavailable. The
  verifier made no changes.
- Independent evidence at `73086a804`: focused Entity-commit coverage passed
  `15/15`; the complete serial PostgreSQL package suite passed `83/83`;
  package typecheck, scoped ESLint, full TSDoc, cleanup/method-length,
  Prettier, and `git diff --check` passed. The checkout was clean, contained no
  generated/untracked output, used the official `origin`, and matched the
  remote branch SHA.
- Read-only assertion inspection confirmed that the production factory,
  executors, coordinator, and SQL paths cover both family locks, Entity lock,
  locked current read, every immutable preflight/append family, current write,
  commit rollback, replay/collision, independent factories, and close/drain
  lifecycle without an identified false-positive gap. Task 4B is accepted.
- `pnpm proto:check-generated` remains blocked by the branch-created release
  integration mismatch: `packages/proto/package.json` is
  `2.0.0-snapshot.13`, while `spine-proto-manifest.json` still records
  `2.0.0-snapshot.12`. Task 6 must regenerate/correct that manifest before
  release verification; it is not a Task 4B runtime finding.

## Task 4C Implementation Dispatch

- Existing role: `implementer`; responsibility is the bounded PostgreSQL
  fenced-Inbox cleanup slice and its focused tests. No other production writer
  may edit overlapping files.
- Explicit dispatch profile: `gpt-5.6-terra` / `medium`; child spawning is
  prohibited. Runtime self-introspection may be unavailable, so the immutable
  configured role/profile and explicit dispatch fields are the acceptance
  evidence.
- Scope is limited to registering tracked cleanup handles, one-client exact-
  snapshot cleanup with matching session-record fencing, exact retry/resource
  behavior, close/drain lifecycle, and production-path tests. Common SPI,
  MySQL, server behavior, live PostgreSQL, docs/release integration, and
  versions remain excluded.

## Task 4C Completion Handoff

- The first Task 4C author pushed registration/session-lock alignment, exact
  stale/cancelled snapshot behavior, and serialization-retry checkpoints
  through `03645ef55`, then returned twice while explicitly reporting the
  remaining non-retry and close/drain matrix incomplete. The checkout is clean
  at that pushed boundary.
- A serialized replacement `implementer`, explicitly configured as
  `gpt-5.6-terra` / `medium`, receives only the unfinished transaction-failure,
  cancellation-boundary, two-factory, and lifecycle evidence. Child spawning
  is prohibited. There is still one production writer, and the accepted
  cleanup design plus existing tests remain unchanged.

## Task 4C Registry RED

- RED: the new real-factory cleanup-registry test failed as expected with
  `StorageFactory does not provide atomic delivery cleanup storage.` The
  PostgreSQL factory had not registered the existing provider cleanup seam.
  The focused test is the starting contract for the remaining cleanup path.

## Task 4C Registration And Fencing Green

- GREEN: PostgreSQL now registers factory-tracked cleanup handles. A cleanup
  call opens and prepares the two exact record families, uses a single
  transaction client, locks the session row with the same advisory identity as
  record compare-and-set, reads session and Inbox snapshots with `FOR UPDATE`,
  and deletes only after exact/current checks.
- GREEN: focused real-factory coverage passed `2/2`, including direct equality
  between the cleanup session-lock parameter and ordinary session
  compare-and-set. Package typecheck, scoped ESLint, full TSDoc, and cleanup
  rules passed. Retry, every rollback boundary, cancellation, and close/drain
  matrices remain active.

## Task 4C Snapshot And Admission Green

- GREEN: the focused production-path suite now proves a changed locked session
  snapshot returns `false` without an Inbox `DELETE`, and an already-cancelled
  operation returns `false` before either cleanup record family is opened.
- Evidence: focused cleanup coverage passed `4/4`. The transaction-aware
  rollback/retry and close/drain cases remain to be added before Task 4C can be
  accepted.

## Task 4C Retry Green

- GREEN: a transaction-aware cleanup driver now stages Inbox deletion until
  `COMMIT`. A raw PostgreSQL `40001` commit failure rolls back that staged
  deletion, obtains a fresh transaction attempt, and commits the retry.
- Evidence: focused cleanup coverage passed `5/5`; the retry test observed one
  `ROLLBACK` and verified the Inbox row was removed only by the successful
  attempt. Non-retry and close/drain cases remain active.

## Task 4C Completion

- RED: cancellation immediately after the session advisory lock still read both
  snapshots; cancellation immediately after the session read still read the
  Inbox; and cancellation after a staged `DELETE` was wrapped as an operation
  error instead of returning `false` after rollback. Focused production-path
  tests failed for each behavior before the correction.
- GREEN: cleanup now checks the cooperative operation boundary after taking the
  session lock and after reading the session. The coordinator preserves its
  internal cancellation result through rollback so the public cleanup call
  returns `false`, and the staged Inbox deletion is not committed.
- GREEN: the transaction-aware real-factory suite now covers missing,
  replaced, and byte-different current snapshots; stale session replacement
  through a second PostgreSQL factory; cancellation before opening, after lock,
  after session read, and after staged deletion; all operation boundaries;
  ordinary non-retry; `40001` and `40P01` one-retry behavior with four fresh
  client acquisitions; closed-handle and closed-factory admission; in-flight
  cleanup while pool draining; idempotent close; and a contained pool-drain
  rejection. It makes Inbox changes durable only at `COMMIT` and discards them
  at `ROLLBACK`.
- Evidence: `pnpm exec vitest run
packages/storage-postgres/test/postgres-delivery-cleanup.test.ts
--maxWorkers=1` passed `23/23`. The serial PostgreSQL package suite passed
  `106/106`; package `tsc --noEmit`, scoped ESLint, full TSDoc, cleanup rules,
  Prettier, and `git diff --check` passed. No generated output was retained.

## Task 4 Mechanical Verification Dispatch

- Function: independent read-only mechanical and assertion verification of the
  complete Task 4 endpoint at `afbc1c220`; this is not a new project role.
- Expected profile: `gpt-5.6-luna` / `low`, passed explicitly in the dispatch;
  child spawning and file changes are prohibited. Runtime self-introspection
  may be unavailable, so the immutable explicit dispatch is the profile
  evidence.
- The verifier must rerun all PostgreSQL tests serially and every deterministic
  package gate, inspect history/commit/cleanup tests for production-path and
  false-positive gaps, check generated output and the official remote SHA, and
  report the known Proto-manifest version mismatch separately from Task 4.

## Task 4 Mechanical Verification Findings

- Actual profile evidence: the immutable dispatch explicitly selected
  `gpt-5.6-luna` / `low`; runtime self-introspection was unavailable. The
  verifier made no changes.
- Independent evidence at `579f64a5b`: all `10` PostgreSQL test files passed
  `106/106`; package typecheck, scoped ESLint, full TSDoc,
  cleanup/method-length, Prettier, and `git diff --check` passed. The checkout
  was clean, contained no untracked output, used the official `origin`, and
  matched the remote SHA. Production factory, record, transaction, lock, and
  coordinator paths were exercised without test-only runtime APIs.
- Accepted findings: Task 4 lacks explicit two-factory append-vs-truncate and
  append-vs-trim coordination tests, and event-history truncation lacks direct
  multi-page/high-water coverage. These are required Task 4A concurrency and
  symmetry claims, so Task 4 is not accepted until one correction batch adds
  this evidence and fixes any behavior it exposes.
- Live-provider behavior remains intentionally unverified until Task 5. The
  known Proto manifest snapshot mismatch remains Task 6 release integration.

## Task 4 Verification Correction Dispatch

- Existing role: `implementer`; responsibility is limited to the three
  accepted history-test findings and any PostgreSQL history defect those tests
  expose. No other production writer may edit overlapping files.
- Explicit dispatch profile: `gpt-5.6-terra` / `medium`; child spawning is
  prohibited. Runtime self-introspection may be unavailable, so the immutable
  configured role/profile and explicit dispatch fields are the acceptance
  evidence.
- Common SPI, MySQL, server behavior, live-provider setup, documentation,
  release integration, Proto, and versions remain excluded.

## Task 4 Verification Corrections

- RED: the prior suite did not directly demonstrate two-factory coordination
  for append versus global truncation, append versus state trim, or event-
  history multi-page high-water truncation.
- GREEN: a coordinated production-path driver now proves an append waits while
  event truncation holds the exclusive family lock across a 128-key page and
  its next page, then resumes after unlock; state append and trim preserve
  family → Entity order without inter-page mutation; event truncation deletes
  two ID-only 128-key pages under one stable high-water boundary without a
  payload scan.
- Existing runtime behavior passed these new tests, so no production source
  changed. Focused history coverage passed `12/12`; the complete serial
  PostgreSQL package suite passed `109/109`; package typecheck, scoped ESLint,
  full TSDoc, cleanup/method-length, Prettier, and `git diff --check` passed.
  Commit `8fdcf1114` is pushed, the checkout is clean, and local/remote SHAs
  match.

## Task 4 Affected-Concern Reverification Dispatch

- Function: independent read-only reinspection of only the three corrected
  Task 4 history concerns; this is not a new project role.
- Expected profile: `gpt-5.6-luna` / `low`, passed explicitly in the dispatch;
  child spawning and file changes are prohibited. Runtime self-introspection
  may be unavailable, so the immutable explicit dispatch is the profile
  evidence.
- Reverification must rerun the focused history suite and inspect that the new
  assertions exercise two real factory paths, production locks, ID-only pages,
  stable high-water behavior, and blocked/resumed append ordering without a
  false-positive test-double shortcut.

## Task 4 Affected-Concern Reverification Result

- Actual profile evidence: the immutable dispatch explicitly selected
  `gpt-5.6-luna` / `low`; runtime self-introspection was unavailable. The
  verifier made no changes.
- Focused history coverage independently passed `12/12`. Read-only inspection
  confirmed two independently constructed factories, production advisory-lock
  calls, append blocked until maintenance unlock, matching family → Entity
  order for state append/trim, exactly two 128-key Event ID pages, no payload
  selection, one stable high-water tuple, and later-append retention. Scoped
  ESLint, Prettier, diff hygiene, clean-tree, official-remote, and local/remote
  SHA checks passed at `b1b33ed95`.
- No finding remains from the affected-concern recheck. Task 4 is accepted.

## Task 5 Live-Acceptance Dispatch

- Existing role: `implementer`; responsibility is the explicit PostgreSQL live
  acceptance harness, package command, and PostgreSQL 16/18 behavior suite. No
  other production writer may edit overlapping files.
- Explicit dispatch profile: `gpt-5.6-terra` / `medium`; child spawning is
  prohibited. Runtime self-introspection may be unavailable, so the immutable
  configured role/profile and explicit dispatch fields are the acceptance
  evidence.
- `SPINE_TS_POSTGRESQL_URL` is currently unset and `psql` is unavailable.
  Docker is installed, but the accepted task explicitly forbids automatic
  container startup. The author must implement deterministic fail-fast
  preflight and the live suite without inventing container management; actual
  PostgreSQL 16 and 18 execution remains a reported external-input blocker
  until explicit URLs are supplied.

## Task 5 Live-Acceptance Harness

- RED: the stable infrastructure-inventory test failed after it was changed to
  require a PostgreSQL live-test file and package command. The package had
  neither, so the failure proved that ordinary Vitest selection had no explicit
  PostgreSQL live path. A second preflight check failed with the expected
  missing `SPINE_TS_POSTGRESQL_URL` message before Vitest could start.
- GREEN: `@spine-event-engine/storage-postgres` now provides
  `test:postgresql`, plus `test:postgresql:16` and `test:postgresql:18`.
  Every command requires explicit `SPINE_TS_POSTGRESQL_URL`,
  `SPINE_TS_POSTGRESQL_TENANT_A_URL`, and
  `SPINE_TS_POSTGRESQL_TENANT_B_URL`; it starts neither Docker nor a fallback
  provider. The `:16` and `:18` commands set an expected major. The live test
  opens all three configured databases, runs `SHOW server_version_num` on each,
  requires PostgreSQL 16 or later, and requires the selected major when one was
  requested.
- The live suite is registered only in the infrastructure inventory. It uses
  public factory/provider paths to cover table/catalog initialization,
  CRUD/query/CAS, concurrent two-factory CAS, tenant database isolation,
  atomic Entity commits, bounded state-history trim/truncate, concurrent Entity
  commit conflict, and factory/record lifecycle. The existing server Inbox
  cleanup suite now has a real `postgresql` provider block with two independent
  `PostgresStorageFactory` instances, proving exact delivered-row removal and
  stale-session fencing through production Inbox paths. The command explicitly
  selects both provider test files, so no PostgreSQL cleanup test is silently
  skipped.
- Retry injection is deliberately not simulated in the live suite: the public
  factory has no test-only fault hook, and a real deadlock/serialization test
  would require a privileged, timing-sensitive external setup. The existing
  hermetic provider tests continue to prove the bounded retry and rollback
  paths. Live execution proves the public success/concurrency/lifecycle paths
  without adding a test-only runtime API.
- Mechanical evidence: the missing-URL command stopped before Vitest with the
  expected message; invalid expected major `15` was rejected before Vitest;
  the serial hermetic PostgreSQL plus provider-selection and infrastructure
  suites passed `115/115`; package and server no-emit typechecks passed;
  scoped ESLint, full TSDoc, cleanup/method-length enforcement, Prettier, and
  `git diff --check` passed. Standard generated build output was rebuilt before
  tests and will be removed before recording the checkpoint.
- External evidence remains blocked: no PostgreSQL URL is configured and
  automatic Docker startup is prohibited. Therefore no PostgreSQL 16 or 18
  command has run against a live server, and this task does not claim either as
  passed.

## Task 5 Harness Verification Dispatch

- Function: independent read-only mechanical and version-specific review of
  the Task 5 harness at `38b692714`; this is not a new project role.
- Expected profile: `gpt-5.6-luna` / `medium`, passed explicitly in the
  dispatch because the check includes package commands and PostgreSQL-version
  claim validation. Child spawning and file changes are prohibited. Runtime
  self-introspection may be unavailable, so the immutable explicit dispatch is
  the profile evidence.
- The verifier must confirm fail-fast behavior, infrastructure-only inventory,
  all-three-database version checks, non-skipped PostgreSQL Inbox coverage,
  public production paths, hermetic suite/gates, clean output/remote state, and
  the honest absence of live PostgreSQL 16/18 evidence.

## Task 5 Harness Verification Result

- Actual profile evidence: the immutable dispatch explicitly selected
  `gpt-5.6-luna` / `medium`; runtime self-introspection was unavailable. The
  verifier made no changes and started no service, container, or database.
- Read-only verification confirmed clear fail-fast errors for each of the
  three URL variables, rejection of expected major `15`, exact `:16`/`:18`
  command selection, `SHOW server_version_num` plus floor/requested-major
  checks on all three databases, infrastructure-only inventory, and an
  explicitly selected PostgreSQL Inbox suite using two public factory paths.
  Stable-inventory coverage passed `6/6`; TSDoc, cleanup, format, diff,
  clean-tree, official-remote, and local/remote SHA checks passed.
- PostgreSQL 16 and 18 remain unverified because no explicit URLs are
  configured and automatic Docker startup is prohibited. Task 5 cannot claim
  live completion until those external endpoints are supplied.
- The verifier could not reproduce the recorded `115/115` hermetic command
  after ignored workspace `dist` output had been correctly removed: clean
  package entrypoints were unresolved until dependency packages are rebuilt.
  This does not identify a Task 5 harness defect, but the evidence is not
  accepted as clean-checkout proof. Task 6 must first repair the known Proto
  manifest/version and release integration, then the dependency-aware final
  verification must rebuild and rerun these suites.

## Task 6 Documentation And Release Integration Dispatch

- Function: one serialized documentation/package/release-integration author;
  this is not a new project role. Explicit dispatch profile is
  `gpt-5.6-luna` / `medium`, appropriate for package, dependency, documentation,
  and version-specific integration. Child spawning is prohibited. Runtime
  self-introspection may be unavailable, so the immutable explicit dispatch is
  the profile evidence.
- Scope includes PostgreSQL user/setup/API documentation, TypeDoc and package
  inventories, artifact/release/build policies, root project/package metadata,
  internal dependency pins and lockfile, and correction/regeneration of the
  branch-created Proto snapshot.13 manifest mismatch. It must preserve the
  existing version-only commit and keep dependency/lock changes separate.
- No runtime semantics, MySQL behavior, live-service startup, third-party
  patching, or speculative feature is permitted.

## Task 6 Independent Verification Dispatch

- Function: independent read-only documentation, package, release-inventory,
  and generated-artifact verification of Task 6 at `40a040486`; this is not a
  new project role.
- Expected profile: `gpt-5.6-luna` / `medium`, passed explicitly in the
  dispatch; child spawning and file changes are prohibited. Runtime
  self-introspection may be unavailable, so the immutable explicit dispatch is
  the profile evidence.
- The verifier must check the beginner/reference accuracy, live-command
  variables, public export/TypeDoc expectations, every 19-package/27-path
  inventory, server dependency pin/lockfile, Proto manifest consistency,
  generated-output cleanliness, and whether the reported missing
  `protoc-gen-es` and ignored `.superpowers` readiness diagnostics affect the
  committed branch or require correction.

## Task 6 Integration Evidence

- RED: `pnpm proto:generate` initially failed because
  `packages/proto/spine-proto-manifest.json` still declared snapshot.12 while
  the workspace was snapshot.13. The release/package inventory tests also
  exposed the expected stale 18-public-package/26-path assumptions.
- GREEN: corrected the Proto manifest to snapshot.13; added the PostgreSQL
  package to the 19-public-package/27-release-path, publication, boundary,
  TypeDoc, audience, snippet, build-cleanup, release-readiness, and
  infrastructure inventories; added package README/REFERENCE assets; pinned
  package metadata and verified the existing `pg`/`@types/pg` lock entries;
  updated storage user guidance and removed the stale MySQL PostgreSQL claim.
- Documentation now describes URL/TLS/schema configuration, single and
  multitenant routing, lifecycle, first write/read, live test environment
  variables, PostgreSQL 16+ as an intended floor, and the absence of live
  PostgreSQL 16/18 evidence. Tenant examples name two distinct databases.
- Evidence: `pnpm proto:generate` passed; dependency-aware
  `pnpm typecheck:build:generated` passed; focused release/package/docs suite
  passed 64/64; TypeDoc API check, audience, cleanup, and TSDoc checks passed;
  `pnpm install --lockfile-only --offline` reported already up to date;
  Prettier and `git diff --check` were run. `check-generated-clean` could not
  complete in this environment because `protoc-gen-es` was unavailable on
  PATH; release readiness also reports pre-existing `.superpowers` internal
  history terms outside this integration diff.

## Independent Task 6 Verification Correction

- Finding: independent release verification at `4751dcbef` found eight
  branch-created `spine-proto-manifest.json` files still declaring
  `2.0.0-snapshot.12`: the four examples and four test-fixture packages.
- Correction: updated only those eight `packageVersion` fields to the common
  workspace version `2.0.0-snapshot.13`; no generated source, runtime code, or
  unrelated manifest content changed.
- Evidence: `pnpm proto:check-generated` and
  `pnpm proto:check-generated:current` both passed; focused Prettier checks and
  `git diff --check` passed. The correction is committed and pushed as the
  follow-up integration commit.
- Independent affected-concern reverification at `e7a661061` confirmed that
  local `HEAD` and `origin/add-postgresql-storage` match, the worktree is clean,
  all eight manifests declare `2.0.0-snapshot.13`, and both generated-source
  checks pass. No Task 6 Proto-manifest finding remains.

## Packaging Link Correction

- Finding: release preflight at `7adaaa55f` identified that the PostgreSQL
  README link in `packages/storage-rdbms/README.md` escaped the published
  tarball through a sibling filesystem path.
- Correction: replaced only that link with the stable public GitHub README URL
  used by the storage guide; runtime and release logic are unchanged.
- Evidence: focused release CLI, formatting, and diff checks are run for this
  correction; 16/17 focused release CLI tests passed. The one staged-consumer
  test was blocked when pnpm offline installation could not find
  `@grpc/grpc-js@1.14.5` in the local store; no packaging assertion failed.

## Declaration Dependency Correction

- Finding: packed PostgreSQL declarations import `PoolClient` from `pg`, while
  `pg` ships no declarations. Keeping `@types/pg` in devDependencies caused a
  clean external TypeScript consumer to report TS7016.
- Correction: moved exactly `@types/pg` version `8.23.1` from devDependencies
  to dependencies in `packages/storage-postgres/package.json` and regenerated
  only the corresponding pnpm-lock importer data. Versions, declarations,
  public APIs, release logic, and thresholds are unchanged.
- Evidence: `pnpm install --frozen-lockfile --offline` passed;
  `pnpm check:production-dependencies` passed; package metadata and release
  CLI tests passed 31/31, including the packed external consumer; focused
  formatting and diff checks passed.
- After the missing package was added only to pnpm's local cache, the same
  staged-consumer test reached TypeScript and found a real published-declaration
  defect: emitted PostgreSQL declarations import `PoolClient` from `pg`, while
  `@types/pg` is declared only as a development dependency. Because `pg` does
  not ship those declarations, clean consumers cannot compile.
- The package integration correction must move the exact pinned `@types/pg`
  version into runtime `dependencies` and update the lockfile importer. It must
  preserve the public types, strict consumer proof, and existing version; no
  fake local driver types or weakened release checks are permitted.

## Task 4 History Verification Correction

- Existing role/function: continuing sole `implementer`, explicitly configured
  `gpt-5.6-terra` / `medium`; child spawning was prohibited. Runtime profile
  introspection is unavailable on this surface, so the immutable configured
  role/profile is the available dispatch evidence.
- RED: the accepted concurrency and event-history assertions did not exist.
  The first focused execution of the new coordinated driver stopped before
  behavior ran because its pool-release spy and lock-release helper had the
  same name. Renaming the helper produced the intended two-client lock model;
  no PostgreSQL runtime defect was exposed.
- GREEN: two independently built `PostgresStorageFactory` instances now prove
  that an event append takes its shared family lock but cannot insert while a
  global event truncation holds the exclusive family lock through a 128-key
  page and its next page. It resumes only after the truncation unlocks. The
  state case proves the family-then-Entity order for both trim and append and
  that append cannot insert while trim holds its session locks. Direct event
  truncation coverage proves two 128-key ID-only pages use the frozen
  `(created, version, ID)` high-water boundary and never select payload bytes.
- Evidence: the focused serial Entity-history suite passed `12/12`; the full
  serial PostgreSQL package suite passed `109/109`; package
  `tsc --noEmit`, scoped ESLint, full TSDoc, cleanup/method-length enforcement,
  Prettier, and `git diff --check` passed. The correction changes only
  `postgres-entity-history.test.ts`; no generated output was retained.

## Final Cheap-Preflight Correction Dispatch

- The first converged preflight reached a clean dependency-aware production
  build, then `pnpm typecheck:tooling` failed on PostgreSQL test helpers and
  mocks. The failures are confined to test TypeScript: readonly assignment,
  exact-optional-property handling, incomplete coordinated-lock metadata,
  generated `Timestamp` construction, and mock functions whose inferred query
  result or tuple types are narrower than the exercised calls.
- One continuing implementation function receives this complete correction
  batch for the affected PostgreSQL tests only. Explicit dispatch profile is
  the existing `implementer` role configured as `gpt-5.6-terra` / `medium`;
  child spawning is prohibited. Production behavior and public contracts must
  not change to accommodate test mocks.
- Required evidence is a clean `pnpm typecheck:tooling`, the full hermetic
  PostgreSQL package suite, scoped ESLint and formatting, and `git diff
--check`. After correction, the entire cheap preflight restarts before
  specialist review.
- GREEN for the test-fixture batch: commit `a30b816e6` changes only the five
  assigned test files and this log. `pnpm typecheck:tooling`, the 109-test
  hermetic PostgreSQL suite, scoped ESLint and Prettier, and `git diff --check`
  pass; no production or public contract changed.
- The restarted preflight passed the dependency-aware build, tooling
  typecheck, scoped ESLint, cleanup rules, and TSDoc, then copyright checking
  found nine new PostgreSQL source/test files with missing or malformed
  CodeMatters headers. This deterministic header-only batch returns to the
  same implementation context; after correction, the complete preflight must
  restart again.
- GREEN for the header batch: commit `eb0c2b647` normalizes seven malformed
  headers and adds two missing headers without changing logic. Copyright,
  focused formatting, and diff hygiene pass.
- After removing ignored task-created `.superpowers/sdd` scratch from the
  repository checkout, the restarted deterministic gates passed through
  release readiness. The 109-test PostgreSQL coverage run passed every test
  but failed the required 90% thresholds: 85.61% statements, 78.94% branches,
  85% functions, and 89.14% lines. Coverage is lowest in history maintenance,
  ID conversion, record query/error paths, and factory lifecycle/error paths.
- The same `gpt-5.6-terra` / `medium` implementer receives one test-only
  coverage correction batch. Tests must demonstrate meaningful observable
  behavior; exclusions, ignored branches, threshold changes, broad casts, and
  production changes made only to satisfy coverage are prohibited. The full
  preflight restarts after all four metrics reach at least 90%.
- GREEN for coverage: commit `c19332941` expands observable behavior tests to
  140 passing tests with 93.89% statements, 90.01% branches, 93.43% functions,
  and 96.62% lines. Production code, thresholds, exclusions, and configuration
  are unchanged.
- The next complete preflight passed every deterministic gate and coverage.
  Its affected release/tooling suite passed 233 tests and found one packaging
  defect: `packages/storage-rdbms/README.md` linked to PostgreSQL through
  `../storage-postgres/README.md`, which escapes the published MySQL package
  tarball. The documentation integration context must replace it with the
  stable public repository/package documentation URL, then the full preflight
  restarts.

## Final Cheap-Preflight Test-Type Correction

- Existing role/function: continuing sole `implementer`, explicitly configured
  `gpt-5.6-terra` / `medium`; child spawning was prohibited. Runtime-profile
  introspection is unavailable on this surface, so the immutable configured
  role/profile is the available dispatch evidence.
- RED: `pnpm typecheck:tooling` failed only in the five assigned PostgreSQL
  test files. The errors demonstrated readonly counter mutation, missing
  coordinated-lock client metadata, exact-optional call recording, handwritten
  values in place of generated `Timestamp` messages, and `vi.fn()` query,
  result, and tuple inference narrower than exercised test calls.
- GREEN: test fixtures now preserve the same exercised behavior while using
  generated timestamp messages, explicit client metadata at lock release,
  immutable counter replacement, exact-optional call records, and local query
  and lifecycle fixture types. No production source, generated output, or
  public contract changed.
- Evidence: `pnpm typecheck:tooling` passed. `pnpm exec vitest run
packages/storage-postgres/test --maxWorkers=1` passed `10/10` files and
  `109/109` tests; the normal configuration excludes the live
  `postgresql-integration.test.ts`. Scoped ESLint and Prettier checks passed
  for all five files, and `git diff --check` passed.

## Final Cheap-Preflight Copyright Correction

- Existing role/function: continuing sole `implementer`, explicitly configured
  `gpt-5.6-terra` / `medium`; child spawning was prohibited. Runtime-profile
  introspection is unavailable on this surface, so the immutable configured
  role/profile is the available dispatch evidence.
- RED: the restarted cheap preflight reached `pnpm lint:copyright` after its
  build, tooling typecheck, scoped ESLint, cleanup, and TSDoc checks. The
  checker reported exactly four malformed source headers, one missing source
  header, three malformed test headers, and one missing test header in the
  PostgreSQL package.
- GREEN: normalized only those nine CodeMatters notices to the checker’s exact
  canonical Apache-2.0 header and preserved one blank separator after each.
  Runtime and test logic, public contracts, and generated output are unchanged.
- Evidence: `pnpm lint:copyright`, scoped Prettier on all nine header files,
  and `git diff --check` passed.

## PostgreSQL Coverage Correction

- Existing role/function: continuing sole `implementer`, explicitly configured
  `gpt-5.6-terra` / `medium`; child spawning was prohibited. Runtime-profile
  introspection is unavailable on this surface, so the immutable configured
  role/profile is the available dispatch evidence.
- RED: the required PostgreSQL coverage command passed its original `109/109`
  tests but failed every global threshold: statements `85.61%`, branches
  `78.94%`, functions `85.00%`, and lines `89.14%`. The coverage report
  identified unexercised ID conversion, factory configuration/catalog/schema,
  Entity history/current-record, record mutation/query, column mapping, and
  table-resolution behavior.
- GREEN: added behavior-focused tests for message and primitive ID conversion
  boundaries; factory configuration, server schema, and tenant catalog paths;
  Entity point-in-time state, history bounds/high-water/closed handles, and
  current-record forwarding; record read/delete/CAS/query paths; enum/null
  mapping; and grouped/explicit table resolution. Production source, thresholds,
  exclusions, ignored branches, and public contracts are unchanged.
- Evidence: `pnpm exec vitest run --coverage --maxWorkers=1
--coverage.include='packages/storage-postgres/src/**/*.ts'
packages/storage-postgres/test` passed `10/10` files and `140/140` tests:
  statements `93.89%` (`907/966`), branches `90.01%` (`496/551`), functions
  `93.43%` (`299/320`), and lines `96.62%` (`801/829`).
  `pnpm typecheck:tooling`, scoped ESLint, scoped Prettier, and `git diff
--check` also passed.

## Final Cheap Preflight Acceptance

- Review endpoint `84b60061b51ad1a053417b835b7594a5d0134024` is clean,
  pushed, and identical to `origin/add-postgresql-storage`.
- Dependency-aware build, tooling typecheck, scoped ESLint, cleanup and method
  limits, TSDoc, copyright, formatting, diff hygiene, documentation audience,
  TypeDoc/API, snippets, Proto lint/current-generated checks, logging
  containment, production-dependency policy, and release-readiness checks all
  pass.
- The full hermetic PostgreSQL coverage suite passes 140 tests with 93.89%
  statements, 90.01% branches, 93.43% functions, and 96.62% lines.
- The affected server/release/tooling suite passes 234 tests in 13 files. The
  release proof packs the packages and compiles a clean external TypeScript
  consumer against `@spine-event-engine/storage-postgres`.
- Live PostgreSQL 16 and 18 verification remains blocked only by the absence of
  the six approved database URLs. The implementation does not start Docker or
  replace that evidence with a fake provider.
- The final specialist wave uses the four existing relevant roles. Every
  dispatch records its explicit immutable role profile, review baseline and
  endpoint, complete human-requirements ledger, concern scope, read-only rule,
  and prohibition on child agents. Findings will be collected as one complete
  batch before any correction begins.

## Final Specialist Wave And Correction Dispatch

- Four independent read-only reviews completed against frozen endpoint
  `c09c961d6bf75e2cb90fb36fa2dc2c2e0882dd15`. Explicit role profiles were
  `style_maintainability_reviewer` at `gpt-5.6-terra` / `high`,
  `typescript_api_docs_reviewer` at `gpt-5.6-terra` / `high`,
  `performance_reliability_reviewer` at `gpt-5.6-terra` / `high`, and
  `documentation_reviewer` at `gpt-5.6-luna` / `medium`. Child spawning and
  writes were prohibited. Runtime-profile introspection is unavailable, so the
  immutable explicit role configurations are the accepted metadata.
- The complete wave produced twelve distinct accepted corrections after
  merging the duplicated grouped-table-name report. They cover grouped name
  routing, the binding JVM physical-name renderer, the private Entity seam,
  centralized retry classification, inclusive history continuation, current
  Entity defaults, whole-batch retry, safe session-lock cleanup, sanitized
  public errors, keyset state trimming, user-guide integration, and exact
  mapping/name documentation. `REVIEW.md` records the concrete batch.
- Existing role: one continuing `implementer` for the complete coherent batch.
  Explicit dispatch profile is `gpt-5.6-terra` / `medium`; child spawning is
  prohibited. This author is the sole production writer and may change the
  PostgreSQL package source/tests plus directly affected storage documentation
  and task records. No unrelated MySQL/runtime behavior may change.
- Runtime corrections require focused failing tests before production edits.
  Mechanical documentation and private-helper extraction may follow the proven
  behavior changes. Required evidence includes focused suites, full PostgreSQL
  coverage, tooling typecheck, build, scoped lint, cleanup/method limits,
  TSDoc, documentation/API/snippet checks, packaging/external-consumer proof,
  formatting, and diff hygiene. After correction, only substantively affected
  review concerns reopen before the final single `verify:release` run.

## Final Correction Implementation

- Continuing `implementer` dispatch: `gpt-5.6-terra` / `medium`; this surface
  does not expose runtime-profile introspection. The accepted role/profile is
  the immutable dispatch configuration.
- RED: focused history/name tests failed for inclusive `<=` continuation,
  stable trim keyset SQL, and Unicode identifier rendering. GREEN: the focused
  builder/name/history suite passed 24 tests, TypeScript compilation passed,
  and the hermetic PostgreSQL suite passed 140 tests in 10 files.
- Implemented grouped builder registration, the renderer's Unicode/UTF-8 and
  ASCII-folding behavior, private Entity seam, shared retry classifier,
  inclusive history continuations, stable state trim boundary/keyset pages,
  whole-batch retry, sanitized public operation wrappers, current Entity
  defaults, and durable-provider/mapping documentation. Session advisory unlock
  hardening and final deterministic gates remain in progress.

## Advisory Lock Cleanup Correction

- RED: focused PostgreSQL Entity-history tests proved that false and rejected
  session advisory unlocks were silently ignored for trim and both truncate
  paths. GREEN: 22 focused tests pass after each unlock result is checked.
- Cleanup-only failure now exposes a sanitized `PostgresStorageOperationError`
  and releases the affected `pg` client with an error so the pool discards it.
  If an operation already failed, that error remains observable while the same
  discard marker prevents a possibly locked client from returning to the pool.

## Private Entity Seam Test Correction

- GREEN: `pnpm typecheck:tooling` passes after PostgreSQL tests invoke the
  private runtime Entity seam through one typed `unknown` structural cast; the
  serial PostgreSQL suite passes 144 tests.

## Advisory Cleanup Control Flow

- GREEN: state and event truncation now capture operation failures, perform
  session cleanup, then select the original failure before any cleanup failure;
  focused history tests pass without `no-unsafe-finally` violations.

## PostgreSQL Coverage Correction

- Added observable current-Entity defaults, write-batch retry, builder routing,
  and tenant-bound rejection coverage. Exact coverage GREEN: 151 tests;
  statements `961/1019` (94.30%), branches `540/598` (90.30%), functions
  `310/326` (95.09%), and lines `844/873` (96.67%).

## Final Grouped Name And Retention Corrections

- RED/GREEN: grouped public-builder routing now has a DDL-facing regression:
  a three-argument registration prepares the custom grouped table while the
  ungrouped source still prepares its default table. Trim uses the frozen
  obsolete boundary inclusively, so `keep=0` deletes that first obsolete key
  and later 128-key pages continue from the same stable boundary.

## Private Entity-Seam Test Correction

- Independent post-correction verification passed the dependency-aware
  production build and the complete serial PostgreSQL suite (`144/144`), then
  `pnpm typecheck:tooling` found 26 test calls that still accessed the now-
  private `createEntityStorage` method directly. Focused Vitest transpilation
  does not typecheck those calls.
- The same `gpt-5.6-terra` / `medium` implementer receives one test-only batch:
  route every affected test through an explicit structural runtime-test helper,
  matching the server's real structural probe. Production visibility, runtime
  behavior, public declarations, and the private seam must remain unchanged.
- GREEN: commit `e045cfcc2` routes all affected tests through one typed
  structural helper. Tooling typecheck and the serial PostgreSQL suite
  (`144/144`) pass; production code and declarations are unchanged.

## Advisory Cleanup Control-Flow Correction

- The restarted preflight passed the dependency-aware build, tooling typecheck,
  and diff hygiene, then scoped ESLint rejected two throws from `finally` in
  state/event truncation. A throw from `finally` can replace an earlier
  operation failure and contradicts the required error-preservation behavior.
- The same `gpt-5.6-terra` / `medium` implementer receives this narrow runtime
  correction. Cleanup must run after captured operation work without throwing
  from `finally`; cleanup-only failure still discards the client and rejects,
  while an earlier operation error remains observable.
- GREEN: commit `5a8c57754` moves cleanup error selection outside `finally`.
  Scoped ESLint and the serial PostgreSQL suite (`144/144`) pass. A subsequent
  deterministic TSDoc-only correction for the test seam is pushed as
  `a57cf2fe8`.

## Post-Correction Coverage Finding

- The complete static/documentation/Proto/dependency/release-readiness gates
  pass at `a57cf2fe8`. The exact PostgreSQL coverage run passes all `144/144`
  tests and exceeds statements, functions, and lines, but branch coverage is
  `88.12%` (`527/598`) against the required 90% threshold.
- The same `gpt-5.6-terra` / `medium` implementer receives one test-only batch
  for meaningful observable coverage of the newly added naming, retry,
  cleanup, schema-default, trim, and sanitized-error branches. Thresholds,
  exclusions, ignored branches, and production behavior must not change.
- GREEN: commit `34ca4b669` adds observable tests for current Entity defaults,
  both `writeAll` retry outcomes, both builder table-name overloads, and tenant-
  bound rejection. Exact coverage passes 151 tests with 94.30% statements
  (`961/1019`), 90.30% branches (`540/598`), 95.09% functions (`310/326`), and
  96.67% lines (`844/873`).

## Corrected Preflight Acceptance

- Dependency-aware build, tooling typecheck, scoped ESLint, cleanup/method
  limits, TSDoc, copyright, repository formatting, diff hygiene, documentation
  audience, TypeDoc/API, snippets, Proto lint/current-generated checks, logging
  containment, production-dependency policy, and release readiness pass.
- The affected server/release/tooling suite passes 234 tests in 13 files. It
  builds real tarballs, installs them into a clean consumer, and compiles that
  consumer against `@spine-event-engine/storage-postgres`.
- The four substantively changed review concerns reopen against the correction
  endpoint. Dispatch profiles remain the existing explicit role profiles:
  style, TypeScript/API, and performance/reliability at `gpt-5.6-terra` /
  `high`; documentation at `gpt-5.6-luna` / `medium`. Reviews are read-only,
  independent, and cannot spawn children. The complete wave is collected before
  any further correction.

## Affected Re-review And Final Correction Dispatch

- All four affected reviewers completed against frozen endpoint `a9476bb0e`.
  Their explicit role/profile metadata matched the recorded dispatch, writes
  and child agents were prohibited, and the full wave was collected before
  correction.
- Accepted findings are the trim retained-boundary off-by-one, missing grouped-
  builder behavior coverage, incomplete JVM name goldens plus a real quoted-name
  spelling mismatch, the durable-storage workflow omission, and the missing
  normalized-query matrix. `REVIEW.md` contains the merged six-item batch.
- Official source validation used `SpineEventEngine/jdbc-storage` commit
  `c747908403764eb9` and its QueryDSL 5.1.0 renderer. Ordinary ASCII names are
  unquoted and PostgreSQL-folded; reserved and non-plain/non-ASCII names are
  quoted and preserve spelling. The correction must reproduce that physical
  result before TS's consistent SQL quoting and collision checks.
- The same existing `implementer` receives the coherent runtime/test/docs batch
  with explicit `gpt-5.6-terra` / `medium`, no child agents, and sole production-
  writer responsibility. Runtime changes require focused RED/GREEN evidence;
  thresholds, exclusions, unrelated MySQL behavior, and live-service startup
  remain forbidden.

## Final Correction Acceptance

- Commits through `ac6ef3245` correct exact trim retention, reproduce the
  binding JVM plain-versus-quoted physical-name result, add the complete golden
  matrix and public-builder grouped DDL regression, complete the user/reference
  documentation, and add fixture-level retention tests for zero, partial, and
  300-row multi-page trim cases.
- Final cheap preflight passes 157 PostgreSQL tests with 94.31% statements,
  90.39% branches, 95.10% functions, and 96.68% lines. Dependency-aware build,
  tooling typecheck, scoped ESLint, cleanup, TSDoc, copyright, formatting, diff
  hygiene, docs audience/API/snippets, Proto lint/current generation, logging,
  production-dependency, and release-readiness gates pass.
- The affected server/release/tooling suite passes 234 tests in 13 files,
  including tarball installation and external TypeScript compilation.
- One final read-only affected-concern re-review uses the same explicit role
  profiles and frozen endpoint. No correction begins from a partial report. A
  clean wave advances directly to the one final `verify:release` profile.

## Final Re-review And Last Correction Dispatch

- All four final affected reviewers completed against frozen endpoint
  `856171c31` with their explicit recorded profiles, read-only scope, and no
  child agents. API review is clean. The complete accepted batch is the exact
  binding keyword list, strict grouped DDL assertions, an advancing trim keyset
  cursor, and four stale documentation inventories; `REVIEW.md` records it.
- The performance review's provider-managed history-index proposal is rejected:
  the accepted task explicitly assigns indexes to applications, while Spine
  manages only record-family tables. Adding and strictly validating new indexes
  would create an unapproved physical-storage contract without live plan
  evidence.
- The same existing `implementer` receives the last coherent correction batch
  at explicit `gpt-5.6-terra` / `medium`, without child agents. Runtime changes
  require RED/GREEN evidence; unrelated storage layout, MySQL behavior,
  thresholds, and live-service startup remain out of scope.

## Last-Correction Preflight And Review Dispatch

- The exact PostgreSQL suite passes 157 tests with 94.34% statements
  (`968/1026`), 90.47% branches (`551/609`), 95.12% functions (`312/328`), and
  96.70% lines (`851/880`). The dependency-aware build and tooling typecheck
  pass.
- Scoped ESLint, cleanup and callable limits, TSDoc, copyright, formatting,
  diff hygiene, documentation audience, TypeDoc/API, snippets, Proto lint and
  current-generation checks, logging containment, production-dependency
  policy, and release readiness pass at `5e3c0631e`.
- The affected packaging/release suite passes 234 tests in 13 files. It packs
  all 19 public packages, installs them in a clean project, and compiles an
  external TypeScript consumer of `@spine-event-engine/storage-postgres`.
- The final read-only review reopens only the concerns changed since endpoint
  `856171c31`: style/maintainability for exact name rendering, strict grouped
  DDL assertions, and cursor clarity; performance/reliability for advancing
  trim continuation and exact retention; documentation for the corrected
  provider inventories and renderer claims. The TypeScript/API concern is N/A
  because no public type, export, declaration, or package boundary changed
  after its clean review.
- Dispatches explicitly use the existing `style_maintainability_reviewer` at
  `gpt-5.6-terra` / `high`, `performance_reliability_reviewer` at
  `gpt-5.6-terra` / `high`, and `documentation_reviewer` at `gpt-5.6-luna` /
  `medium`. Each review is independent, read-only, receives no prior review
  memory, and may not spawn child agents. The complete wave is collected before
  any correction.

## Last-Correction Review And Implementation Dispatch

- The complete three-lane wave was collected before correction. Four findings
  are confirmed: the reserved-word set is not the exact QueryDSL 5.1 list; the
  grouped-name regression can pass on DML without proving DDL; a failure while
  acquiring the per-Entity session lock can leave the already-acquired family
  lock on a pooled client; and three documentation phrases still describe two
  adapters or 18 packages.
- The trim cursor itself is accepted: it freezes the first obsolete key,
  includes it in page one, advances by the last key of each full page, and
  retains exact counts in bounded 128-key pages.
- The existing `implementer` receives one coherent correction batch at explicit
  `gpt-5.6-terra` / `medium`, with sole production-writer responsibility and no
  child agents. It must use the authoritative QueryDSL 5.1 resource, add exact
  positive/negative keyword goldens, assert the two specific `CREATE TABLE`
  targets, protect partial lock acquisition with reverse-order cleanup/discard
  behavior while preserving the original error, and correct the stale prose.

## Last-Correction Affected Re-review Gate

- Independent exact PostgreSQL coverage at pushed endpoint `75167a0aa` passes
  158 tests: 94.36% statements (`972/1030`), 90.47% branches (`551/609`),
  95.13% functions (`313/329`), and 96.71% lines (`855/884`).
- The affected style and reliability concerns reopen with no prior review
  memory. Dispatches explicitly use `style_maintainability_reviewer` and
  `performance_reliability_reviewer`, both at `gpt-5.6-terra` / `high`.
  Reviews are read-only and cannot spawn children. The deterministic 18-to-19
  and “any durable adapter” wording corrections do not reopen documentation.

## Last-Correction Test Hardening Dispatch

- Both affected reviewers completed before correction. Production keyword,
  naming, partial-lock cleanup/discard, error sanitization, and advancing-cursor
  behavior are accepted. The only findings are test-strength gaps.
- The grouped DDL regression must prove exactly the two expected targets rather
  than use subset matching. A separate successful two-lock trim regression must
  prove the Entity lock is released before the family lock; the partial second-
  lock failure/discard regression remains separate.
- The same existing `implementer` receives this test-only deterministic batch at
  explicit `gpt-5.6-terra` / `medium`, without child agents. No production or
  public-contract change is authorized.

## Final Convergence Preflight

- Test-only commits `24e88d103` and `824f45485` prove the exact two-table DDL
  set, successful Entity-before-family unlock order, and explicit type-safe
  fixture guards. No production or public contract changed after the clean
  affected re-review.
- The generated dependency-aware build and tooling typecheck pass. Exact
  PostgreSQL coverage passes 159 tests: 94.36% statements (`972/1030`), 90.47%
  branches (`551/609`), 95.13% functions (`313/329`), and 96.71% lines
  (`855/884`).
- Scoped ESLint, cleanup and callable limits, TSDoc, copyright, formatting,
  diff hygiene, documentation audience, TypeDoc/API, snippets, Proto lint and
  generated-current checks, logging containment, production dependencies, and
  release readiness all pass.
- The final cheap packaging/release suite passes 234 tests in 13 files. It
  creates all 19 tarballs, installs them in a clean consumer, and compiles that
  consumer against `@spine-event-engine/storage-postgres`.
- Review and deterministic corrections have converged. The next and only
  expensive verification profile is one `pnpm verify:release` run. Live
  PostgreSQL 16/18 verification remains external because no URLs were supplied.

## Last-Correction Implementation Evidence

- Existing role/function: continuing `implementer`, explicitly configured as
  `gpt-5.6-terra` / `medium`; no child agents were dispatched. Runtime profile
  introspection is unavailable on this surface, so the immutable configured
  profile is the available metadata.
- Independent authority check: downloaded Maven Central's
  `com.querydsl:querydsl-sql:5.1.0` source jar and read
  `keywords/postgresql`. `PostgreSQLTemplates` passes `Keywords.POSTGRESQL` to
  its superclass, and `Keywords` loads that exact resource. The resolver now
  copies its complete list, including `COLLATION`, and excludes `BETWEEN`.
- RED: the targeted test command failed because `Collation` folded to
  `collation` and a raw second session-lock acquisition error escaped. The DDL
  regression and induced cleanup-discard assertions were added in the same
  focused test batch.
- GREEN: focused PostgreSQL tests pass `75/75`. The resolver preserves binding
  keyword behavior while retaining folding, collision, and byte-limit behavior.
  The grouped builder test filters `CREATE TABLE IF NOT EXISTS` SQL and checks
  the exact grouped custom and ungrouped default qualified targets. State trim
  tracks acquired session locks, reverses the acquired sequence for cleanup,
  and the second-lock plus failed-unlock test proves release with discard and a
  sanitized original operation error.
- Scoped validation passed: targeted Vitest; changed-file ESLint; package
  `tsc --noEmit`; `pnpm lint:tsdoc`; `pnpm lint:cleanup`; changed-file Prettier
  check; and `git diff --check`. The remaining limitation is unchanged: no
  PostgreSQL 16/18 connection URLs were supplied for live-provider acceptance.

## Last-Correction Test-Hardening Evidence

- Existing role/function: continuing `implementer`, explicitly configured as
  `gpt-5.6-terra` / `medium`; no child agents were dispatched. This is a
  test-only batch: production code and public contracts remain unchanged.
- The grouped public-builder test now requires exactly the two deterministic
  `CREATE TABLE IF NOT EXISTS` targets, in order: the configured grouped table
  and the separate ungrouped default table. Extra or duplicate DDL fails.
- A separate successful state-trim case proves both session locks release in
  reverse order: exclusive per-Entity unlock, then shared family unlock. It is
  separate from the induced partial-acquisition/failed-cleanup discard case.
- Focused history and record tests pass `69/69`. Changed-file ESLint, TSDoc,
  cleanup, formatting, and diff hygiene remain required before the test-only
  commit. Live PostgreSQL 16/18 verification remains unavailable without
  supplied connection URLs.

## Last-Correction Tooling-Typecheck Repair

- Cheap preflight at `24e88d103` reported TS2532 in the test-only Entity
  history driver and multi-page assertion. The failure was in `splice(...)[0]`
  and indexed page access under `noUncheckedIndexedAccess`, not production
  code.
- The test now explicitly rejects a missing configured lock failure and missing
  expected keyset pages before accessing either value. These guards preserve
  the assertions and produce clear runtime failures instead of weakening tests
  with non-null assertions.
- `pnpm typecheck:tooling` and the focused Entity-history suite pass after the
  correction. Production code and public contracts remain unchanged; scoped
  lint, TSDoc, cleanup, formatting, and diff checks precede the pushed commit.

## PostgreSQL 16 Live-Acceptance Corrections

- Existing role/function: continuing `implementer`, explicitly configured as
  `gpt-5.6-terra` / `medium`; no child agents were dispatched. Human-authorized
  Docker access used the existing disposable PostgreSQL 16.15 container only;
  it was not removed or otherwise administered.
- RED: the record-storage regression called `compareAndSet("slot", undefined,
record-body)` and observed the upsert bind `record-body` instead of `slot`.
  The CAS transaction locked and read the requested slot but wrote the record's
  derived ID.
- GREEN: CAS supplies its caller slot to the private upsert value path; ordinary
  and immutable writes still derive their IDs from record bodies. The focused
  record suite passes `43/43`.
- Live factories now set a `StringifierRegistry` with
  `TypeRegistry([StringValueSchema])`, matching focused fixtures and allowing
  Entity state-history `Any` values to serialize reversibly. This changes only
  the live fixture, not provider defaults or public API.
- PG16 investigation then exposed persistent-fixture collisions in the
  ungrouped Entity-current table and a producer-ID type-URL mismatch. Live
  Entity IDs are now run-unique, and Event producer IDs use the same
  `Identifiers.pack` route as Entity IDs. These preserve isolation and the
  asserted Entity-history behavior.
- A subsequent live failure proved PostgreSQL returns
  `pg_advisory_unlock_shared` for shared unlocks, while the adapter read only
  `pg_advisory_unlock`. RED used the real shared-result shape in the focused
  driver; GREEN decodes the correct field for each unlock SQL statement.
- Evidence: focused record/entity-history tests pass `71/71`; the exact PG16
  package command with all three supplied URLs and expected major 16 passes
  `8 passed, 4 skipped`. Tooling typecheck, scoped lint, TSDoc, cleanup,
  formatting, and diff hygiene precede the coherent push.

## Final Release-Verification Test Repair

- The one converged `verify:release` run at `824f45485` ended with one failed
  test and `4,884` passed. The failure was the MessageBoard manifest contract:
  branch commit `6fab47c6d` moved its package dependencies to
  `2.0.0-snapshot.13`, while five assertions in
  `examples/todo/test/startup-contract.test.ts` still expected snapshot.12.
- The smallest test-only correction updates those five expected Spine package
  versions to `2.0.0-snapshot.13`. The `@connectrpc/connect-node` and exact
  local start-command assertions remain unchanged. Repository search confirms
  no other snapshot.12 references outside records or build outputs.
- RED reproduced the exact startup-contract failure. The startup contract plus
  release-policy and package-artifact tests pass `31/31` after correction.
  Tooling typecheck, changed-file lint, formatting, and diff hygiene precede
  the immediate feature-branch push. No production or public-contract file is
  changed.

## Final Release Verification

- Fresh `pnpm verify:release` at corrected pushed endpoint `0e4da7938` exits
  zero. All 300 test files and all 4,885 tests pass.
- Repository coverage is 93.32% statements (`23845/25550`), 90.11% branches
  (`14091/15637`), 93.03% functions (`6039/6491`), and 94.51% lines
  (`22049/23329`). The same run passes Node, generated build/tooling typecheck,
  repository lint, cleanup/callable limits, TSDoc, copyright, formatting,
  documentation, TypeDoc/API, snippets, Proto generation/lint/current output,
  logging containment, production dependencies, release readiness, all 19
  package tarballs, clean external installation, and consumer compilation.
- Implementation, deterministic verification, independent review, affected
  re-review, and local release verification are complete. Live PostgreSQL 16
  and 18 acceptance remains pending only because the required database URLs
  were not supplied; no container or fallback database was started.

## Human-Authorized Local Docker Acceptance

- The human explicitly authorized local Docker for this task. Docker Desktop
  was started and its unresponsive API socket was recovered with one controlled
  Desktop restart. A disposable `postgres:16` container reports PostgreSQL
  `16.15`; three isolated databases were created for the primary and two tenant
  URLs. No repository-managed container automation was added.
- RED: `test:postgresql:16` ran 12 tests and reported 3 failures, 5 passes, and
  4 skips. Stale and concurrent record CAS operations both succeeded, and the
  Entity commit failed during immutable state-history preflight.
- Database inspection proves the CAS write used the replacement message's
  derived ID instead of the caller-specified storage slot: slot `a` remained
  unchanged while `updated` and `other` appeared as new rows; the competing
  case retained `before` and inserted both `first` and `second`.
- The Entity failure has a distinct fixture cause. Its state-history key embeds
  an `Any` Entity ID, while the live factory omitted the generated-type registry
  used by real server wiring. Direct default-stringifier reproduction fails
  because `google.protobuf.StringValue` is absent from that registry. Existing
  focused Entity tests and production examples explicitly configure it.
- One bounded correction is authorized: first add a focused failing test that
  CAS binds the caller's slot ID even when the replacement derives another ID;
  then minimally change the PostgreSQL CAS write path. Separately configure the
  live factory with a `StringifierRegistry` backed by the fixture type registry.

## PostgreSQL 18 Live Acceptance And Correction Review

- The human explicitly authorized local Docker. A disposable `postgres:18`
  container reported server version `18.6`; the primary and two tenant URLs
  named three separate databases. No repository-managed container automation
  was added.
- The exact `test:postgresql:18` command passes: both files pass, with 8 tests
  passed and 4 skipped. The skips are the two MySQL-only and two
  Datastore-only Inbox cases in the shared provider test. Both PostgreSQL Inbox
  cases and all six PostgreSQL storage acceptance cases ran.
- The PostgreSQL 16 result remains 8 passed and 4 provider-specific skips on
  PostgreSQL 16.15. The supported compatibility floor and current stable-major
  acceptance are therefore both demonstrated against live servers.
- Two independent memory-free reviewers inspected correction commit
  `d8c7fe9764ad865c1a6820f0c3b13cc08d512ee1` against its actual parent
  `d301ac32d4e251f32c6c0267a130f4f47845a5cd`. Existing roles were
  `performance_reliability_reviewer` and `style_maintainability_reviewer`, each
  explicitly dispatched as `gpt-5.6-terra` / `high`; the execution surface did
  not expose additional runtime self-introspection. Neither reviewer found an
  issue. Their PostgreSQL 18 residual-risk note was made before the passing
  18.6 run and is now resolved.
- Dispatch hygiene correction: the review prompts contained a mistyped expanded
  baseline SHA. Both reviewers detected that it did not resolve and independently
  used the target commit's actual parent shown above, so the reviewed diff was
  correct.

## Final Post-Live Verification

- The first `verify:task` invocation omitted its required test-selection
  arguments and stopped before checks. The corrected broad branch preflight
  passed all deterministic gates and 4,885 tests, but two unrelated stress tests
  exceeded their short timeouts under parallel load: the cleanup large-file-list
  case took 5.9 seconds against 5 seconds, and the real staged-release case took
  31.6 seconds against 30 seconds.
- Both timeout cases passed immediately when rerun separately with one worker:
  cleanup `120/120`; release CLI `17/17` in 13.9 seconds. No production or test
  change was made for load-induced timing.
- Fresh `pnpm verify:release` at pushed endpoint `7a17e4a65` exits zero. All 300
  test files and all 4,887 tests pass with one worker. Coverage is 93.32%
  statements (`23846/25551`), 90.11% branches (`14095/15641`), 93.03%
  functions (`6039/6491`), and 94.51% lines (`22050/23330`).
- The same release run passes Node, Proto generation/style/frozen descriptors,
  build and tooling typechecks, ESLint, cleanup, TSDoc, copyright, formatting,
  documentation/API/snippets, generated-output checks, logging containment,
  production dependencies, release readiness, all 19 package tarballs, clean
  external installation, and consumer compilation.
  No public API, schema, or automatic-container behavior changes.

## Round 1 Correction: Record Mutation Fence

- The existing implementer context (`gpt-5.6-terra` / `medium`) added a
  two-client scheduled regression before changing runtime behavior. With CAS
  paused after acquiring its transaction advisory fence, an ordinary write on
  the same slot produced writer order `[write, cas]` rather than the required
  `[cas, write]`; this is the recorded RED result.
- GREEN makes mutable writes, immutable writes, deletes, and caller-managed
  record mutations acquire the same transaction-scoped slot fence. `writeAll`
  deduplicates and sorts lock keys before retaining the original write order.
  Focused Vitest passes `46/46`; changed-file ESLint, the storage-postgres
  TypeScript check, Prettier, and `git diff --check` pass.

## Round 1 Correction: Rollback Disposal

- Coordinators for record storage, table preparation, Entity commits, and
  delivery cleanup now pass the original operation error to `release(error)`
  when `ROLLBACK` itself fails, while retaining their prior sanitized public
  error paths. The record coordinator regression injects secret-bearing
  operation and rollback failures and proves sanitization plus discard.
- Focused coordinator tests pass `97/97`; changed-file ESLint and the package
  TypeScript check pass.

## Round 1 Correction: Public Driver-Error Boundary

- Lazy table initialization now sanitizes non-retryable raw driver failures
  without rewrapping classified provider failures. Public state and event
  append/read transaction paths apply the same boundary. Focused state-history
  and initializer tests pass `40/40` with the package TypeScript check.

## Round 1 Correction: Live Bounded History Pages

- The 129-plus live regression first failed on PostgreSQL 16: `trim(id, 1)`
  retained the newest and initial rows after crossing the 128-row page boundary.
  The next-page cursor had undefined `version` and `created` because trim
  selected only `ID`. Selecting the complete cursor tuple is the minimal GREEN
  correction; hermetic state-history coverage passes `28/28`.
- Disposable local PostgreSQL containers reported `16.15` and `18.6`. Each had
  primary, tenant-A, and tenant-B databases and ran the exact package major
  command successfully: `8` passed and `4` expected provider-specific skips.
  The live test appends 130 states for trim and 130 separate states for
  truncation, asserting exact retained and empty histories rather than counts.

## Independent Verification Correction: Entity Commit Error Boundary

- Independent serial verification reported `164/165`: the Entity lock-failure
  test still expected raw `lock failed` text after the shared record mutation
  fence correctly sanitized it. The test now requires `PostgreSQL storage
operation failed.` and explicitly rejects the secret-bearing raw text, while
  retaining rollback and release assertions. Focused Entity-commit coverage
  passes `15/15`; the complete serial package suite passes `165/165`.
