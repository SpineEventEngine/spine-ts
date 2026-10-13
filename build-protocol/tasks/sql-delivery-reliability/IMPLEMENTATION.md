# Implementation log

Role: existing implementer. Dispatch explicitly selected `gpt-6-sol` with `medium` reasoning. Runtime metadata is not exposed to this agent; the configured role and dispatch fields are the available evidence.

## STS-02 diagnostics

Acceptance: SQL wrappers retain the exact caught failure as an internal cause and preserve stable safe messages. Command posting emits one correlated server diagnostic for a failed request and returns a sanitized public status. Existing typed validation responses remain stable. Retry exhaustion retains the final failed attempt. No change to transaction, delivery, or subscription contracts in this slice.

JVM reference: `jdbc-2x/rdbms/.../DatabaseException.java` constructs `RuntimeException` with the original `Throwable` cause.

RED: `pnpm exec vitest run packages/storage-mysql/test/mysql-error-cause.test.ts packages/storage-postgres/test/postgres-error-cause.test.ts` exited 1; both tests found `error.cause` undefined where the original driver Error was expected.

GREEN: the two SQL cause tests passed after retaining caught failures in the MySQL normalizer and both PostgreSQL normalization paths. The provider messages remain stable; the driver error/code remain reachable only through `cause`.

RED: after building clean workspace packages, the command service test failed because it emitted zero diagnostic records. An earlier attempt could not load the missing workspace builds, then one test fixture lacked `AckSchema`; those were setup/test errors, not observed behavior failures. With those corrected, the behavioral failure was observed.

GREEN: the command service test passed after adding one command-post diagnostic at the service boundary. It checks context name, Command ID/type, operation, safe error class/code, and a serialized Ack that omits driver text. The existing public `COMMAND_POST_ERROR` status remains stable. Known typed validation errors do not produce an infrastructure diagnostic.

RED: an error with a throwing `code` accessor made command posting reject with a secondary exception. GREEN: defensive code extraction retains the safe Ack and one log; both focused service tests passed.

RED: a custom rejection's `name` reached the diagnostic metadata. GREEN: only known error names and selected SQL codes are emitted; the original object and arbitrary code stay internal. The targeted test passed after this correction.

Focused validation after the final runtime edit: `pnpm exec vitest run packages/server/test/services/spine-services.test.ts packages/storage-mysql/test/mysql-error-cause.test.ts packages/storage-postgres/test/postgres-error-cause.test.ts` passed 122/122 tests. `pnpm exec tsc -b --pretty false`, touched-file ESLint, touched-file Prettier, and `pnpm lint:copyright` exited 0. The first ESLint run found two unnecessary constructors; removing them preserved green tests and a clean typecheck.

Cheap preflight correction: `pnpm lint:cleanup` first flagged the expanded `#post` method and two standalone helpers; `pnpm lint:tsdoc` flagged a missing generic tag and compact block comments. The route checks were extracted into `#commandAdmission`, diagnostic parsing moved into a cohesive object, and TSDoc was completed. After a final blank-line correction, cleanup and TSDoc both exited 0. The final route refactor preserved 122/122 focused tests, clean TypeScript build, touched-file ESLint and Prettier, and `git diff --check` exited 0.

Limit: this slice exercises the normalizers and command service using injected failures. The later live-database acceptance must confirm PostgreSQL/MySQL/MariaDB driver codes through the real adapter operations and through asynchronous Delivery processing. Delivery failure policy, Event publication, retry and recovery behavior belong to later slices; this change does not claim to correct those paths.

## STS-01 scalar-list status filters

Acceptance for this checkpoint: legacy scalar `RecordFilter` arrays select any listed value in memory and both SQL adapters; empty arrays select none, while normalized literal-array equality retains its prior meaning. Inbox status reads reject invalid status names and preserve ordered pages after a deleted cursor. Provider tests must use bound values and caller-level tests must run against memory, PostgreSQL 16/18, MySQL, and MariaDB.

RED: the new MySQL and PostgreSQL record-storage tests failed because each adapter emitted one scalar equality bind for the entire array. GREEN: both compile a disjunction of individually bound, null-safe equalities, with `1=0` for an empty set. A shared `RecordQuery.acceptedValues()` defines the legacy list interpretation for memory and SQL. Normalized predicates are unchanged; the new evaluator regression proves literal array equality still matches an array-valued field rather than one array member.

RED: the caller-level Inbox test returned an empty result instead of rejecting `INVALID` status. GREEN: the status conversion now raises `InboxMessageError` for an unsupported runtime value. Review then found that object indexing still accepted inherited names (`toString`, `constructor`, `__proto__`); an exhaustive switch rejects these too. The caller test checks omitted, each single, mixed, all, empty, and repeated status lists, those invalid names, an empty table, ordered IDs, and a bounded page continued after deleting its cursor row. Its local fixture carries a real Todo `TaskListId` and a populated `TaskCreated` Event; the generic legacy fixture's `StringValue` target/empty Event was unsuitable for this acceptance.

Validation: both full SQL adapter files passed 96/96 tests after preserving the existing scalar SQL shape. The final four-file focused run passed 104 tests with two live SQL cases skipped without URLs. After the inherited-name and domain-fixture correction, the caller-level live test passed separately on the dedicated PostgreSQL 16, PostgreSQL 18, MySQL 8.4, and MariaDB 11.4 endpoints, two active tests each (memory plus the selected provider); exact Vitest output is in `evidence/status-{pg16,pg18,mysql,mariadb}.log`. An initial repeat run found old rows in the shared physical Inbox table because the test reused a shard; the test now creates a unique shard per run. `pnpm exec tsc -b --pretty false`, touched-file ESLint/Prettier, `pnpm lint:cleanup`, `pnpm lint:tsdoc`, and `git diff --check` exited 0 after the final correction; output is in the matching `evidence/status-*.log` files.

Remaining STS-01 acceptance: explicit tenant-isolation matrix and broader status/ordering combinations with real transports remain in the later SQL/process matrix. This checkpoint makes no claim about independent-write, cleanup, or delivery reliability changes.
