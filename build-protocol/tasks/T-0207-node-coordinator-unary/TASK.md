# T-0207: Node Coordinator Unary HTTP/2 Services

Status: In progress
Start: `2026-08-18`
Baseline: `origin/main@45396bce6`
Branch: `codex/t0207-node-coordinator`
Worktree: `/tmp/spine-ts-t0207`

Classification: High-risk. This adds the public node HTTP/2 boundary over
complete-replica child processes while preserving existing generated service
contracts, cancellation, bounded I/O, and command non-retry behavior.

## Objective

Start one private Node Coordinator listener in the managed parent. It accepts
the existing generated `CommandService.Post` and `QueryService.Read` calls,
selects exactly one current READY child in round-robin order, and forwards the
call once to that child's ordinary `SpineServices` endpoint. A child remains
the only component that reaches a `CommandBus` or query path.

## Human-Imposed Requirements Ledger

| Requirement                                                                                                                      | Proof                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Every managed child is a complete application replica.                                                                           | T-0206 process construction is retained; coordinator only uses its private READY endpoint handoff. |
| No generic signal routing, ZeroMQ, ContextTransport, RuntimeTransportBinding, app payload IPC, new Proto, or child topology API. | Dependency/import scan and public export inventory.                                                |
| Existing CommandService and QueryService wire contracts remain exact.                                                            | Real HTTP/2 Connect clients call the Coordinator and child normal services.                        |
| One admitted request selects one READY child round-robin.                                                                        | Real two-child command/query acceptance records child identity.                                    |
| Commands and queries are never retried after selection.                                                                          | Selected-child loss test records one child invocation and ordinary failure.                        |
| No ready child yields gRPC UNAVAILABLE without application intake.                                                               | Empty membership acceptance.                                                                       |
| Incoming cancellation, deadline, metadata, response status, and trailers preserve existing Connect behavior.                     | Cancellation/deadline and error-forwarding acceptance.                                             |
| Read/write size limits remain bounded.                                                                                           | Oversized-request acceptance uses the Server-sized limits.                                         |
| Ready loss/replacement changes selection without polling or public topology.                                                     | Internal membership notification and replacement test.                                             |
| Close is bounded and releases coordinator listener and child clients.                                                            | Real lifecycle cleanup test.                                                                       |

## Frozen Decisions

- `ManagedServerApplicationHandle` stays public with only `ready` and `close()`.
  The coordinator consumes an internal managed-ready-members notification.
- The existing Connect Node adapter and generated Command/Query service schemas
  are the only service protocol. The coordinator is unary-only; T-0208 owns
  subscriptions.
- `host` and `port` become real managed-startup listener inputs, matching the
  existing Server defaults and validation. They are necessary deployer-known
  Coordinator binding inputs, not child topology or unrelated configuration.
- It uses the existing default Server message size (4 MiB) unless a current
  Server configuration seam already supplies a smaller limit.

## Failing-Before Designs

1. `CommandService.Post` through the public coordinator returns the normal child Ack.
2. `QueryService.Read` through it returns the normal child query result.
3. Repeated unary calls alternate across two READY child endpoints.
4. A selected child exits mid-command; the call fails and no sibling receives a retry.
5. With no READY child, Post/Read return Connect `Unavailable` without app intake.
6. Client abort/deadline reaches the selected child and Connect status/metadata survive.
7. Replacement readiness enters round-robin after its READY notification, while a lost member is removed immediately.
8. Bounded request size is rejected at the Coordinator before forwarding.
9. Coordinator close closes HTTP/2 sessions/client resources before managed-child close completes.

## Implementation Owner

- Role: existing `implementer`.
- Configured model: `gpt-5.6-terra`.
- Configured reasoning: `medium`.
- Scope: private managed membership handoff, coordinator unary listener/client,
  focused real HTTP/2 tests/fixtures, and this task's durable records.
- Subagents: prohibited.
- Runtime model telemetry: unavailable on this surface; configured immutable
  role/profile is recorded as the evidence.

## Review Dispositions

- Style/maintainability: required.
- TypeScript/API documentation: required because the managed runtime is public,
  even though this task seeks no new public topology API.
- Documentation: required for TSDoc and no-new-configuration claims.
- Performance/reliability: required for HTTP/2, cancellation, membership, and close.
- Security: deferred to the final correction convergence; this task adds no
  new wire protocol or external trust principal.

## Open Questions

None. The frozen plan and current generated Connect/HTTP2 seam are sufficient.
