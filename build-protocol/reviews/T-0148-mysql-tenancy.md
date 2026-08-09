# T-0148 Review Record

Status: Targeted re-review residuals corrected; final lane confirmation pending.

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

## Targeted re-review

- TypeScript/API found the code contract clean and requested removal of two
  remaining physical-scope guide paragraphs plus public reference inventory
  for stringifiers, identifiers, column mappings, and tenant catalogs.
- Reliability found the provider helper still defaulted its message-ID
  stringifier instead of accepting the factory snapshot.
- Style found the factory regression's flattened-value assertion could be
  satisfied by the write alone and did not isolate filter/continuation values.
- Documentation confirmed the same guide contradiction and otherwise accepted
  the beginner-facing MySQL and shared references.

The residual batch is accepted. The helper now accepts the same registry used
by the factory and has custom message-ID coverage. The factory regression
asserts the exact `SELECT` filter operand and keyset continuation values. The
guide and public package references now state the corrected API and physical
identity. Focused execution passes 2 files / 32 tests. Reliability, style, and
documentation require narrow final confirmation; the code/API lane is closed
apart from deterministic documentation inventory checks.
