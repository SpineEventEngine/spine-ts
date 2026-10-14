# SQL delivery and subscription reliability

Status: complete for the authorized implementation, local verification, review and feature-branch publication; ready for human review. PR-only CI awaits an authorized pull request. Risk: high (persistence, concurrency, delivery and subscription lifecycle, public contracts).
Baseline: freshly fetched official origin/master, 658da1cdddcb8fd40f9205b1c200abc3a58dd62e.
Branch: sql-delivery-subscription-reliability.
Worktree: /Users/armiol/.codex/worktrees/sql-delivery-reliability/spine-ts.
Initial estimate: 10–18 hours including implementation, real database/process/transport acceptance, focused review, corrections, release verification and pushes.

## Human-Imposed Requirements Ledger

The complete binding request is this chat and FIRST_SPINE_TS_DELIVERY_TASK.md in /Users/armiol/development/Spine/spine-ts-and-appfactory (read-only investigation reference). Implement STS-01/02/03/04 and DEL-01/02/03/04/05 (STS-15/16/17/18), including expanded acceptance requirements.

- All edits, installations, generated outputs, tests and records stay in this new worktree. Never touch other checkouts, processes, databases or uncommitted changes. Use unique service names/ports.
- Official origin only; no codex/ branches, master writes, PR creation/merge, published-history rewrites or remote deletion. Immediately push every commit. Include a version-only common unused workspace version commit with exact message Bump version -> <version>; pins/lockfile separately.
- Diagnose failures first. Preserve original internal causes and useful correlated diagnostics, with safe public errors.
- There are no production applications. Legacy support and existing-application data migration are not required; implement corrected scoped contracts directly, with no old-server readiness fallback or migration machinery.
- Correct scalar-list filtering consistently across memory/PostgreSQL/MySQL/MariaDB while preserving actual array-valued fields, parameters, ordering, pagination and tenancy.
- Independent storage operations: remove extra transactions/cross-record locks on primitives, batches, immutable append and Entity saves. Do not recreate atomic multi-record semantics through a coordinator or outbox. Document partial writes and retries.
- Conditional mutations remain atomic; competing processes cannot both acquire a shard. Identical immutable retries succeed; conflicting payloads fail.
- Cleanup checks eligibility then deletes by ID. No rollback, exact-snapshot deletion, post-delete lease/deadline validation. Cancellation stops subsequent work; completed deletes remain.
- Failed infrastructure processing must not become successful delivery, including default policy, throwing monitor and failed selected retry. Distinguish successful processing followed by failed acknowledgement.
- Saved Event recovery retains original Event/ID and never reruns a successful Command. Prove finite Event-only retries and explicit repair of known IDs across restart, partial recipient publication and exhaustion. No blind historical replay, outbox or new persistence contract. Automatic discovery is unproven; expose a precise unresolved decision if necessary after independent work.
- Treat subscription activation/readiness and cancellation/transient failure/stream teardown as one lifecycle concern. No arbitrary sleep/first-business-update readiness.
- Recommend shared Delivery for multiprocess; preserve local Message Board React UI and all single-process Todo modes without it. Orders/Projects small teaching modes may stay local with clear labels. Expose process/shard count and verify eight/eight.
- Default recovery scan becomes configurable 10 seconds; separate stale-session and server-processing timers and test missed notifications/release races/idle scan cost.
- Simple shared Delivery server is in-memory and not durable. SQL business state does not persist its Inbox. Test actual restart/crash with pending accepted IDs and document loss without inventing a durability subsystem or availability guarantee.
- Real PostgreSQL 16/18, MySQL and MariaDB, two/eight processes, database-only/shared Delivery; repeat failing workloads and reconcile every accepted ID with state/projections or explicit terminal outcomes. Count handler executions and inspect actual SQL. Inject each independent-write, processing, monitor, acknowledgement and publication failure. Test duplicate IDs, immutable conflicts, claims, cleanup/shutdown bounds and real transports. Domain-correct generated Protobuf fixtures only.
- Use required model allocation, no child subagents, focused complete review wave and all accepted corrections. Keep narrow API documentation current. Read latest repository/protocol/completion plan and reference evidence; do not restore obsolete guarantees.

## Acceptance and sequence

1. Architecture pass and source/evidence reconciliation; diagnostics first.
2. Independent SQL operations, atomic conditions, list filters and direct cleanup.
3. Processing/acknowledgement/publication reliability and recovery timer.
4. Subscription lifecycle and supported transport acceptance.
5. Example launch settings, real SQL/process matrix, restart/failure acceptance and accurate documentation.
6. Cheap preflight; four concern-specific review dispositions; corrections; verify:release (shared runtime scope), version commit/pins, required exact-SHA CI and remote verification.

## Skill applicability

Session catalog inspected. Read using-git-worktrees, test-driven-development, verification-before-completion, systematic-debugging and requesting-code-review; these govern isolation, regression-first behavior changes, fresh evidence and concern-specific review. Repository expected-skill manifest read. Project protocol supplies planning/review records and existing roles, overriding the generic skill's reviewer role suggestion. Other skills applied only for concrete needs. Explicit user task overrides historical transaction/cleanup records and skill fallback instructions. Desktop tool supports explicit required model/reasoning profiles; no boost selected.

## Dispatch ledger

- Architecture: existing requirements_splitter role; gpt-6-astra, high, explicit dispatch fields required; read-only analysis of frozen scope and supported recovery/lifecycle contracts. Runtime introspection may be unavailable; immutable configured role plus explicit fields is acceptance evidence.

- Implementation: existing implementer role; gpt-6-sol, medium, explicit dispatch; initial scope STS-02 diagnostics and safe public errors with regression tests, then subsequent bounded slices in same context.

- Mechanical setup/scanning function: orchestrator-dispatched default agent, gpt-6-luna, medium, explicit dispatch. Dedicated database provisioning, existing test inventory and evidence only; no runtime edits.

## Final acceptance

The full release gate passes at code checkpoint
`f98d3845375b8abba345320f4954842dee6f2ee0`: 321 files and 5,391 tests pass,
one file and three tests are skipped, and no unhandled error is reported.
Coverage passes all thresholds: 93.30% statements, 90.15% branches, 92.97%
functions and 94.50% lines. The final test-only correction adds 53 covered
branches without changing production code, thresholds or exclusions.

All accepted specialist and final security findings are resolved for the
published candidate. Real SQL/process/transport and example evidence remains
applicable; final runtime provenance is recorded. All task application and SQL
resources were cleaned up. Snapshot.23 remains unused across all 19 published
packages; all 31 workspace manifests use it, and clean audits match the lock.
See [acceptance](ACCEPTANCE.md), [verification limits](ACCEPTANCE_GAPS.md) and
[final release result](evidence/final-release/verify-release-6-result.md).

The official feature branch is published; the orchestrator checks the final
record-only endpoint against the remote after its push. No pull request or
merge is authorized. PR-based CI remains a disclosed external verification
step. No legacy compatibility or application data migration was introduced.
