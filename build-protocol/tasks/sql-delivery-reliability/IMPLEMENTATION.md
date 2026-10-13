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
