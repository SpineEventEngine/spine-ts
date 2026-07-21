# T-0051 Storage RDBMS Review Log

Status: Converged, accepted, merged, post-merge verified, and pushed

## Human Requirements

Reviewers must evaluate the full ledger in
`build-protocol/tasks/T-0051-storage-rdbms/TASK.md`, especially the single
MySQL-first package, future PostgreSQL honesty, existing storage-port fidelity,
parameterized SQL, transaction/CAS semantics, tenant isolation, value encoding,
resource ownership, real MySQL proof, and no speculative public SQL surface.

## Concern Dispositions

- Style/maintainability: required for the new package/module structure and SQL
  implementation.
- Documentation: required for package README, TypeDoc, user guide, configuration,
  limitations, and MySQL development workflow.
- TypeScript/API docs: required for the new public package root, options,
  exported factory/error types, workspace graph, and compatibility.
- Performance/reliability: required for SQL pushdown, indexes, batching,
  transactions, compare-and-set, pool lifecycle, failure atomicity, and real
  MySQL behavior.
- Security: no separate per-task lane under project policy. SQL injection,
  credentials, tenant isolation, and provider-error redaction remain mandatory
  checks within API/reliability review and final project security readiness.

## Planned Review Cadence

- Freeze one immutable endpoint after implementation and focused verification.
- Run all four relevant existing reviewer lanes concurrently.
- Aggregate P0-P3 findings into one correction batch and rerun only
  substantively affected lanes, with no more than two complete waves unless a
  P0/P1 risk remains.

## Packet 1 Endpoint Notes

- Scope is limited to package scaffold/public root, owned async pool lifecycle,
  fixed two-table InnoDB schema initialization and verification, direct-driver
  dependency/harness decision, TypeDoc registry, and durable records.
- Mechanical evidence supplied by the implementer and independently rerun by
  the orchestrator: focused factory suite (5 tests), generated TypeScript
  build, focused ESLint and Prettier, TypeDoc/API validation,
  `git diff --check`, and opt-in real MySQL 8.4.10 suite (1 concurrent
  initialization/cleanup test) all pass.
- Review must reject any claim that Packet 2 CRUD/query behavior is available;
  record operations intentionally remain deferred.
- No specialist lane ran at this intermediate packet. The task plan preserves
  one complete four-concern review wave over the immutable Packet 5 endpoint.

## Packet 2 Interim Evidence

- RED/GREEN CRUD and codec evidence is recorded in the T-0051 work log.
  Packet 2 is accepted; no specialist review is due before Packet 5.
- The Packet 2 schema/codec sub-slice now has local mechanical evidence for the
  v3 width/index/FK shape and sortable provider-honest values. Specialist
  review remains deferred; no Packet 5 endpoint claim is made here.
- The adversarial CRUD acceptance extension has live MySQL 8.4.10 evidence for
  binary tenant/ID isolation, corrupt-payload and provider-error distinction,
  metadata nullability, cascade cleanup, stale columns, and transaction
  rollback. The final specialist wave remains deferred to Packet 5; this is
  mechanical implementation evidence only.

## Packet 5 Pre-Review Evidence

- The endpoint has focused behavior proof for factory/handle lifecycle,
  in-flight close, pool-close failure observation, CRUD/delete, batch rollback,
  CAS states, dynamic tenancy, schema refusal, query binding, canonical codecs,
  and public-error sanitation. The private cleanup callback has no public API
  effect and no unsafe generic assertion.
- Focused RDBMS coverage is above the required floor in all dimensions:
  factory 318/332 lines (95.78%), 154/171 branches (90.05%), and 67/71
  functions (94.37%); codec 94/96 lines (97.92%), 112/121 branches (92.56%),
  and 10/10 functions (100%). The 12 external-MySQL cases are intentionally
  skipped when `SPINE_TS_MYSQL_URL` is absent; prior Packet 2 live MySQL 8.4.10
  evidence remains the real-engine proof.
- Focused test, generated build/typecheck, targeted lint, Prettier, TypeDoc/API
  checks, release-readiness inventory, and `git diff --check` passed. A first
  canonical full-coverage attempt was invalidated by a concurrent process that
  removed Vitest's shared `coverage/.tmp`; it is a shared-worktree execution
  limitation and must be rerun uncontended before final task acceptance.
- Documentation/release audit keeps MySQL 8.4.10/mysql2 3.23.1 as the tested
  scope, PostgreSQL as unsupported future work, and the public package inventory
  limited to the factory, options, and five sanitized error types. All four
  specialist concerns remain required and unreviewed.

## Packet 5 Final Pre-Review Gate And Assignments

- The uncontended canonical coverage command passed 82 files with three
  skipped, 1,897 tests with 20 skipped, and repository coverage of 94.44%
  statements, 90.14% branches, 94.69% functions, and 94.91% lines. The RDBMS
  package remained above its focused floor at 95.04% statements, 91.09%
  branches, 95.06% functions, and 96.26% lines. The earlier ZeroMQ zero-coverage
  merge result did not recur and was a concurrent/shared-output artifact.
- The opt-in acceptance command against the disposable MySQL 8.4.10 instance
  at the explicitly selected local test URL passed all 12 cases. Credentials
  are not copied into this review record.
- The lightweight pre-review audit found and corrected only stale Packet 5
  status/evidence. It found no duplicated policy owner, accidental public
  driver/SQL export, speculative PostgreSQL behavior, generated output, or
  review scratch material. End-user snippets use public package roots and the
  existing provider-neutral storage seam.
- Wave 1 assignments are all required. Style/maintainability uses the existing
  `style_maintainability_reviewer` with explicitly dispatched
  `gpt-5.6-terra` / `high`. Documentation uses the existing
  `documentation_reviewer` with explicitly dispatched `gpt-5.6-luna` /
  `medium`. TypeScript/API uses the existing `typescript_api_docs_reviewer`
  with explicitly dispatched `gpt-5.6-terra` / `high`.
  Performance/reliability uses the existing
  `performance_reliability_reviewer` with explicitly dispatched
  `gpt-5.6-terra` / `high`. Runtime self-introspection will be recorded from
  each result when exposed; otherwise the immutable configured role/profile
  and explicit dispatch are the accepted metadata under the current protocol.

## Packet 5 Specialist Wave 1 Results

- All four required concerns completed against frozen baseline-to-worktree
  digest `c3ec4626bfe183e7d9a55e4bc4e19684ad65b3d0`. Independent runtime
  self-introspection was unavailable in every lane. The accepted metadata is
  the explicit dispatch plus immutable configured role/profile: style,
  TypeScript/API, and performance/reliability were `gpt-5.6-terra` / `high`;
  documentation was the immutable `documentation_reviewer` at
  `gpt-5.6-luna` / `medium`. The surface rejected Luna as a general model
  override, so the exact configured role selection and prompt-stated profile
  are recorded honestly instead of inventing runtime metadata.
- No P0 or P1 finding exists. Seven P2 findings are accepted as one correction
  batch: keep SQL clause text and values together during query compilation;
  state that every factory startup requires `CREATE TABLE IF NOT EXISTS`
  privilege; add the 255-byte materialized-column-name bound to the user guide;
  document `RecordSpec` duplicate-column rejection; sanitize pool-close
  failures while preserving one shared observable close promise; impose and
  document private query-structure bounds before pool acquisition; and prove
  in-flight close ordering against real MySQL.
- One P3 is accepted because it is a mechanical clarification: rename the
  lifecycle test so it claims only the externally observed manual-close/live-
  handle behavior rather than internal unregistration. No internal retention
  inspection will be added.
- The existing Packet 5 implementer context receives this complete batch with
  explicit `gpt-5.6-terra` / `medium`. Documentation and TypeScript/API must be
  rerun because public prose/TSDoc changes substantively. Style and reliability
  must be rerun because SQL composition, close error mapping, query limits, and
  the live lifecycle suite change substantively.

## Packet 5 Wave 1 Correction Evidence

- Implementer dispatch was explicitly `gpt-5.6-terra` / `medium`; runtime
  self-introspection is unavailable on this surface. The complete accepted P2
  and P3 batch is corrected without public SQL/API expansion, threshold or
  configuration weakening, unrelated cleanup, commit, push, or reviewer work.
- Style/maintainability findings are resolved by paired private SQL
  clause/value composition in exact statement order and an externally
  observable manual-close test name. The bind-order test covers multi-kind
  filter joins, continuation, and offset in one compiled query.
- Documentation findings are resolved in the package README and user guide:
  every startup requires `CREATE TABLE IF NOT EXISTS`, materialized column
  names are limited to 255 UTF-8 bytes, and close/query-limit behavior is stated
  exactly. TypeScript/API findings are resolved by documenting public
  `RecordSpec` duplicate-column-name rejection in TSDoc and API prose.
- Reliability findings are resolved by sanitized pool-close mapping with one
  retained close promise, private pre-acquisition limits of 256 IDs, 32
  filters, 64 values per filter, eight sorts, and 2,048 total binds, plus a
  private admission/drain gate that delays pool closure until acquired
  operation connections release.
- Unit RED reproduced provider error disclosure and both component/aggregate
  query overflow; live RED reproduced an admitted write interrupted by pool
  shutdown. GREEN verification passes 49 focused tests and focused coverage at
  95.18% statements, 91.13% branches, 95.55% functions, and 96.52% lines.
- The opt-in MySQL 8.4.10 suite passes 13/13. Its new deterministic case holds a
  target-row lock with a control transaction, observes the admitted adapter
  write blocked without sleep-based timing, proves close rejects new work and
  waits, then releases the lock and observes write and factory close complete.
  It needs no `LOCK TABLES` or privilege expansion.
- Generated build typecheck, focused ESLint, Prettier, generated TypeDoc/API,
  release-readiness, and diff checks pass. A transient concurrent Protobuf
  generation collision was repaired and verified sequentially. The separate
  tooling typecheck continues to report the pre-existing mysql2 test-fake
  row-typing backlog; the new process-row helper extends `RowDataPacket`.
- Every concern is substantively affected, so documentation, TypeScript/API,
  style/maintainability, and performance/reliability all remain required for
  re-review against the corrected endpoint.

## Packet 5 Affected Re-Review Assignments

- A final local accuracy pass clarified that the documented 512/255/768-byte
  boundaries apply to canonical encodings, not raw user strings. This is part
  of the already-required documentation re-review and changes no runtime or
  public type.
- Style/maintainability, TypeScript/API, and performance/reliability re-review
  use their existing roles with explicitly dispatched `gpt-5.6-terra` /
  `high`. Documentation re-review uses the immutable existing
  `documentation_reviewer`, configured as `gpt-5.6-luna` / `medium`; the
  surface limitation on a general Luna model override remains recorded above.
  Each lane is read-only, receives the corrected baseline-to-worktree digest,
  and must limit findings to the accepted corrections or regressions they
  expose.

## Packet 5 Affected Re-Review Results

- Style/maintainability, documentation, and TypeScript/API re-review are clean
  with no P0-P3 findings. Performance/reliability accepts all runtime
  corrections but returns one P2 regression-proof gap: tests cover acquisition
  failure and successful admitted-operation drain separately, but not a pending
  acquisition that rejects while factory close is waiting.
- The P2 is accepted as the final targeted correction after the second review
  wave. Add one deterministic fake-pool case that gates `getConnection()`,
  starts close, proves the pool has not ended, rejects acquisition, then proves
  sanitized operation failure, admission release, exactly one pool end, and
  close completion. Runtime behavior is already structured for this path; no
  production redesign, third full review wave, or public API/docs change is
  authorized.
- The existing implementer context receives this test-only correction with
  explicit `gpt-5.6-terra` / `medium`. Focused lifecycle tests, RDBMS coverage,
  typecheck/lint/format/diff, and live MySQL regression are required before
  convergence.

## Packet 5 Final-Gate Tooling Typecheck Correction

- Independent full `pnpm --config.verify-deps-before-run=false verify` reached
  `typecheck:tooling` and failed on T-0051 test typing: mysql2 query result
  shapes did not extend `RowDataPacket`, two fake call records materialized an
  explicit `undefined` under exact optional properties, and several test values
  lacked safe narrowing. This is task-owned test code, not accepted baseline
  debt or an environmental limitation.
- The existing implementer receives one mechanical test-only TypeScript batch
  with explicit `gpt-5.6-terra` / `medium`. It may correct declarations,
  optional-property construction, and assertions without changing runtime,
  public API, docs, query behavior, thresholds, or review dispositions. The
  tooling typecheck, focused/live tests, and full `pnpm verify` must pass before
  acceptance. Mechanically provable typing corrections do not open a third
  specialist wave.

## Packet 5 Orchestrator Acceptance

- All four required concern dispositions have converged. Wave 1 findings were
  corrected in one batch; affected style, documentation, and TypeScript/API
  re-reviews are clean. Reliability's final P2 test-proof gap was corrected
  mechanically under the two-wave limit. No P0/P1 or accepted unresolved P2
  remains; the P3 test-name clarification is resolved.
- Full `pnpm --config.verify-deps-before-run=false verify` passes: ordinary and
  coverage runs each pass 82 files with three skipped and 1,901 tests with 21
  skipped. Coverage is 94.45% statements, 90.14% branches, 94.71% functions,
  and 94.93% lines. Typecheck/build/tooling, lint/cleanup, Prettier, TypeDoc/API,
  Protobuf lint/generated cleanliness, and release readiness all pass.
- Independent final MySQL 8.4.10 acceptance passes 13/13. T-0051 is accepted
  for commit, immediate task-branch push, main integration, post-merge
  verification, and main push.

## T-0051 Integration Closure

- Accepted Packet 5 commit `c4a0ba52` was pushed to
  `origin/task/T-0051-storage-rdbms`. The complete task branch was merged into
  `main` as `81a6b335` and pushed immediately to `origin/main`; local and remote
  refs were confirmed equal at both boundaries.
- After refreshing main's lockfile-pinned workspace links, post-merge
  `pnpm --config.verify-deps-before-run=false verify` passed. Ordinary and
  coverage runs each passed 82 files with three skipped and 1,901 tests with 21
  skipped; coverage remained 94.45% statements, 90.14% branches, 94.71%
  functions, and 94.93% lines. TypeScript build/tooling, lint/cleanup, Prettier,
  TypeDoc/API, Protobuf lint/generated cleanliness, and release readiness all
  passed.
- Post-merge MySQL 8.4.10 acceptance passed 13/13. T-0051 has no unresolved
  review finding, verification gap, integration step, or remote-sync action.

## Packet 5 Final Targeted Correction Evidence

- The existing `implementer` completed the accepted test-only P2 with explicit
  configured profile `gpt-5.6-terra` / `medium`; independent runtime
  self-introspection is unavailable. No third specialist wave is opened under
  the two-wave limit.
- A deferred fake `getConnection()` now proves the previously uncovered
  interleaving: admission precedes factory close, close remains unsettled and
  pool end remains at zero, acquisition rejection becomes a sanitized
  `MysqlStorageOperationError`, the admission drains, pool end runs exactly
  once, and close completes. Production and public/documentation surfaces are
  unchanged.
- RED failed because the fake lacked its acquisition gate while 36 existing
  lifecycle tests passed. GREEN passes 37/37 lifecycle tests. Focused coverage
  passes 50/50 at 95.18% statements, 91.13% branches, 95.55% functions, and
  96.52% lines.
- Generated build/typecheck, targeted ESLint, Prettier, and diff checks pass.
  The initial live command was blocked by sandbox loopback policy; its approved
  rerun against MySQL 8.4.10 passes 13/13. The accepted re-review finding is
  therefore resolved and the correction cycle has converged for orchestrator
  acceptance.

## Packet 5 Final-Gate Tooling Correction Evidence

- The existing `implementer` used the explicit configured
  `gpt-5.6-terra` / `medium` profile; runtime self-introspection is unavailable.
  The task-owned tooling RED covered only test declaration/narrowing errors:
  mysql2 row constraints, exact optional properties, safe result/byte access,
  callback inference, and fixture shape retention.
- Named `RowDataPacket` interfaces, conditional fake record construction, one
  narrow missing-row guard, one typed callback, and one fixture spread resolve
  all errors without casts or behavior/public/docs changes.
  `pnpm typecheck:tooling` and composite build/typecheck are green.
- Focused coverage passes 50/50 at 95.18% statements, 91.13% branches, 95.55%
  functions, and 96.52% lines; MySQL 8.4.10 passes 13/13. Targeted lint,
  Prettier, and diff checks pass. Seven cleanup line-length findings found by
  the first full gate were wrapped mechanically, preserving exact runtime SQL.
- The sandboxed full test stage was invalidated by denied loopback/IPC binds.
  On the approved capable surface, the complete
  `pnpm --config.verify-deps-before-run=false verify` passes: both ordinary and
  coverage runs pass 82 files with three skipped and 1,901 tests with 21
  skipped; repository coverage is 94.45% statements, 90.14% branches, 94.71%
  functions, and 94.93% lines. TypeDoc/API, Protobuf lint/generated cleanliness,
  and release readiness at 60 imports/120 links also pass.
- This deterministic mechanical correction does not reopen specialist review.
  The Packet 5 endpoint is final-gate verified for orchestrator acceptance.
