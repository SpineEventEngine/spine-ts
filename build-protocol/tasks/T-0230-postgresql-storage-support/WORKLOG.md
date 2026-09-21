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
