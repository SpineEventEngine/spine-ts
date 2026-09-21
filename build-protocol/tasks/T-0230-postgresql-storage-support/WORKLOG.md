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

1. Contract and package skeleton: complete.
2. Connection, tenancy, names, and schema: pending.
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
