# T-0206 specialist review

## Review configuration

One complete concern-specific review wave examined pushed checkpoint
`39806c10e`. Reviewers were read-only and prohibited from spawning subagents.
The execution surface exposed no runtime model telemetry, so the immutable
configured roles and profiles are the evidence.

| Concern                 | Existing role                      | Model           | Reasoning | Result                  |
| ----------------------- | ---------------------------------- | --------------- | --------- | ----------------------- |
| Performance/reliability | `performance_reliability_reviewer` | `gpt-5.6-terra` | high      | One P0, four P1, one P2 |
| Style/maintainability   | `style_maintainability_reviewer`   | `gpt-5.6-terra` | high      | One P1, three P2        |
| TypeScript/API          | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` | high      | Three P1, one P2        |
| Documentation           | `documentation_reviewer`           | `gpt-5.6-luna`  | medium    | Two P1, two P2          |

Final security review remains reserved for program convergence. T-0206 adds a
private process boundary but no public wire protocol; its signal, IPC, endpoint,
and bounded-input findings are handled by the reliability correction and later
included in the final security review.

## Consolidated correction batch

1. **P0 — parent termination must not orphan replicas.** Install removable
   parent `SIGINT`/`SIGTERM` ownership using the same shared close path. Children
   must also close/exit when parent IPC disconnects. Add a real parent-process
   termination proof for both signals with no replacement or orphan.
2. **P1 — asynchronous child-process failure is a normal failed incarnation.**
   Handle `ChildProcess` `error` once, fence a later `exit`, remove the exact
   incarnation, and schedule one bounded replacement without crashing the
   parent.
3. **P1 — disconnected or unresponsive child close is bounded.** If graceful
   IPC close cannot be delivered or observed, terminate the known child with a
   bounded `SIGTERM`/`SIGKILL` fallback. Racing close callers must share and
   await the same completion; no timer/start/child/handler remains.
4. **P1 — child output must not deadlock readiness.** Do not create unread
   `silent: true` stdout/stderr pipes. Inherit or intentionally drain standard
   streams and prove verbose output cannot block readiness and close.
5. **P1 — private READY endpoint is canonical and bounded.** Accept only the
   actual loopback HTTP origin shape emitted by child `RunningServer`, with a
   finite byte bound and valid port. Reject malformed, oversized, non-loopback,
   stale-slot, and stale-incarnation facts without retaining them.
6. **P1 — synchronization work must start only in the child.** Replace eager
   public promise arrays with the smallest lazy child-invoked callback and prove
   the parent never starts synchronization work.
7. **P1/P2 — remove premature or leaking public topology.** Remove unused
   required `host`/`port` fields until T-0207 owns the Coordinator listener.
   Remove child PIDs/endpoints from the public handle; retain them only through
   an internal T-0207 handoff accessor. The public handle owns readiness and
   close only.
8. **P1 — complete public inventory.** Add the intentional managed exports to
   the generated API inventory and make the exact API documentation check pass.
9. **P2 — safe lifecycle observability.** Record unexpected exits/start
   failures/retry facts using the existing contained server logging convention
   and allowlisted slot/incarnation/attempt/delay/reason facts. Never log raw
   errors, child output, or application payloads.
10. **P2 — correct public documentation.** State that `run()` initially waits
    for every slot, then remains ready while at least one child is READY;
    replacements continue while degraded and zero READY is unready. Explain
    signal-owned cleanup, private topology, arbitrary application-owned
    `DeliveryStrategy`, no CPU detection, no Coordinator forwarding yet, and
    direct `Server.run()`/browser independence.

The correction must retain the human prohibition on runtime application
manifests, schema/handler digests, build attestations, strategy identities,
behavioral sampling, custom-strategy restrictions, application signals over
IPC, or automatic request retry.

## Correction implementation status

The correction batch is implemented on `5c23cdd77` plus the pending focused
lint/test cleanup. The public handle is reduced to `ready` and `close`; private
topology is available only through an internal handoff accessor. No runtime
manifest, strategy identity, application IPC, or retry mechanism was added.
Lifecycle warnings use the contained server logger with only allowlisted slot,
incarnation, attempt, delay, operation, and reason values. The parent does not
resolve `ServerEnvironment` merely to obtain a logger, because that would
construct application facilities outside a complete replica. Re-review must
assess this explicit logging and ownership disposition with the other behavior
corrections.

Re-review every technical concern after the single correction batch.
Documentation re-review is required because public examples and semantics
change.
