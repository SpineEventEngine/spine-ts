# Independent test review corrections

Existing implementer role; explicit `gpt-6-sol` / `medium` dispatch on Standard speed. Runtime model self-introspection was unavailable. Scope was the six confirmed P2 test findings in `test-quality-review.md` and `harness-quality-review.md`. No production files, configuration thresholds, or services were changed in this correction batch.

## Corrections

1. The delivery label/status test compares each encoded value with the generated wire enum and decodes a separately assigned wire enum. Command and Event payloads remain domain-specific. A valid Protobuf response at exactly 4 MiB is admitted and a valid response one byte beyond it raises `DeliveryProtocolError`; the impossible `Symbol` assertion is gone.
2. Both Message Board topology tests parse Compose YAML and check service-specific images, Gateway or Envoy port mappings, and browser origin fields. The distributed test resolves YAML merge aliases so the second application service is checked. A separate mechanical `docker compose config` check is still appropriate.
3. The MyISAM test commits one Entity with enabled histories and a separate current-only Entity with both optional histories disabled. It reads exact current records, checks per-Entity state/diagnostic presence or absence, compares retained history bytes, and checks exact delivery Events.
4. The MySQL concurrent Entity test permits the final current payload from either completed writer and verifies the retained immutable state, diagnostic, and delivery Event records. Its competing state now uses a Task message rather than an identifier payload. The PostgreSQL concurrent test reads state from a fresh Entity handle, checks its version and payload against the two completed writes, and checks the disabled history ports are empty. These checks do not assert a cross-record total transaction order for partial-prefix storage.
5. Both MySQL CAS races read the stored record after exactly one `true` result and compare it to that contender's replacement, including the present-record case whose original SQL bytes were deliberately duplicated.

## Focused evidence

- `pnpm exec vitest run packages/delivery-client/test/codec-immutability.test.ts --maxWorkers=1`: 22 passed.
- `node --test examples/distributed-message-board/test/topology.test.mjs examples/message-board/deploy/compose/topology.test.mjs`: nine passed.
- `pnpm exec tsc --noEmit -p packages/delivery-client/tsconfig.json`, `packages/storage-mysql/tsconfig.json`, and `packages/storage-postgres/tsconfig.json`: passed.
- ESLint and Prettier check of the five changed test files: passed.

The MySQL and PostgreSQL integration cases require live databases and were not run in this implementation context. The orchestrator's mechanical verification function has provisioned unique databases for all four engines and will run those cases on the frozen files. The response boundary and wire enum assertions have direct independent oracles; no production mutation was used for a red phase because this correction batch changes tests only.

## First live run and correction

The first mechanical run passed all 12 PostgreSQL tests on versions 16 and 18. MySQL 8.4 and MariaDB 11.4 each passed 13 of 15 tests and failed the new MyISAM and concurrent Entity readbacks. Both failures were assertion-shape defects: MySQL returns `Any.value` as `Buffer` while the fixture contains `Uint8Array`, and history tables include unrelated test contexts. The corrected tests compare re-encoded Event bytes, require the expected immutable row to be present, and retain the per-Entity exact history counts. They still require the final current state to equal a completed writer's payload. No provider change or new serialization guarantee is inferred from these failures.

Focused correction checks passed: MySQL package TypeScript check, ESLint, Prettier, and `git diff --check`. A second live database run is pending from the orchestrator's mechanical function. The PostgreSQL reader-handle edit was made after the first live run's source snapshot: recorded hash `c1104d15bcb0eebc9abf08db64b4c66c2a39b06787b4979450d2a924a5c70df7`; final current hash `5969c317f9375e520c74a9c69247f9c6d677803e8f6f2eede8cef8ca4e2ae0d5`.

The second live run passed: MySQL 8.4 and MariaDB 11.4 each 15/15, PostgreSQL 16 and 18 each 12/12. The rerun includes the fresh PostgreSQL reader and the corrected MySQL assertions.

## Framework reference correction

The accepted documentation finding concerned `packages/server/REFERENCE.md`: it described direct local Inbox cleanup as an atomic snapshot and shard-session check. The corrected paragraph reflects `Delivery.#cleanupPage()` and `InboxStorage.removeDelivered()`: eligibility and operation checks precede ID deletion; there is no stored-row snapshot comparison or post-delete session check. Cancellation stops later attempts, while completed deletions remain. The adjacent remote-client claim now describes its bounded removal request without attributing an atomic compare-and-delete guarantee. Prettier on the reference, `pnpm docs:snippets:check:generated`, and `git diff --check` passed. No runtime file changed.
