# T-0134 Review Log

Status: Clean; complete on the Wave 8 integration train

## Planned Concerns

- Style/maintainability: existing reviewer, explicit `gpt-5.6-terra` / `high`.
- TypeScript/API docs: existing reviewer, explicit `gpt-5.6-terra` / `high`.
- Performance/reliability: existing reviewer, explicit `gpt-5.6-terra` / `high`.
- Documentation: existing reviewer, fixed `gpt-5.6-luna` / `medium`.
- Security: N/A unless implementation introduces a new trust or secret
  boundary.

Runtime metadata will be recorded when exposed. Otherwise, immutable configured
profiles and the desktop surface's lack of independent runtime introspection
are the accepted evidence.

## Review Wave 1 Dispatch

- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  dispatched at `gpt-5.6-terra` / `high`.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, explicitly
  dispatched at `gpt-5.6-terra` / `high`.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicitly dispatched at `gpt-5.6-terra` / `high`.
- Documentation: existing fixed `documentation_reviewer`, explicitly
  dispatched at its immutable `gpt-5.6-luna` / `medium` profile.
- Security: N/A. The task changes provider persistence layout and database
  coordination but adds no authentication, authorization, secret handling,
  remote-input trust boundary, or deployment privilege surface.

## Review Wave 1 Results

### Performance And Reliability

- Reviewer: existing `performance_reliability_reviewer`, explicitly dispatched
  at `gpt-5.6-terra` / `high`.
- Runtime metadata: the desktop surface does not expose independent runtime
  model introspection. The immutable configured role/profile is the available
  evidence, with no visible mismatch or inherited fallback.
- Disposition: findings require correction.
- P0: InnoDB CAS and Entity commits read current state without a row lock or
  revision predicate, so concurrent writers can both report success.
- P0: immutable writes use read-then-upsert and can overwrite a concurrently
  inserted divergent row instead of rejecting the collision.
- P1: schema inspection does not enforce required types, widths, nullability,
  defaults, collation, primary key presence/order, harmful extra columns, or
  unique-constraint compatibility.
- P1: grouped default table names use the source simple name instead of the
  record simple name, and default-resolved identity collisions are not fully
  rejected.
- P1: record-query continuations are ignored, causing repeated pages.
- P1: Entity and commit wrapper handles remain retained until factory shutdown,
  and closing Entity storage does not close its current-state handle.
- P2: oversized query and CAS keys are rejected only after acquiring a pool
  connection, contrary to the frozen pre-acquisition bound.
- Mechanical evidence: 33 focused tests passed with five URL-gated live tests
  skipped; the package TypeScript check passed.
- Next action: collect the remaining API, style, and documentation reviews, then
  return one consolidated finding batch to the existing implementation context.

### TypeScript And API Documentation

- Reviewer: existing `typescript_api_docs_reviewer`, explicitly dispatched at
  `gpt-5.6-terra` / `high`.
- Runtime metadata: the desktop surface does not expose independent runtime
  model introspection. The immutable configured role/profile is the available
  evidence, with no visible mismatch or inherited fallback.
- Disposition: P1 findings require correction.
- Public factory methods expose package-internal resolver, Entity-storage, and
  commit types; the exported Entity handle also lost its prior `isOpen()`
  contract. Construction helpers must remain private while the structural
  public return type is preserved.
- Creation callbacks see every declared user column as `VARCHAR(1024)` rather
  than the canonical native SQL type used by default DDL.
- Grouped default naming and default-name collision detection violate the
  frozen `StorageGroup` contract, also reported by reliability review.
- Public provider error classes and documentation do not match the raw errors
  currently emitted by schema, decoding, bounds, query, collision, and driver
  failures.
- The user guide and server conformance test still call the removed `create()`
  factory API, and the API allowlist omits the five new public builder/spec
  exports.
- Mechanical evidence: package TypeScript passed; builder/resolver tests passed
  11/11; diff check passed. Focused TypeDoc reproduced two public-type leaks.
  The repository API-doc check stops earlier on known downstream train errors.
- Next action: finish style and documentation review, then issue one correction
  batch covering the complete review wave.

### Documentation

- Reviewer: existing fixed `documentation_reviewer`, explicitly dispatched at
  its immutable `gpt-5.6-luna` / `medium` profile.
- Runtime metadata: the desktop surface does not expose independent runtime
  model introspection. The immutable configured role/profile is the available
  evidence, with no visible mismatch or inherited fallback.
- Disposition: two P1 and four P2 findings require correction.
- The user guide still teaches removed `MysqlStorageFactory.create(...)`, the
  obsolete shared tables, eager startup creation, and removed compatibility
  fingerprints. It must teach the builder and lazy per-family layout instead.
- README and REFERENCE overstate transactionality for MyISAM and Aria. They
  must distinguish InnoDB transactions from deterministic nontransactional
  prefix/retry behavior, including `writeAll`.
- README incorrectly says tables are created or inspected during factory build;
  only the pool connects then, while record-family tables are lazy.
- REFERENCE omits the five new builder/table/create-operation exports and their
  naming precedence and customization behavior.
- Navigation links were checked and resolve.
- Next action: collect the style result, then return the complete finding batch
  to implementation in one correction round.

### Style And Maintainability

- Reviewer: existing `style_maintainability_reviewer`, explicitly dispatched at
  `gpt-5.6-terra` / `high`.
- Runtime metadata: the desktop surface does not expose independent runtime
  model introspection. The immutable configured role/profile is the available
  evidence, with no visible mismatch or inherited fallback.
- Disposition: two P2 and one P3 findings require bounded correction; no new
  P0 or P1 finding was added.
- Physical table layout is independently represented in the callback spec,
  default DDL, and inspection and has already diverged. One resolved
  `MysqlTableSpec` must drive all three paths.
- Entity commit orchestration relies on unchecked generic erasure and ad-hoc
  structural casts. Introduce one private strongly typed commit capability while
  keeping the public storage port separate.
- Coordinator `transaction()` and `lock()` methods are test-only dead paths;
  remove them or refactor production `commit()` through shared private helpers.
- Mechanical evidence: `git diff --check` passed.

## Consolidated Correction Dispatch

- Owner: existing T-0134 `implementer`, explicitly configured as
  `gpt-5.6-terra` / `medium`; the same implementation context is reused.
- Scope: correct every accepted Wave 1 finding in one batch, using focused RED
  tests before behavior changes. Ownership includes `packages/storage-rdbms/**`
  plus the narrow stale user-guide, server conformance-test, API-inventory, and
  task/review/work-log consumers required by the removed public API.
- Runtime metadata: record actual metadata if exposed; otherwise record the
  immutable configured profile and lack of independent runtime introspection.
- Required evidence: concurrent cross-handle CAS and Entity commits; concurrent
  immutable collisions; full schema-compatibility matrix; grouped/default-name
  collision behavior; ascending, descending, tied, and scope-isolated
  continuations; handle lifecycle; pre-acquisition bounds; public TypeDoc/API
  inventory; corrected engine-specific docs; package coverage and the live
  MySQL/MariaDB engine matrix.

### Correction Ownership Adjustment

- The original implementation context completed pagination, CAS/immutable-race
  slices, Entity locking, resolver naming/collisions, and the first canonical
  table-spec extraction, but repeatedly returned before the now-bounded
  cross-module schema correction.
- To avoid further status-only turns, the remaining exact schema task is handed
  to another existing `implementer`, explicitly configured as
  `gpt-5.6-terra` / `medium`. Only this owner may edit the overlapping provider
  files until the schema matrix is complete; no rediscovery or architecture
  change is requested.
- Runtime metadata must be recorded if exposed; otherwise the immutable
  configured profile and lack of independent runtime introspection are the
  accepted evidence.

### Schema-Matrix Correction Result

- Owner: existing `implementer`, explicitly configured `gpt-5.6-terra` /
  `medium`. This surface exposes no independent runtime-model metadata; the
  immutable configured role/profile is the available evidence, with no visible
  fallback or mismatch.
- Disposition: the style finding requiring a single canonical physical-layout
  specification is corrected. The factory resolves one `MysqlTableSpec`, passes
  that exact object to the creation callback and `MysqlRecordStorage`, and the
  adapter uses it for default DDL and compatibility inspection.
- Coverage: the parameterized schema matrix covers mandatory primary-key
  presence/order; types and capacity widening; nullability; defaults; binary
  collation; declared native columns; harmful extra columns and unique indexes;
  and all specified compatible additions. The tests assert that rejected
  layouts never cause `ALTER` SQL. Engine acceptance remains InnoDB, MyISAM,
  and Aria only.
- Evidence: RED was observed for missing PK/default/declared-type/extra-column/
  unique-index handling and capacity widening. A binary-collation regression
  was independently RED-checked by temporarily removing the compatibility
  guard, then restored GREEN. Fresh non-live package tests pass 65 with 6
  URL-gated skips; package typecheck, exact source ESLint, Prettier, and diff
  check pass. Live engine reruns and the final review dispositions remain open.

### Remaining Correction Dispatch

- Owner: another existing `implementer`, explicitly configured as
  `gpt-5.6-terra` / `medium`, with exclusive ownership of the remaining
  provider/API/documentation correction files until convergence.
- Exact remaining scope: handle lifecycle; pre-acquisition key bounds; restored
  public Entity-handle shape and hidden construction types; typed/sanitized
  provider errors; private typed commit capability and coordinator dead-code
  cleanup; continuation edge coverage; stale user-guide/server/API-inventory
  consumers; engine-qualified README/REFERENCE guidance.
- Acceptance includes package checks and coverage, focused TypeDoc/API checks,
  and a final orchestrator-run live engine matrix. Runtime metadata follows the
  same configured-profile limitation policy recorded above.

### Remaining Correction Progress

- Corrected: handle lifecycle/deregistration and public `isOpen`; query and
  CAS pre-acquisition key bounds; removed coordinator test-only APIs; sanitized
  schema/data/operation errors; stale builder/docs/API consumers.
- Evidence: 66 non-live package tests pass (6 URL-gated skips) and package
  TypeScript passes. A live MySQL rerun exposed resolver reuse after lifecycle
  correction and that was fixed; two live failures remain (hard-coded trigger
  fixture table and an InnoDB immutable-prefix deadlock).
- Not accepted: the 90% all-metric coverage gate (current non-live run 81.61%
  statements, 81.98% branches, 75.91% functions, 82.69% lines), clean TSDoc/
  TypeDoc gate, and final live engine matrix. These are stacked blockers.

### Remaining Correction Convergence

- The previous blockers are resolved. Live provider coverage passes 73/73 at
  94.15% statements, 90.62% branches, 93.78% functions, and 96.08% lines.
  Package TypeScript, changed-source ESLint, TSDoc, TypeDoc/API inventory,
  audience policy, Prettier, and diff checks pass.
- Live trigger injection uses actual provider-resolved family tables. One
  bounded InnoDB deadlock retry is supported only after `ER_LOCK_DEADLOCK` and
  transaction rollback; deterministic and live conflicting-commit regressions
  cover the behavior.

### Wave 2 Correction Evidence

- Private Entity-family commit capability replaces public-port structural casts.
  Canonical primitive IDs, readiness recovery, zero-sort continuation, and
  non-InnoDB CAS locks have focused behavior coverage.
- Live package coverage passes all metrics (94.22% statements, 90.16%
  branches, 93.71% functions, 96.05% lines; 73/73 tests). Package mechanics
  pass. Repository API/audience remains blocked by 89 out-of-scope downstream
  TypeScript errors in Datastore, server, and deployment sources.

## Review Wave 2 Dispatch

- Performance/reliability: re-review corrected concurrency, persistence,
  schema, query, and lifecycle behavior with the existing reviewer, explicitly
  `gpt-5.6-terra` / `high`.
- TypeScript/API docs: re-review corrected public shape, error contracts,
  TypeDoc, API inventory, and consumer compatibility with the existing
  reviewer, explicitly `gpt-5.6-terra` / `high`.
- Style/maintainability: re-review the centralized table specification, typed
  commit capability, coordinator cleanup, and changed implementation with the
  existing reviewer, explicitly `gpt-5.6-terra` / `high`.
- Documentation: re-review corrected README, REFERENCE, and user-guide claims
  with the fixed existing reviewer at `gpt-5.6-luna` / `medium` when a slot is
  available.
- Runtime metadata follows the immutable configured-profile and introspection
  limitation policy recorded for Wave 1.

## Review Wave 2 Results

### Performance And Reliability

- Reviewer: existing `performance_reliability_reviewer`, explicitly dispatched
  at `gpt-5.6-terra` / `high`. Independent runtime-model introspection remains
  unavailable; no visible mismatch or fallback occurred.
- Disposition: two P0, one P1, and one P2 finding require correction.
- P0: nontransactional Entity advisory locks derive from caller input rather
  than the handle's exact context and persisted canonical Entity-ID key. This
  permits scope mismatch/canonical aliases to bypass serialization and fails on
  valid bigint IDs.
- P0: `atomicCompareAndSet` remains non-atomic on MyISAM/Aria because it relies
  on transactions and `FOR UPDATE`; add engine-appropriate serialization and
  live present/absent two-handle races.
- P1: a continuation with no explicit sort produces malformed SQL instead of
  the default `ID ASC` continuation predicate.
- P2: failed lazy create/inspection promises remain cached permanently after a
  transient failure and must be retryable without weakening schema failures.
- Clean dispositions: the one-attempt InnoDB deadlock retry/rollback path,
  schema matrix, lifecycle cleanup, and pre-acquisition bounds have no further
  reliability findings.

### TypeScript And API Documentation

- Reviewer: existing `typescript_api_docs_reviewer`, explicitly dispatched at
  `gpt-5.6-terra` / `high`. Independent runtime-model introspection remains
  unavailable; no visible mismatch or fallback occurred.
- Disposition: four P1 findings require correction.
- Public `MysqlStorageFactory.connect()` still exposes an internal resolver and
  permits bypassing the builder; `@internal` does not remove it from emitted
  declarations.
- Primitive IDs use JSON rather than the canonical ID codec, breaking bigint,
  undefined, bytes, canonical object ordering, and runtime byte-ID recovery.
- Decode failures in read/CAS occur outside the data-error wrapper and are
  incorrectly sanitized as operation errors.
- User documentation still overstates `writeAll` transactionality, describes
  the removed 512/255 context/tenant layout rather than `_scope(224)`, and
  claims asynchronous/reusable close behavior that conflicts with the current
  `close(): void` contract.
- Evidence: package TypeScript passed and focused MySQL tests passed 59/59.
  Repository TypeDoc/API checks remain blocked earlier by downstream train
  compile errors rather than this package.

### Style And Maintainability

- Reviewer: existing `style_maintainability_reviewer`, explicitly dispatched at
  `gpt-5.6-terra` / `high`. Independent runtime-model introspection remains
  unavailable; no visible mismatch or fallback occurred.
- Disposition: three P2 findings require correction; no P0/P1 was added.
- Remove the redundant `MysqlResolvedTable.columns`/`mysqlRecordColumns` model;
  the canonical `MysqlTableSpec` must be the sole physical layout.
- Replace remaining commit-path generic erasure and structural casts with one
  private typed Entity-family capability, keeping public storage ports separate.
- Clear failed lazy readiness promises so transient create/inspection failures
  can recover; this overlaps the reliability P2.
- Clean dispositions: coordinator test-only APIs are gone, and bounded deadlock
  retry/rollback/release code is localized and readable.

### Documentation

- Reviewer: fixed existing `documentation_reviewer`, explicitly dispatched at
  its immutable `gpt-5.6-luna` / `medium` profile. Independent runtime-model
  introspection remains unavailable; no visible mismatch or fallback occurred.
- Disposition: unresolved P1/P2 findings require correction.
- The user guide still claims universal transactionality, eager fixed-table
  startup, obsolete compatibility fingerprints, old scope sizes, automatic
  lookup indexes, and foreign-key/index/transactional-DML requirements.
- README still broadly overstates transactionality for MyISAM/Aria.
- REFERENCE omits the exact `_scope(224)`, `ID(768)`, payload/revision columns,
  primary key, bounds, and compatibility rules.
- REFERENCE and user guide describe promise-returning/awaitable close behavior,
  while the public factory API is `close(): void`.
- Navigation links and the new exported-type list are otherwise clean.

## Final Correction Dispatch

- Owner: reuse the current T-0134 `implementer`, explicitly configured as
  `gpt-5.6-terra` / `medium`, with exclusive overlapping-file ownership.
- Scope: correct every remaining Wave 2 finding in one batch with deterministic
  RED/GREEN tests, then run the full MySQL/MariaDB engine matrix, all-metric
  package coverage, and cheap documentation/API/mechanical gates.
- Runtime metadata follows the immutable configured-profile/introspection
  limitation policy above. No commit, push, or merge occurs before clean
  focused re-review.

## Final Correction Result

- All remaining Wave 2 runtime, API, style, and documentation findings are
  implemented with deterministic regressions.
- Provider coverage passes 74 tests at 94.06% statements, 90.01% branches,
  93.83% functions, and 95.82% lines.
- Live MySQL InnoDB/MyISAM and MariaDB InnoDB/Aria each pass 7/7, including
  present and absent two-handle CAS races.
- Package TypeScript, changed-source lint, TSDoc, documentation audience,
  Prettier, and diff checks pass.
- The repository API-doc command stops before provider inspection on 89 known
  downstream train TypeScript errors in Datastore, server, and deployment; no
  provider-scope error was reported.

## Review Wave 3 Dispatch

- Re-review all four substantively affected concerns once more: reliability,
  TypeScript/API docs, style/maintainability, and documentation.
- Existing reviewer roles are explicitly dispatched at their required profiles:
  Terra/high for reliability, API, and style; fixed Luna/medium for docs.
- Runtime metadata follows the recorded immutable-profile/introspection policy.

## Review Wave 3 Results

### Performance And Reliability

- Reviewer: existing `performance_reliability_reviewer`, explicitly dispatched
  at `gpt-5.6-terra` / `high`; independent runtime introspection remains
  unavailable, with no visible mismatch or fallback.
- Disposition: two P1 and one P2 findings require correction; no P0 remains.
- P1: a commit carrying state/diagnostic history silently discards it when the
  corresponding history family is disabled. Match in-memory fail-fast behavior.
- P1: identical retry still rewrites current and increments `_revision`; skip
  that write when current already equals `next` and prove revision stability.
- P2: nontransactional Entity advisory locks omit database identity even though
  MySQL advisory locks are server-wide; include database identity and cover
  cross-database key separation.
- Clean dispositions: readiness retry, zero-sort continuation, MyISAM/Aria CAS
  serialization, bounded CAS/Entity deadlock retry, schema, lifecycle, and key
  bounds. Focused tests passed 67/67 with seven live skips; package TypeScript
  and diff check passed.

### TypeScript And API Documentation

- Reviewer: existing `typescript_api_docs_reviewer`, explicitly dispatched at
  `gpt-5.6-terra` / `high`; independent runtime introspection remains
  unavailable, with no visible mismatch or fallback.
- Disposition: three P1 and one P2 findings require correction.
- P1: a protected factory override returns package-private
  `MysqlRecordStorage`, leaking it through emitted public declarations; return
  the base `RecordStorage` seam.
- P1: primitive-ID codec/bounds failures occur before the operation wrapper and
  escape as raw errors rather than `MysqlStorageOperationError`.
- P1: the user guide still contains retired 512/255 layout, automatic lookup
  index, and FK/index/transactional-DML requirements.
- P2: REFERENCE promises pool-close failures as a connection error, but
  `close(): void` starts an unobserved close promise and exposes no such path.
- Clean dispositions: private builder connection path, required root exports/API
  inventory, Entity `isOpen()`/`close(): void`, and stored-data error wrapping.
  Package TypeScript, 39 focused tests, and diff check passed.

### Style And Maintainability

- Reviewer: existing `style_maintainability_reviewer`, explicitly dispatched at
  `gpt-5.6-terra` / `high`; independent runtime introspection remains
  unavailable, with no visible mismatch or fallback.
- Disposition: three P1 and two P2 findings require correction; no P0 remains.
- P1: disabled histories and identical retry behavior match the reliability
  findings above.
- P1: bound Entity-commit record operations bypass the provider error wrapper,
  allowing raw driver failures to escape the documented operation error.
- P2: database identity is missing from advisory keys, matching reliability.
- P2: production still contains a generic-erasure cast and the live integration
  test uses structural casts to reach private factory/handle state; preserve the
  typed seam end-to-end and expose only a provider-private test seam if needed.
- Clean dispositions: sole canonical `MysqlTableSpec`, retryable readiness,
  localized deadlock retry/release, and no dead helper. Diff check passed.

### Documentation

- Reviewer: fixed existing `documentation_reviewer`, explicitly dispatched at
  `gpt-5.6-luna` / `medium`; independent runtime introspection remains
  unavailable, with no visible mismatch or fallback.
- Disposition: current user guide retains obsolete scope/tenant bounds, index
  and FK requirements, awaitable close, eager tables, and fingerprints. It also
  omits exact layout/schema and engine-specific Entity commit semantics.
- README still overstates transactionality and has a broken user-guide anchor.
- REFERENCE promises impossible close-failure reporting and incompletely
  explains non-InnoDB CAS and scope encoding/compatibility.

## Final Bounded Correction Dispatch

- Owner: reuse current `implementer`, explicitly configured
  `gpt-5.6-terra` / `medium`, for only the enumerated Wave 3 findings.
- Required regression evidence: disabled-history rejection; stable revision on
  identical retry; database-separated advisory keys; sanitized bound-operation
  failures; no public/internal declaration leaks; canonical codec bounds mapped
  to provider errors; typed commit seam without production/test structural
  casts; corrected docs and link.
- After correction, re-review only reliability, API, style, and docs, then run
  the final live matrix and selected verification once.

## Final Bounded Correction Result

- Disabled-history inputs fail fast; identical replay uses canonical Protobuf
  equality and does not rewrite/increment current; advisory locks include the
  database; public declarations no longer leak MySQL record storage; commit
  driver failures are sanitized.
- Coverage passes 76 tests at 94.26% statements, 90.08% branches, 93.86%
  functions, and 95.87% lines.
- MySQL InnoDB/MyISAM and MariaDB InnoDB/Aria each pass 9/9.
- Package TypeScript, changed lint, Prettier, TSDoc, documentation audience, and
  diff checks pass. The API-doc command retains only the recorded downstream
  integration-train compile blocker.

## Review Wave 4 Dispatch

- Final focused re-review of the corrected reliability, TypeScript/API, style,
  and documentation concerns uses the same existing roles and explicit profiles
  as prior waves. No unrelated concern is reopened.

## Review Wave 4 Results

### Performance And Reliability

- Reviewer: existing `performance_reliability_reviewer`, explicitly dispatched
  at `gpt-5.6-terra` / `high`; independent runtime introspection remains
  unavailable with no visible mismatch or fallback.
- Disposition: implementation clean; one P2 test-strength correction remains.
- Add a direct assertion that identical replay leaves current `_revision`
  unchanged. The existing regression proves two committed outcomes but would
  not catch an unnecessary rewrite.
- Clean: disabled-history rejection, database-qualified lock keys, bound-error
  sanitization, bounded deadlock retry, and nontransactional CAS. Focused tests
  passed 45/45 and diff check passed.

### TypeScript And API Documentation

- Reviewer: existing `typescript_api_docs_reviewer`, explicitly dispatched at
  `gpt-5.6-terra` / `high`; independent runtime introspection remains
  unavailable with no visible mismatch or fallback.
- Disposition: two P1 and two P2 findings remain.
- P1: canonical primitive-ID encoding can throw raw synchronously before the
  operation wrapper/connection acquisition; convert every codec/bounds failure
  into the documented operation error while preserving Promise behavior.
- P1: the user guide still contains the retired 512/255 layout, automatic-index,
  awaitable-close, and FK/index/transactional-DML claims.
- P2: two generic-erasure casts remain in commit/history internals; remove them
  to make the typed capability claim accurate.
- P2: REFERENCE still promises pool-close failure reporting that `close(): void`
  cannot expose.
- Clean: public factory return seam, exports/inventory, private connection
  construction, TSDoc, and package TypeScript.

### Style And Maintainability

- Reviewer: existing `style_maintainability_reviewer`, explicitly dispatched at
  `gpt-5.6-terra` / `high`; independent runtime introspection remains
  unavailable with no visible mismatch or fallback.
- Disposition: one P2 remains. Remove Entity-ID generic-erasure casts from
  production and structural private-state casts from live tests by completing
  the typed capability and a provider-private typed test seam.
- Clean: disabled-history validation, replay no-rewrite, database-qualified
  locks, bounded retries, error wrapping, and canonical table layout.

### Documentation

- Reviewer: fixed existing `documentation_reviewer`, explicitly dispatched at
  `gpt-5.6-luna` / `medium`; independent runtime introspection remains
  unavailable with no visible mismatch or fallback.
- Disposition: the user guide retains old 512/255 limits, FK/index and eager
  fixed-table claims, Entity fingerprint, universal `writeAll` transaction, and
  close-promise/error wording. It also misstates scope as containing record type.
- README's top-line transactional claim and REFERENCE's CRUD/CAS wording require
  engine qualification. The README link is valid; updated REFERENCE layout,
  lazy schema, engine support, close signature, and Entity semantics are clean.

## Final Test And Prose Correction Dispatch

- Owner: reuse current `implementer`, explicitly configured
  `gpt-5.6-terra` / `medium`, for only the revision assertion, canonical-codec
  error mapping, typed cast/test seam, and enumerated prose corrections.
- Re-review only the four affected concerns after focused verification; no
  additional broad review cycle is required if clean.

## Final Test And Prose Correction Result

- Primitive-ID failures reject asynchronously as sanitized operation errors
  before connection acquisition; the remaining production generic casts are
  removed; current-table inspection uses a non-public typed testing seam.
- The live replay regression now asserts `_revision` equality before and after
  identical retry. Single-tenant, multitenant, and missing-row seam cases pass.
- README, REFERENCE, and user-guide MySQL claims were corrected to the current
  layout, engine behavior, lazy lifecycle, and `close(): void` contract.
- Coverage passes 78 tests at 94.25% statements, 90.28% branches, 94.03%
  functions, and 95.77% lines. Package TypeScript, changed lint, Prettier,
  TSDoc, documentation audience, and diff checks pass.

## Final Narrow Re-Review Dispatch

- Re-review only revision stability/reliability, canonical-ID/API typing,
  cast/test-seam maintainability, and corrected documentation with the existing
  four reviewers at their previously recorded explicit profiles.

## Final Narrow Re-Review Results

- Reliability: CLEAN. Revision stability is directly verified; prior lock,
  retry, nontransactional, and cleanup findings remain resolved.
- TypeScript/API docs: CLEAN. Canonical-ID validation/error mapping, public
  exports, private test seam, and close/layout contracts are correct; the only
  unavailable gate remains downstream integration-train API-doc compilation.
- Style/maintainability: P2 corrections remain for Entity-ID intersection casts,
  older live-test structural casts, and duplicated `_scope` encoding in the
  test seam. The seam is otherwise correctly non-public.
- Documentation: stale user-guide eager/FK-index/fingerprint/close-promise and
  universal-transaction passages remain; REFERENCE needs engine-qualified CAS;
  README's user-guide fragment must target the actual MySQL heading. The exact
  224/768 layout is now correct.

## Mechanical Closeout Correction Dispatch

- Owner: reuse current `implementer`, explicitly configured
  `gpt-5.6-terra` / `medium`, for the three typed-helper P2s and exact prose/link
  edits only. Runtime semantics and public contracts are frozen.

## Mechanical Closeout Result

- Entity-ID erasure/intersection casts are removed through a typed canonical-key
  capability boundary. Production and the non-public testing seam share one
  `_scope` encoder. Remaining user-guide/README text and link are corrected.
- Focused tests pass 47/47; live InnoDB passes 9/9; coverage passes 78 tests at
  93.95% statements, 90.28% branches, 93.15% functions, and 95.45% lines.
- Package TypeScript, lint, TSDoc, documentation audience, Prettier, and diff
  checks pass.
- Only style/maintainability and documentation are reopened for final spot
  review; reliability and API remain clean because runtime/public contracts did
  not change beyond the already verified typed implementation.

## Direct Micro-Correction Result

- Replaced every remaining live-test structural cast with typed table/current/
  history helpers in the non-public testing seam. The helpers derive the same
  default family names and share the production scope encoder.
- Corrected the three remaining engine/`writeAll`/`close(): void` documentation
  contradictions.
- Focused non-live tests pass 47 with nine live skips; live MySQL InnoDB passes
  9/9. Package TypeScript, strict changed-file lint, TSDoc, documentation
  audience, Prettier, and diff checks pass.
- The initial live run exposed only an incorrect test assumption that a newly
  inserted current row has revision greater than zero; the corrected test checks
  row existence while the dedicated replay test checks exact revision stability.

## Final Review Disposition

- Performance/reliability: CLEAN. No P0-P3 remains.
- TypeScript/API docs: CLEAN. No P0-P3 remains; repository API generation is
  blocked before provider inspection only by recorded downstream train errors.
- Style/maintainability: CLEAN after deterministic removal of the remaining
  live-test structural casts, shared production/test scope encoding, and exact
  textual BIGINT revision decoding.
- Documentation: CLEAN after deterministic correction of grouped default table
  naming, engine-specific CRUD/CAS and `writeAll`, `close(): void`, and the
  MySQL guide link. The final snippet, audience, formatting, and link-oriented
  review evidence passes.
- Security: N/A for the concrete reason recorded in Review Wave 1 dispatch.
- Runtime metadata: every reviewer used the explicitly dispatched immutable
  role/profile. Independent model self-introspection was unavailable throughout;
  no visible mismatch, inherited fallback, or redispatch condition occurred.
- Final `verify:task` ran once after convergence. Proto generation, 49 source
  checksums, authored/example Proto style, and 52 frozen descriptors passed;
  repository `tsc -b` then stopped only on the recorded downstream
  deployment/server/Datastore/Message Board train migrations. No T-0134
  provider diagnostic appeared.

## Wave 2 Correction Disposition

- Accepted: private Entity-family commit capability, canonical Entity lock,
  lifecycle, bounds, retryable readiness, canonical IDs, typed errors,
  zero-sort continuation, non-InnoDB CAS serialization, and public factory
  declaration cleanup.
- Canonical-name trigger and present/absent two-handle CAS races pass on MySQL
  InnoDB/MyISAM and MariaDB InnoDB/Aria. The missing-key deadlock is bounded by
  one `ER_LOCK_DEADLOCK` retry.
- Provider coverage is 94.06% statements, 90.01% branches, 93.83% functions,
  and 95.82% lines. Package TypeScript, ESLint, Prettier, TSDoc, audience, and
  diff checks pass.
- Limitation: `check-api-docs` cannot complete because unrelated downstream
  packages fail compilation before API inspection.
