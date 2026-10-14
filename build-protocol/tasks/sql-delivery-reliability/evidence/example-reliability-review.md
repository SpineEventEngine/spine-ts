# Example reliability review

Scope: changed Message Board launch, Compose, browser and burst acceptance paths; Orders and Projects activation-ACK load paths and immediate tests. Read-only review; no builds, tests, or live services were run. Existing runtime reliability review remains outside this wave. Configured existing performance/reliability role: `gpt-6-sol` / `medium` (explicit dispatch); runtime model introspection is unavailable.

## Findings

1. **P1 — The burst acceptance helper has no end-to-end time bound.** In `build-protocol/tasks/sql-delivery-reliability/evidence/message-board-burst.mjs:44-58`, `Promise.all` waits for every concurrent `actor.post` without a deadline. The 30-second deadline at lines 89-104 only applies after all posts settle, and each `actor.send(query)` at line 93 can also remain pending past it. A stalled post or query leaves the acceptance run and its `finally` cleanup waiting indefinitely, so a failed topology can occupy its processes and evidence slot. Give both phases a bounded cancellation/deadline path, then preserve partial outcomes in the failure result.

2. **P2 — Burst reconciliation can report an exact projection count when duplicate rows exist.** `message-board-burst.mjs:95-112` converts all board rows into a `Set`, checks only that each expected ID is present, then writes `projected: count`. If a projection returns two rows for one burst ID, all expected IDs still pass and the result reports exactly `count` projected rows. Compare the run's IDs as a multiset (including duplicate detection) and derive the reported count from observed rows. The existing result cannot support an exact-ID or one-row-per-post claim.

3. **P2 — Local launcher cleanup targets wrapper PIDs only.** `examples/message-board/scripts/start-local-multi-process.sh:120-121` starts Vite through `pnpm exec`, but cleanup at lines 48-55 sends signals only to the recorded `pnpm` PID; `start-local-single-process.sh:34-35` and lines 17-22 do the same. A `pnpm` exit or interrupted launcher can leave its Vite descendant bound to the selected UI port even though the launcher has completed cleanup. The new isolated-port launch promise in `examples/message-board/README.md:69-73` is therefore unproven. Launch the server process directly or stop and reap its process group, and add a shutdown test that verifies the UI port becomes reusable after interrupting the launcher.

## Reviewed without further finding

- The changed local ports propagate consistently to Delivery, Datastore, Coordinator, Gateway, browser origin and Vite; process and shard counts are independent, and the selected Delivery image tag is used by the build and run paths.
- The changed Compose image tags, public ports, runtime UI URL and browser origins align across combined, standalone and distributed topologies.
- Orders and Projects consume and validate the activation ACK before posting work, then retain the first data-read promise. The focused tests cover successful real transport and stalled activation in Orders; Projects has a successful real-transport path. A malformed or mismatched ACK test would strengthen this specific new guard but is not a separate confirmed production defect.
- Browser acceptance uses two independent contexts, checks cross-context visibility, records browser errors and persists a result on assertion failure.
