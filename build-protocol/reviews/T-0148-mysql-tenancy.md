# T-0148 Review Record

Status: One aggregated correction batch accepted.

## Required lanes

- TypeScript/API documentation: changes requested. Encode the single/multi
  tenant invariant in `StorageContext`; connect custom `StringifierRegistry`
  behavior to MySQL message IDs/columns and symmetric query conversion; expose
  the provider tenant-catalog capability through the supported storage entry
  point; correct stale public references.
- Performance/reliability: changes requested. Make the current-Entity test
  helper use `MysqlIdColumn` instead of the retired canonical key, prove actual
  record operations select the matching tenant pool, and prove all pools close
  exactly once after a later tenant probe fails.
- Style/maintainability: changes requested. The tenant-to-pool behavioral proof
  is required; replace the misleading remaining Entity “scope” error with a
  source-type error.
- Documentation: changes requested. Correct MySQL/shared README, REFERENCE, and
  user-guide claims about scalar tenants, context partitioning, arbitrary IDs,
  one pool, floating columns, and the deleted hidden layout. Datastore-specific
  claims remain assigned to T-0149.
- Security: deferred to T-0150's final tenant-boundary review because this
  branch is intentionally non-releasable and the complete trust boundary spans
  both providers and shared runtime.

## Accepted correction batch

All findings above are accepted. One implementation batch owns the public
tenant union, immutable provider stringifier snapshot, supported catalog
exports, direct helper mapping, tenant/cleanup regressions, terminology, and
focused beginner documentation. Re-review is limited to API, reliability,
style, and documentation because every lane is substantively affected.

## Correction evidence

- `StorageContext` is now a discriminated single-/multitenant union. Runtime
  validation remains fail-closed for untyped JavaScript callers, while storage
  tests use complete generated tenant values.
- MySQL builder configuration now snapshots a `StringifierRegistry`; direct
  message IDs, stored message columns, filter operands, and continuations share
  that mapping. The supported storage entry point exports the tenant-catalog
  capability.
- Behavioral tests prove each complete tenant performs writes through only its
  configured pool, both successful and failed pools close once after partial
  connection failure, the current-Entity helper uses primitive and message
  `MysqlIdColumn` values, and source-type errors no longer say “scope.”
- MySQL/shared README, REFERENCE, and user-guide sections now teach complete
  tenant-to-database routing, typed JVM IDs/columns, and the direct
  `ID`/`bytes`/declared-column layout. Datastore prose remains for T-0149.
- Focused and affected suites pass 25 files / 242 tests; 9 credential-gated
  live-MySQL tests are skipped. Affected builds, ESLint, TSDoc, audience,
  release-readiness (392 links), and 5 compiled documentation snippets pass.
- `docs:api:check` reaches the intentional stacked integration boundary: 57
  errors remain in Datastore and server consumers that still use the old
  tenant/column contracts. T-0149 owns Datastore; T-0150 owns server/runtime.
  No T-0148 MySQL source or public-document error remains in that output.
