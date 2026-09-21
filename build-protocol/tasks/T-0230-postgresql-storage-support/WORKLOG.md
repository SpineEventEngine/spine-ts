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
