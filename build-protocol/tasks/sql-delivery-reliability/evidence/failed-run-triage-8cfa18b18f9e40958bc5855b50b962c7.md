# Failed run triage: `8cfa18b18f9e40958bc5855b50b962c7`

Read-only artifact triage by the orchestrator-dispatched mechanical function,
explicitly configured **gpt-6-luna / low**. Runtime profile introspection is
unavailable. No test, process, database, or runtime import was performed.

## Finding

The run submitted 80 distinct Project numbers (1–80); all 80 Command
acknowledgments were `ok`, and the 80 admission `commandId` values exactly
match the submitted command ledger. The durable entry log contains 302 records:
80 `create`, 80 `planning`, 80 `staffing`, 31 `portfolio`, and 31 `projection`.
There are no repeated method/correlation pairs. The same 49 accepted project
numbers have no recorded `portfolio` and no recorded `projection` handler
entry: 8, 16, 24, 26, 34–38, and 41–80. The other 31 have one entry for each
of the five methods.

Recorded method/type-URL counts are `create` → ProjectId (80), `planning` →
PlanningId (80), `staffing` → StaffingId (80), `portfolio` → PortfolioId
(31), and `projection` → ProjectId (31). Every recorded recipient ID is
nonempty canonical Base64, and the number of unique encoded recipient IDs
matches each method’s entry count. The failed run stopped before the fixture’s
later `assertMethodEntries` checks; this triage therefore reports the recorded
type URLs and byte shapes, not a decoded schema-to-ID equivalence assertion.
Entries contain the organization/project-number correlation, not the original
Command UUID, so the join is by accepted Project number rather than exact
Command ID.

The strongest supported failure statement comes from the fixture’s wait loop
and the `last-snapshots.json` artifact. The file is exactly the literal
`undefined` plus newline. The fixture only assigns `snapshots` after worker 0’s
inspection reports every Project state complete; it writes this file before
asserting `snapshots` exists. Therefore the first worker’s inspected Project
state set never met that completion predicate within the 90-second wait. The
driver then failed at `project-process-smoke.mjs:202` with “Project states did
not converge in every process.” Since `snapshots` was never assigned, the
fixture did not inspect or persist the remaining workers’ Project views. This
does not establish permanent delivery loss or the database’s final Event/Inbox
state. No result or `events.json` was written.

## Entry distribution

| Method / recorded recipient type URL | Entries | Unique encoded IDs | Missing accepted project numbers | Duplicate method/correlation entries | Entry time range (UTC) |
| --- | ---: | ---: | ---: | ---: | --- |
| create / `...ProjectId` | 80 | 80 | 0 | 0 | 23:22:51.200–23:22:52.641 |
| planning / `...PlanningId` | 80 | 80 | 0 | 0 | 23:22:51.628–23:22:53.012 |
| staffing / `...StaffingId` | 80 | 80 | 0 | 0 | 23:22:51.695–23:22:52.994 |
| portfolio / `...PortfolioId` | 31 | 31 | 49 | 0 | 23:22:51.374–23:22:53.303 |
| projection / `...ProjectId` | 31 | 31 | 49 | 0 | 23:22:51.525–23:22:53.321 |

All entry times are within 23:22:51.200–23:22:53.321 UTC. PID totals are:
66486: 35, 66488: 28, 66489: 25, 66490: 34, 66491: 32, 66492: 28, 66493: 32,
66494: 88. All 31 portfolio and 31 projection entries are from PID 66494; the
other methods are distributed across the eight recorded app workers. These
counts describe observed entries only.

## Saved artifacts and errors

- Run artifacts: `matrix-runs/8cfa18b18f9e40958bc5855b50b962c7/`.
- Driver failure: `project-process-smoke.mjs:202`, after the 90-second
  convergence loop; the outer run log is
  `baseline-matrix-53b72c17-3c08-4732-acab-4783465c0cf2/postgres16-p8-shared-memory-2.log`.
- No per-worker stdout/stderr logs exist in this run directory. The outer
  Vitest log records the assertion, not a storage or Delivery exception.
- `cleanup.json` reports the unique DB dropped, app PIDs 66486, 66488–66494
  exited with code 0 and no signal, Delivery PID 66483 exited with code 0 and
  no signal, and no cleanup errors.

Machine-readable counts and timestamp/PID distributions are in
`failed-run-triage-8cfa18b18f9e40958bc5855b50b962c7.json`.
