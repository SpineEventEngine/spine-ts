# T-0070R Review Record

Status: Ready for targeted re-review

## Scope

MySQL implementation of the frozen current/state/event-history SPI,
provider-native bounded maintenance, durable compatibility identity, retry and
concurrency behavior, lifecycle, tests, and package documentation.

## Planned Concern Dispositions

| Concern                          | Status  | Reason                                       |
| -------------------------------- | ------- | -------------------------------------------- |
| Style and maintainability        | Pending | Provider implementation changes production.  |
| Documentation completeness       | Pending | README behavior claims changed.              |
| TypeScript and API compatibility | Pending | Provider factory/internal SPI usage changes. |
| Performance and reliability      | Pending | Persistence/concurrency/bounds are central.  |
| Final security                   | N/A     | No new external trust boundary is planned.   |

## Mechanical Gate — 2026-07-24

- Generated and tooling typechecks pass.
- The complete fake-backed MySQL factory suite passes 54 tests.
- The disposable MySQL 8.4.10 live suite passes 15 tests, including durable
  history reopen/fingerprint, large histories, cross-factory locking,
  append/trim concurrency, and retry behavior.
- Repository lint/cleanup, formatting, TypeDoc/API, generated-output
  cleanliness, release readiness, and diff hygiene pass.
- The implementation is ready for one complete specialist review wave.

## Review-Wave Assignments

| Existing role                      | Bounded concern                                              | Expected configured profile |
| ---------------------------------- | ------------------------------------------------------------ | --------------------------- |
| `style_maintainability_reviewer`   | MySQL module structure, SQL organization, test maintenance   | `gpt-5.6-terra`, high       |
| `documentation_reviewer`           | MySQL setup/history/locking/partial-failure claims/snippets  | `gpt-5.6-luna`, medium      |
| `typescript_api_docs_reviewer`     | Factory/internal SPI declarations, exports, dependency shape | `gpt-5.6-terra`, high       |
| `performance_reliability_reviewer` | Transactions, locks, retry, chunks, close, pool lifecycle    | `gpt-5.6-terra`, high       |

The Desktop surface selects immutable existing-role profiles. Each reviewer is
read-only, may not spawn children, and returns all confirmed findings in this
single wave. Actual runtime self-introspection is recorded when available;
otherwise the immutable configured role/profile and limitation are evidence.

## TypeScript/API Result

- Actual runtime self-introspection was unavailable. The accepted immutable
  existing-role profile is `typescript_api_docs_reviewer`,
  `gpt-5.6-terra` / high, matching the recorded dispatch.
- P1: `packages/storage-rdbms/package.json` adds the direct runtime Proto
  dependency, but the RDBMS importer in `pnpm-lock.yaml` does not contain it;
  a frozen-lockfile install would reject the branch.
- P2: root `MysqlStorageFactory.createEntityStorage()` emits the unexported and
  undocumented concrete `MysqlEntityStorage` return type. Use a documented
  provider-handle structural/interface type or deliberately export and document
  the concrete class.
- MySQL-only/future-PostgreSQL claims, factory configuration shape, and the
  remaining root export list are clean.
- Disposition: both findings join the complete implementation correction batch
  after the remaining lanes return.

## Performance/Reliability Result

- Actual runtime self-introspection was unavailable. The accepted immutable
  existing-role profile is `performance_reliability_reviewer`,
  `gpt-5.6-terra` / high, matching the recorded dispatch.
- P1: every entity lease monkey-patches pooled `PoolConnection.release` and
  `destroy`; reuse nests wrappers and retained closures without bound. Use a
  per-acquisition lease object without mutating the pooled connection.
- P1: the four lazy entity tables are created but never shape/index verified,
  so malformed pre-existing tables can violate immutable identity or atomic
  fingerprint binding.
- P1: state/event truncate rescans live eligible rows without an initial stable
  high-water key; concurrent eligible appends can be removed by the active
  invocation.
- P1: entity versions, timestamp seconds, and nanos reach signed MySQL columns
  without pre-connection range validation.
- P1: event append treats every insert error as a duplicate retry; only
  `ER_DUP_ENTRY` may enter durable comparison.
- P1: readiness, acquisition, reads, current writes, and truncate can expose raw
  driver errors despite the package sanitization contract.
- The same-connection state append/trim transaction, `GET_LOCK` ordering,
  bounded trim, poisoned release, and active-chunk close behavior are otherwise
  aligned with the accepted design.
- Disposition: all P1 findings join the complete implementation correction
  batch and block acceptance.

## Style/Maintainability Result

- Actual runtime self-introspection was unavailable. The accepted immutable
  existing-role profile is `style_maintainability_reviewer`,
  `gpt-5.6-terra` / high, matching the recorded dispatch.
- P1: `entityPool()` is the cast-and-monkey-patched `Pool` façade explicitly
  rejected by the accepted design. Replace it with a small typed per-acquisition
  connection lease; entity storage should depend only on that seam.
- P2: generic truncate switches durable identity and SQL predicates via
  `table.endsWith("states")`. Use explicit state/event operations or a typed
  descriptor rather than a table-name convention.
- P2: the untracked new `entity-history.ts` escaped repository formatting and
  has widespread over-120-character DDL/SQL lines. Format and reflow it.
- P3: release-failure tests assert an absolute setup-sensitive release count;
  prefer a baseline/delta assertion.
- Targeted ESLint is clean. Disposition: P1/P2 join the correction batch; P3 is
  non-blocking but may be corrected with the touched test.

## Documentation Result

- Actual runtime self-introspection was unavailable. The accepted immutable
  existing-role profile is `documentation_reviewer`,
  `gpt-5.6-luna` / medium.
- P1: the user guide promises truncate leaves concurrently appended eligible
  rows for later calls, but current truncate has no stable high-water boundary.
- P1: the RDBMS README promises universal idempotent/divergent-safe retries,
  while event append currently treats every insert failure as a retry.
- P2: the README omits trim unknown-commit and truncate partial-row-deletion
  failure semantics and the exact caller-retry guarantee.
- PostgreSQL remains future-only and no remote history API is claimed.
- Disposition: correct the claims only after the reliability fixes establish
  the actual behavior.

## Complete Wave Disposition

- All four canonical concerns returned. The wave contains multiple accepted P1
  and P2 findings; none is waived.
- Return one aggregated correction batch to the existing transaction
  implementation context. Re-review reliability, API, and documentation after
  behavior/API corrections; style re-review is limited to the lease/truncate
  structure and formatting.

## Aggregated Correction Evidence

- The pooled-connection monkey patch was replaced by a typed per-acquisition
  lease and exported structural entity handle.
- All lazy entity tables now fail-closed verify columns, nullability, InnoDB,
  primary keys, and required state/event index order before row access.
- State/event truncate use explicit key-only fixed high-water paths with
  bounded transactions, strict boundaries, partial-failure/caller-retry
  behavior, and deterministic concurrent-append coverage.
- Signed numeric/timestamp values validate before acquisition; event retry
  comparison is duplicate-only; readiness, current/history reads, stateAt, and
  truncate sanitize provider errors while preserving specific framework/data/
  schema errors.
- The RDBMS lockfile importer and frozen install are correct; public handle,
  README, user guide, SQL formatting, and partial-failure/topology claims are
  current.
- Mechanical evidence passes: fake suite 72/72 twice, live MySQL 16/16,
  generated/tooling typechecks, lint/cleanup, format, TypeDoc/API,
  generated-output cleanliness, release readiness, and diff hygiene.

## Re-review Assignments

The same affected immutable profiles re-review only their prior findings:
API/reliability/style `gpt-5.6-terra` / high and documentation
`gpt-5.6-luna` / medium. Runtime self-introspection limitations remain recorded.

## API Re-review Result

- Clean. Lockfile/runtime dependency consistency, exported structural handle,
  root factory declaration, internal concrete class boundary, and TypeDoc are
  coherent with no remaining or new P0-P3 finding.
- Runtime self-introspection remains unavailable; the accepted immutable
  profile is `typescript_api_docs_reviewer`, `gpt-5.6-terra` / high.

## Reliability Re-review Result

- Actual runtime self-introspection remains unavailable; the accepted immutable
  profile is `performance_reliability_reviewer`,
  `gpt-5.6-terra` / high.
- P1: truncate's captured identity-key high-water is not a true insertion
  cutoff. A concurrent eligible append with a lower arbitrary entity/event key
  can still be selected and deleted. Use a provider-durable monotonic write
  cutoff and add lower-key concurrent-append proofs.
- P1: duplicate-event reconciliation acquisition/SELECT failures can escape raw
  provider errors after `ER_DUP_ENTRY`; sanitize them while retaining explicit
  divergent-content errors.
- Typed leases, schema verification, pre-acquisition numeric validation,
  non-duplicate event classification, reviewed error paths, GET_LOCK
  transaction shape, release poisoning, close, and retry remain clean.
- Disposition: both P1 findings require one focused correction and reliability
  confirmation before acceptance.

## Style Re-review Result

- Actual runtime self-introspection remains unavailable; the accepted immutable
  profile is `style_maintainability_reviewer`,
  `gpt-5.6-terra` / high.
- P2: 11 SQL/source lines in `entity-history.ts` still exceed the independent
  120-character cleanup rule even though Prettier passes.
- P2: entity table shape is duplicated between DDL and independently maintained
  verification expectations, creating schema-drift risk. Consolidate or
  co-locate one authoritative description.
- Typed leases, explicit state/event truncate paths, delta-based release test,
  and targeted Prettier are clean.
- Disposition: both P2 findings join the active final correction batch.

## Correction Evidence — 2026-07-24

- The correction owner remains the explicitly dispatched existing
  `implementer`, `gpt-5.6-terra` / `medium`; actual runtime model
  self-introspection is unavailable on this surface, and no fallback is
  visible.
- The RDBMS lockfile importer now declares its direct workspace Proto runtime
  dependency. `pnpm install --lockfile-only` did not rewrite the stale importer,
  so the equivalent deterministic workspace link was recorded directly.
  `pnpm install --frozen-lockfile` then passed with registry-assisted dependency
  restoration and reported the lockfile up to date.
- The exported `MysqlEntityStorageHandle`, factory TypeDoc, package README, and
  user guide now describe the provider-only independently closeable handle,
  factory ownership, MySQL-only topology, verified lazy schema, bounded
  maintenance/high-water behavior, precise retry/error semantics, and current/
  history non-atomicity. PostgreSQL remains future-only and no remote history
  API is claimed.
- The fake release-failure proof now uses an operation-local release delta;
  entity DDL is reflowed/formatted. The live suite adds direct entity-index and
  strict-boundary truncate coverage.
- Fresh mechanical evidence: focused fake suite 72/72 twice; generated and
  tooling typechecks pass; disposable MySQL suite 16/16; lint/cleanup, format,
  TypeDoc/API docs, generated-proto cleanliness, release readiness, and diff
  hygiene pass.
- Required re-review dispositions: reliability, TypeScript/API, documentation,
  and the affected style/format structure. This evidence does not accept the
  task or waive any prior review finding.

## Reliability P1 Correction — 2026-07-24

- State/event truncate now capture one strict-time, provider-generated unsigned
  `write_order` cutoff, then delete only key-selected 128-row chunks whose
  write order is at or below that cutoff. The schema requires a unique
  write-order index on each history table, and DDL plus verification derive from
  one entity-schema descriptor. This prevents an eligible append with a lower
  lexical identity key after cutoff from being removed.
- Event `ER_DUP_ENTRY` reconciliation now sanitizes provider failures from its
  acquisition, lookup, and release path while retaining the deterministic
  divergent-content error.
- Fresh evidence: focused fake suite 78/78 twice, generated/tooling typechecks,
  MySQL suite 16/16, lint/cleanup, format, TypeDoc/API docs, generated-proto
  cleanliness, release readiness, and diff hygiene all pass. The task remains
  ready for targeted reliability/style re-review, not accepted.

## Final Targeted Reliability Re-review — 2026-07-24

- Actual runtime self-introspection remains unavailable; the accepted explicit
  immutable profile is `performance_reliability_reviewer`,
  `gpt-5.6-terra` / high.
- P1: provider acquisition or cleanup failures can still escape unsanitized
  from current reads, state append/trim, truncate chunk acquisition, and
  duplicate-event reconciliation release. These paths must consistently emit
  `MysqlStorageOperationError` while preserving deliberate framework/data
  errors.
- P1: readiness does not verify that `write_order` is database-generated
  `AUTO_INCREMENT` or that its required index is unique. A malformed existing
  table can pass readiness without the invariant needed by the truncate
  cutoff.
- The former lexical-identity high-water flaw is resolved by `write_order`, and
  duplicate reconciliation lookup/acquisition sanitization is resolved. Lock,
  transaction, chunk, close, retry, and partial-failure behavior remains clean.

## Final Targeted Style/Maintainability Re-review — 2026-07-24

- Actual runtime self-introspection remains unavailable; the accepted explicit
  immutable profile is `style_maintainability_reviewer`,
  `gpt-5.6-terra` / high.
- The line-length finding is resolved.
- P2: the schema descriptor still duplicates independent DDL literals and does
  not authoritatively model or verify auto-increment behavior or index
  direction. Generate DDL and verification expectations from one descriptor,
  including the properties required by the durable cutoff.

## Closure Re-review — 2026-07-24

- Actual runtime self-introspection remained unavailable. The accepted
  explicit reviewer profiles were `performance_reliability_reviewer` and
  `style_maintainability_reviewer`, both `gpt-5.6-terra` / high.
- P1 reliability: `backwardStates`, `stateAt`, and `backwardEvents` release
  their connection directly. Cleanup failures can leak provider details or
  override a prior data/operation result. Route them through the centralized
  release/error-precedence helper and add focused failure-injection tests.
- P2 style: nullability and the InnoDB engine remain duplicated between DDL
  generation and verification. Add them to the authoritative schema
  descriptor/constants consumed by both.
- All prior cutoff, auto-increment/unique/direction verification, lock,
  transaction, retry, close, schema, and line-length findings are resolved.

## Final Acceptance Re-review — 2026-07-24

- Actual runtime self-introspection remained unavailable. The accepted
  explicit `performance_reliability_reviewer` and
  `style_maintainability_reviewer` profiles are both
  `gpt-5.6-terra` / high.
- Clean: no reliability or style finding remains.
- `ready()` and `createSchema()` use centralized cleanup sanitization while
  preserving selected schema/fingerprint errors. The authoritative schema,
  monotonic cutoff, leases, locks, retries, bounded chunks, line length, and
  diff hygiene are accepted.

## Final correction response — 2026-07-24

- Reliability P1 disposition: corrected. Acquisition/release injection covers
  current reads, state append/trim, state/event truncate, and duplicate-event
  reconciliation; provider details are translated to `MysqlStorageOperationError`.
  Deliberate data, closed, and divergent outcomes retain precedence over a
  subsequent cleanup failure.
- Reliability P1 cutoff-readiness disposition: corrected. The schema verifier
  checks normalized column type, `EXTRA=auto_increment`, index uniqueness, and
  `COLLATION` direction. Malformed fake metadata fails before row access; live
  MySQL checks assert both write-order invariants.
- Style P2 disposition: corrected. `entityHistorySchema` is the single model
  for columns, MySQL-normalized types, generated DDL, uniqueness, and direction;
  storage-factory expectations and fake metadata derive from it.
- Evidence: generated/tooling typechecks; focused fake suite 87/87 twice;
  explicit local MySQL suite 16/16. Awaiting reviewer acceptance; this record
  does not self-accept the milestone.

## Narrow closure correction response — 2026-07-24

- Reliability P1 disposition: corrected. State backward, state-at, and event
  backward pass cleanup through the centralized release helper. New injected
  cleanup tests prove sanitized operation errors, and a simultaneous state
  payload decode failure remains a data error.
- Style P2 disposition: corrected. Required column nullability and engine are
  descriptor-owned values consumed by DDL generation, fake metadata, and live
  readiness verification. Malformed values fail closed before history rows are
  queried.
- Evidence: focused fake suite 93/93 twice; generated/tooling typechecks;
  lint/cleanup, format, and diff hygiene; explicit local MySQL suite 16/16.
  Ready for reliability/style closure review; this entry does not self-accept.

## Final lifecycle correction response — 2026-07-24

- Reliability P1 disposition: corrected. `ready()` and `createSchema()` route
  cleanup through the centralized release helper. New injected tests prove
  cleanup-only sanitization and preserve both incompatible-fingerprint and
  schema-error precedence.
- Style P2 disposition: corrected. The DDL column template is split into a
  descriptor helper and is within the project line-length policy.
- Evidence: focused fake suite 96/96 twice; generated/tooling typechecks;
  lint/cleanup, format, diff hygiene; explicit local MySQL suite 16/16. Ready
  for reliability/style confirmation only; this record does not self-accept.

## Coverage correction response — 2026-07-24

- Added real entity-history contract coverage for event ID validation, cursor
  exclusivity, absent state lookup, tenant scope isolation, and idempotent
  handle close. The tests cover more than the seven requested previously
  uncovered decision paths without production changes.
- Evidence: focused suite 100/100, focused V8 coverage, generated/tooling
  typechecks, lint/cleanup, format, and diff hygiene. Full aggregate coverage
  must be confirmed by the orchestrator's unsandboxed run: sandboxed full
  coverage is blocked by unrelated IPC/loopback tests, while this surface did
  not receive a final artifact from the approved rerun.
