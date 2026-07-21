# T-0051 Storage RDBMS Review Log

Status: Packet 1 mechanically accepted; specialist wave deferred to Packet 5

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
