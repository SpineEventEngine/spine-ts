# T-0209 — Direct Delivery readiness and drain

**Status:** Complete — reviewed and ready for integration
**Baseline:** `origin/main@722a62b4704a5d910db22e7f9934bfd5535a151b`
**Branch/worktree:** `codex/t0209-delivery-readiness` / `/tmp/spine-ts-t0209`

## Classification, owner, and scope

This is **high-risk** lifecycle/concurrency work. It owns managed-child
Delivery readiness admission, application-configured remote/shared Delivery
and shard-strategy acceptance proof, graceful DRAINING sequencing, active-work
quiescence, and proportionate real managed-process/node proof for RED 22–28.

- Existing role: `implementer`; explicit configured profile:
  `gpt-5.6-terra` / `medium`.
- The execution surface exposes no runtime telemetry, so the immutable
  configured profile is the available evidence. No subagents are permitted or
  used.
- Accepted read-only exploration: existing `codebase explorer`, explicitly
  `gpt-5.6-luna` / `low`, no edits/subagents; telemetry unavailable. It found
  that `RemoteDelivery` already supplies initial snapshot/update observation,
  `DeliverySupervisor` already supplies reconnect/snapshot recovery and
  active/pending idle tracking with exclusive pickup/fencing, and managed
  children currently do `createServer()` then optional `synchronize()` then
  READY. The gaps are managed readiness/drain integration and real
  complete-replica proof, not new Delivery architecture.

Owned product/test paths are the hot managed lifecycle/server/Delivery
environment paths and their focused fixtures/tests under `packages/server/**`,
plus these records. The real-process fixture's direct Todo dependency extends
ownership only to the existing application-options object and its black-box
proof so the fixture can select a standard `StorageFactory` before context
construction. Do not change Gateway/Coordinator Delivery forwarding, Delivery
lease/retry authority, protobuf/wire contracts, manifests, attestation, other
example behavior, or T-0210 external-event proof.

## Binding behavior

1. Each managed complete-replica child independently observes configured
   remote/shared Delivery directly; Coordinator and Gateway never proxy it.
2. Managed application assembly configures remote/shared Delivery and selects
   its shard strategy. T-0209 fixtures do so and T-0211 documents it; runtime
   does not certify configuration provenance, strategy identity/equality,
   manifests, attestation, CPU or shard-count inference, or numeric
   process/shard coupling.
3. A child proceeds `STARTING -> SYNCHRONIZING -> READY`; unary and Delivery
   admission wait for initial Delivery snapshot and retained subscription
   installation.
4. Graceful close proceeds `READY -> DRAINING -> CLOSED`: remove unary/new
   shard admission, retain subscription relays while active fenced Delivery
   work finishes and emits final updates, then close streams/listener/context/
   process. Expected drain/close never replaces the child.
5. Preserve Delivery Server lease authority, reconnect/snapshot/overflow
   behavior, and public retry policies; add no timeout/retry policy.

## Acceptance and handoff

RED 22–28 use real managed processes/nodes where proportionate, reusing remote
supervisor/e2e helpers. A forwarder or direct fake notification is not
acceptance. Existing remote-supervisor, fencing, and overflow suites remain
green. Changed executable lines and branches require at least 90% coverage.
Use `verify:task` after focused convergence; do not run release verification
before review convergence. T-0210 retains real-process RED 17–19/29
external-event acceptance.
