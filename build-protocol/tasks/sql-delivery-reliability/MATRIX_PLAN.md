# SQL delivery reliability process matrix plan

Mechanical test-analysis assignment: orchestrator-dispatched function,
explicitly assigned `gpt-6-luna` / `medium`. Runtime self-introspection is not
available; those dispatch fields are the profile evidence. This plan is
read-only analysis for the implementation context. Parent acceptance is subject
to the at-least-once and bounded-scope corrections recorded below. It proposes no production
API or persistence change and does not broaden into template migration.

## Fixture and build boundary

Use the existing generated domain source in
`packages/server-blackbox-tests/proto/spine/server/testing/`:

- `project_commands.proto`: `CreateProject` is the input Command.
- `project_events.proto`: `ProjectCreated` is the published Event.
- `project_workflow.proto`: distinct `ProjectId`, `PlanningId`,
  `StaffingId`, and `PortfolioId` messages and corresponding state messages.
- `packages/server-blackbox-tests/test/project-event-routing.test.ts` already
  defines `ProjectPlanning`, `ProjectStaffing`, and `Portfolio`, routes
  `ProjectCreated` to distinct Process Manager IDs and a Projection, and proves
  the behavior through `BoundedContext`/BlackBox. Reuse that model and its
  generated types. Do not copy the reference app fixture or rewrite its Proto
  definitions.

The current handler classes live inline in a Vitest test, and the package has
no TypeScript build project. Extract only the Project workflow fixture classes,
repository declarations, route construction, and ID helpers into a small
package-local module without Vitest imports. Prefer the existing repository build/generation integration; add a minimal fixture
build entry only if the current fixture cannot be consumed by child processes.
Avoid a separate build subsystem. Keep
`packages/server-blackbox-tests/spine-proto-manifest.json` authoritative and
run the repository Proto generator before that build. Its generated imports
resolve through `@spine-event-engine/proto`; verify the workspace link targets
this checkout's `packages/proto/dist`, not a registry snapshot. Do not use
Node load hooks, prototype monkey-patches, reference `node_modules`, or an
installed `2.0.0-snapshot.22` artifact. The worker and harness must import
absolute paths under this checkout's `packages/*/dist` for server, storage,
proto, client, and delivery packages. Record the resolved paths and SHA-256
hashes of each imported entry artifact in run evidence.

Count actual handler entries separately from final business state. Record each
Command/Event/recipient/PID entry through the test control channel with parent
acknowledgement, or a process-local synchronously appended fixture log retained
after worker death. A durable reaction counter in fixture state can supplement
these records, but cannot establish absence of duplicate execution: concurrent
read/modify/write could overwrite increments. Do not add Protobuf counter fields
solely to replace execution evidence. Keep Command and recipient counts separate
to establish that Event-only retries never rerun `CreateProject`. Use separate
Protobuf IDs for each recipient and preserve the original Event ID and bytes on
retry. Crash-gap redelivery remains at-least-once and must report actual counts.

The public handler arguments contain the decoded domain message and optional
CommandContext/EventContext, not the current envelope ID. Do not invent that
field or add a framework instrumentation API. At the actual handler entry,
record the unique Project domain correlation, receiver ID/method, PID and
relevant message/context data. Join these entries to the submitted Command
ledger and original saved Event ledger; assert that every join is unambiguous
before reporting per-envelope counts. The existing Node-safe
`delivery-client/test-fixtures/managed-project-context.mjs` shows handler and
metadata construction, but lacks the required multiple recipients. Extract the
chosen Project workflow fixture without Vitest imports. Persist the IPC entry
before acknowledging any gate that permits a destructive worker kill, or use
a synchronous per-process append retained by the parent. Buffered child stdout
alone is insufficient evidence across SIGKILL.

## Process launcher and evidence seams

Before the broader existing process suites or final release profile run, remove
confirmed fixed real coordinator listeners from the applicable test fixtures:
`server/test/server/managed-server-application-parent.mjs` (50052),
`managed-server-application-start-parent.mjs` (50053), the live parent/cohort
cases in `managed-server-application.test.ts` (50051), and
`delivery-client/test-fixtures/managed-remote-delivery-application.mjs` (50053).
Use supported `port: 0` and their existing actual-endpoint reporting. Do not
mechanically rewrite every matching number: child-only fixture invocations
already receive port zero from `ManagedServerValues.child`, and mocked child
tests do not bind these constants. The release profile's serial workers only
serialize this run, not another agent's processes. The corrected read-only
inventory was checked against actual fork environment and parent/child paths.

Build a bounded `.mjs` worker host and Vitest adapter using Node `fork` or
`spawn`, following lifecycle patterns from
`packages/server/test/server/managed-server-application-parent.mjs`,
`managed-server-application-start-parent.mjs`, and
`packages/delivery-server/test/bin/delivery-server-process.test.ts`. The
read-only references inspected were
`experiments/multiprocess-delivery/process-host.mjs`, `support.mjs`,
`model.mjs`, `app-matrix.mjs`, `race-host.mjs`, and `race-matrix.mjs`, plus
`experiments/event-publication-recovery/app-worker.mjs`. Reuse their bounded
readiness/control-channel, PID reporting, process-group shutdown, and test
scenario sequencing as patterns only. Those scripts import the reference
Message Board/Study apps and use private module imports, prototype/SQL driver
instrumentation, or exact-match runtime hooks; none of those imports or hooks
belong in the new acceptance harness.

- The parent allocates loopback ephemeral ports, creates one unique database
  per matrix run, starts either two/eight app worker processes or an
  eight-member `ManagedServerApplication`, and waits for structured `READY`
  messages with PID, endpoint, process count, shard count, DB URL, Delivery
  mode, and built-artifact hashes.
- Use the existing `managedServerApplicationAccess.readyMembers` test seam
  only to report actual member PIDs; assert configured count equals distinct
  live PIDs (2/2 or 8/8). The app's `processCount` and `UniformAcrossAllShards`
  must both equal the selected matrix count. Do not infer process count from
  configuration alone.
- Each worker opens only the selected current-worktree storage package and
  connects to the same per-run DB. `db-only` uses SQL Inbox and shard sessions
  in application workers. `shared-memory` starts one standalone
  `DeliveryServer` OS process and configures workers through `RemoteDelivery`;
  SQL business state stays in the selected DB while Delivery state remains
  in-memory.
- Use a control channel with request IDs for start/ready, post, pause/gate,
  inspect, cancel, graceful close, and forced signal. Bound every wait. On
  failure, collect child stdout/stderr, PID/exit/signal, relevant SQL trace,
  then terminate only recorded child PIDs/process groups and close DB clients.
- Report per-command, per-Event-ID, per-recipient, and per-Process-ID counts.
  Query persisted Aggregate, Process Manager, and Projection states after each
  phase; reconcile accepted command IDs, produced Event IDs, recipient states,
  and explicit terminal outcomes. Record all results as task evidence, never
  under the read-only reference tree.

## Topology matrix

Run every row against the matching URLs and locked image/version in
`build-protocol/tasks/sql-delivery-reliability/SETUP.md` and
`evidence/databases.json`. For each DB, create a fresh run database (or
collision-free family prefix where DB creation is unavailable), use a random
run ID, and include it in every fixture Entity ID/table namespace.

| Database      | App workers | Delivery mode | Expected app PIDs | Expected shard count |
| ------------- | ----------: | ------------- | ----------------: | -------------------: |
| PostgreSQL 16 |           2 | db-only       |                 2 |                    2 |
| PostgreSQL 16 |           2 | shared-memory |                 2 |                    2 |
| PostgreSQL 16 |           8 | db-only       |                 8 |                    8 |
| PostgreSQL 16 |           8 | shared-memory |                 8 |                    8 |
| PostgreSQL 18 |           2 | db-only       |                 2 |                    2 |
| PostgreSQL 18 |           2 | shared-memory |                 2 |                    2 |
| PostgreSQL 18 |           8 | db-only       |                 8 |                    8 |
| PostgreSQL 18 |           8 | shared-memory |                 8 |                    8 |
| MySQL 8.4     |           2 | db-only       |                 2 |                    2 |
| MySQL 8.4     |           2 | shared-memory |                 2 |                    2 |
| MySQL 8.4     |           8 | db-only       |                 8 |                    8 |
| MySQL 8.4     |           8 | shared-memory |                 8 |                    8 |
| MariaDB 11.4  |           2 | db-only       |                 2 |                    2 |
| MariaDB 11.4  |           2 | shared-memory |                 2 |                    2 |
| MariaDB 11.4  |           8 | db-only       |                 8 |                    8 |
| MariaDB 11.4  |           8 | shared-memory |                 8 |                    8 |

For each topology, repeat the normal 80-command workload with burst size 16
from a fresh run namespace. Inject controlled failures into a separate
32-command workload with burst size 32 and repeat that workload at least twice
with fresh IDs. Run independent-write, retry, recovery, and cancellation
scenarios per database/provider; use 8 workers for contention and race cases.
Do not silently skip a matrix row: fail on missing URLs, wrong server version,
non-loopback host binding, mismatched digest, unbuilt/mismatched worktree
artifacts, process-count mismatch, or setup timeout before sending workload.

## Required scenario order and assertions

| Phase                            | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Deterministic pass conditions                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preflight                        | Resolve all four URLs, query version, inspect loopback binding and digest, validate fresh per-run DB, hash worktree `dist` artifacts, start configured processes.                                                                                                                                                                                                                                                                                              | All expected settings match; actual PIDs are unique and count is exactly 2 or 8; no child starts from a registry/reference path. Stop before load on any mismatch.                                                                                                                                                                                            |
| Baseline                         | Submit 80 unique `CreateProject` Commands with at most 16 in flight. Run every topology row.                                                                                                                                                                                                                                                                                                                                                                   | All 80 Commands accepted; each accepted Command executes once; each `ProjectCreated` Event retains one stable ID/byte sequence; both Planning and Staffing states have count 1 and matching project data; Projection state is correct; no duplicate terminal result. Reconcile 80/80.                                                                         |
| Contention                       | Submit 32 unique commands with all 32 released as one burst against eight workers, repeat twice per DB/mode.                                                                                                                                                                                                                                                                                                                                                   | 32/32 accepted and reconciled, exactly once per command and per recipient; conditional shard/session claims never allow double acquisition; no extra Process Manager count, state loss, or unbounded waits.                                                                                                                                                   |
| Independent writes               | Capture real SQL for warmed primitive read/write/delete/query, batch write, immutable Event append, Entity commit, and cleanup on each DB. Include first-use table initialization separately. Enable PostgreSQL `log_statement=all` with a run-database prefix and reload config; enable MySQL/MariaDB `general_log` to `TABLE` on these dedicated containers, snapshot matching entries by unique run database/time, then restore both settings in `finally`. | Warmed primitive paths show no added explicit multi-statement transaction or cross-record lock; conditional mutations retain one atomic guarded statement without restoring explicit transaction coordination. First-use DDL is reported separately. Record exact SQL and parameters safely without payload secrets.                                          |
| Status filtering                 | Against empty and populated Inbox tables exercise omitted, each single, multi, all, empty, repeated, and invalid statuses; array-valued columns; ordering, page continuation, deleted cursor, and separate tenant DBs.                                                                                                                                                                                                                                         | Results equal the memory-provider contract exactly; scalar-list values remain scalar filters, actual arrays remain array fields, ordering/page boundaries and tenant isolation hold.                                                                                                                                                                          |
| Conditional and immutable writes | Eight simultaneous same-shard claims; eight identical same-ID appends; conflicting bytes under that ID; same logical Protobuf with different serialized bytes.                                                                                                                                                                                                                                                                                                 | Exactly one competing claim succeeds; identical retry returns duplicate/success without extra rows; differing bytes fail with original driver cause retained; no partial divergent columns/history.                                                                                                                                                           |
| Partial writes                   | Inject a failure after every independent write boundary and each batch member, then retry the exact request.                                                                                                                                                                                                                                                                                                                                                   | Visible successful prefix is recorded; no false all-or-nothing claim; retry converges without duplicate or conflicting Event IDs; failure is reported with cause/code and a correlated safe log.                                                                                                                                                              |
| Processing                       | 32-command burst with endpoint failure, default policy, throwing monitor, selected repeat failure, retry success, exhaustion, and unrelated recipient progress.                                                                                                                                                                                                                                                                                                | Failed work is not reported as successful delivery; handler and retry counts match policy; terminal status is explicit; unrelated targets progress; no run hangs.                                                                                                                                                                                             |
| Ack gap and worker kill          | Hold one worker after successful business state commit but before successful acknowledgement, verify committed state, then SIGKILL that worker. Start a replacement and inspect before any explicit repair.                                                                                                                                                                                                                                                    | State proves the handler committed; the held item remains accepted/pending or has a documented terminal state; redelivery after the crash is allowed by the at-least-once contract and its exact handler count must be recorded. The live acknowledgement retry must not deliberately rerun processing. Exact pre/post state and handler count are persisted. |
| Partial recipient publication    | Publish one saved `ProjectCreated` Event to Planning and Staffing; inject failure on the second recipient Inbox write, then retry same Event ID and bytes. Repeat with failure on first recipient.                                                                                                                                                                                                                                                             | Successful first publication remains visible; retry does not rerun the successful Command; recipient invocation counts are checked against retained-deduplication and post-cleanup replay cases separately; failed publication never becomes a success result; ordering/terminal policy is explicit.                                                          |
| Event repair and exhaustion      | Restart application worker after Event is committed but recipient publication is incomplete; invoke explicit repair for that known Event ID. Test transient retry, permanent failure, retry exhaustion, missing ID, cancellation, tenant boundary, and recipient ordering.                                                                                                                                                                                     | Repair reads exactly the named saved Event, preserves its ID/bytes, and does not rerun Command or scan history. Each outcome is explicit; missing/foreign IDs and cancellation do no work. If no supported known-ID repair seam exists after independent implementation, record the narrow unresolved decision; do not add a scanner or persistence contract. |
| Cancellation and shutdown        | Same-handle failed then successful retry; simultaneous calls; already-removed item; explicit Cancel and stream teardown; cancel during activation and after handler start; close under load.                                                                                                                                                                                                                                                                   | Later calls follow the API contract; no work begins after observed cancellation; completed SQL deletions remain complete; resources/children close within fixed deadlines; no unhandled promise rejection or leaked process.                                                                                                                                  |
| Recovery timer                   | Default and overridden scan interval, missed notifications, late write during shard release, idle scan cost at two/eight workers, separate stale-session/server processing timeouts, overlapping scan prevention.                                                                                                                                                                                                                                              | Default is 10 seconds; override is observed; observe recovery timing without treating the scan interval as a hard delivery deadline; stale lease and server processing deadlines are independent; no overlapping scans and SQL statement count stays bounded while idle.                                                                                      |
| Transport readiness              | For every DB and both Delivery modes, exercise native gRPC and browser gRPC-Web/Connect using current worktree client/server dist. Hold Activate, wait for actual readiness, immediately publish an Event, then disconnect/cancel/teardown.                                                                                                                                                                                                                    | No arbitrary sleep or first business update is used as readiness; immediate Event is observed once; held activation cannot report ready early; cancellation closes streams and process resources.                                                                                                                                                             |

For each repeated workload persist a manifest containing git SHA, run ID,
image digest/version, URL with password redacted, resolved module paths and
hashes, app and Delivery PIDs, shard/process count, mode, transport, all
accepted/rejected IDs, event IDs, handler counts, terminal outcomes, SQL trace
reference, duration, and shutdown status. Use unique IDs and databases between independent trials; an identical-retry or known-ID-repair case deliberately reuses the original IDs within its trial.

## Shared in-memory Delivery OS crash boundary

Add one isolated process test using the built
`packages/delivery-server/dist/bin/spine-delivery-server.js` and
`DeliveryClient` from `packages/delivery-client/dist`. Start the server on
`127.0.0.1` port 0, parse the emitted listening endpoint, submit a valid
production `InboxMessage` (accepted ID recorded), then SIGKILL the server OS
process before delivery. Start a fresh DeliveryServer process and query that
same ID. Assert the first client received acceptance, the replacement has no
record for the ID, and no handler ran. Record both PIDs, signals, accepted ID,
and query result. This demonstrates the explicit loss boundary of the
in-memory server; it must not be presented as a durability or availability
promise. Use the same process-group timeout cleanup as other cases.

## Opt-in test integration and fail-fast behavior

The process matrix file is now registered as an opt-in infrastructure test in
`scripts/test-inventory.mjs`. The implemented single-selection entrypoint is
`pnpm --dir packages/server-blackbox-tests test:matrix`; it reads provider
connection endpoints from task `evidence/databases.json`, and selects one
provider/process-count/Delivery-mode tuple through `SPINE_TS_MATRIX_*` variables.
The exact values and build prerequisites are in IMPLEMENTATION.md. It is excluded
from the ordinary test/CI path and does not build artifacts implicitly. The
original proposed root wrapper using four SQL URL variables is not implemented;
it is not the current invocation contract. The task evidence collector
`evidence/run-baseline-matrix.mjs` invokes the package command across the planned
cases and stores a fresh evidence session. Generate Protobuf and build the current
worktree before running it; freeze dist throughout the run.

Fail before load if any expected environment variable is absent, any DB/image
version or digest is wrong, any host bind is not loopback, any duplicate run
name exists, any path resolves outside this checkout, any `dist` hash changes
during the run, process count or PID uniqueness differs, startup exceeds its
deadline, or the first command is rejected. On each case, assert exact IDs and
counts rather than only exit code. Bound query, activation, retry, cancellation,
and shutdown waits; on failure save evidence first, then terminate only child
PIDs created by this test. Keep database containers up for the task until the
full matrix finishes, then cleanup only task-recorded temporary databases and
child processes.

## Eight-of-eight runnable example acceptance

After the library matrix is green, retain Message Board's local React UI and
run its documented shared Delivery mode with eight application processes and
eight shards through its existing documented storage mode. The separate SQL
matrix supplies provider coverage; do not add an unrequested example storage mode. Verify actual eight distinct process PIDs and shard count,
post/query/subscribe/cancel through native gRPC and browser gRPC-Web/Connect,
and reconcile Event, Process Manager, Projection, and Inbox results. Run every
single-process To-Do mode against its documented SQL providers without shared
Delivery and verify its process count remains one. Label Orders and Projects
local teaching modes clearly; do not turn this task into a template migration.

## Parent acceptance corrections

This is an inventory and candidate harness outline, not an additional product
contract. No-duplicate execution after a crash between effects and acknowledgement
is not guaranteed. Record at-least-once duplicate counts explicitly. Recipient
replay after retention cleanup can repeat successful recipients. Same-operation
retries retain IDs; only independent trials require new IDs. Ten seconds is not
a hard delivery deadline. Example 8/8 acceptance uses its existing supported
storage mode; SQL matrix coverage is separate. Do not add build/persistence
subsystems merely to match a proposed test harness. Bounded test-driver fault
injection/SQL observation is permitted; runtime source transforms are not a fix.

## Confirmed fixture build integration

Read-only inspection confirms packages/server-blackbox-tests has spine-proto.json
for the selected Project schemas and package exports from generated .js paths to
dist/generated .js. It has no tsconfig.json or root project reference, and the
workflow classes/handler registry remain inline in the Vitest test. Add the normal
package composite TypeScript project (rootDir '.', outDir 'dist', generated plus
a Vitest-free fixtures/project-workflow.ts), required workspace dependency
references, and root tsconfig reference. Add a fixture package export. Extract
domain classes/registry while retaining Vitest assertions in the test. This uses
the existing generation/build graph; Node type stripping is not a substitute for
the absent generated .js siblings/dist export targets. Model IPC child handling
on packages/delivery-client/test-fixtures/managed-remote-delivery-application.mjs.

The human clarified that no production apps exist: no legacy compatibility or
application data migration is required. Correct the scoped contracts directly.

## Historical workload ID mapping

Current compiled Project workflow uses a composite ProjectId (OrganizationId plus numeric Project number). Historical investigation Project IDs were scalar strings. The recorded historical ID sets may serve as external ledger labels, mapped explicitly to one actual run organization and distinct numeric Project numbers; do not substitute a Project string for a logically different Organization identifier. Repeat workload sizes/burst concurrency and adjacent-ID contention using current domain-correct schemas. Report this mapping and do not claim byte-identical old application IDs or recreation of the original SQL scheduling. No legacy schema, production compatibility or migration support is introduced.

## Resume after the remote paging correction

First repeat the newly failed PostgreSQL16 eight-process shared-Delivery
80-Command/burst16 case with complete state, single-shard projection Inbox and
structured error evidence. After focused paging acceptance and review, run a
fresh complete80-case baseline matrix against one stable build. Stop on failure
and preserve evidence before cleanup; do not silently rerun.

Also execute the five explicitly labelled historical inputs with eight
processes/eight Entity shards and shared Delivery: MySQL base32(32/burst32),
control16(32/burst16), fixed32(32/burst32), replay80(80/burst16), and MariaDB
maria80(80/burst16). This explicitly includes the previously failing32/burst16
workload, which is not a distinct row in the default80-case baseline. Current
domain ID mapping remains as described above; retain source hashes and labels
without claiming identical original bytes or SQL scheduling. Each run includes
graceful worker recreation and a new Command, accepted-ID reconciliation, exact
Event bytes and actual handler counts. OS-crash/fault acceptance is separate.
