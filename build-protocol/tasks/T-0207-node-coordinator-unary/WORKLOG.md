# T-0207 work log

## 2026-08-18 — Framing

- Baseline is verified `origin/main@45396bce6`; the protected primary checkout
  is not used.
- The implementation owner is the existing `implementer`, explicitly
  configured `gpt-5.6-terra` / medium. No subagents are permitted; the runtime
  surface does not expose telemetry.
- T-0206 provides a private WeakMap READY-member snapshot, but it currently
  has no membership-change notification. T-0207 will add the smallest internal
  listener/reconciliation handoff so replacement and loss do not require
  polling or expose topology publicly.
- The current Server uses `connectNodeAdapter`; generated CommandService and
  QueryService clients use `createGrpcTransport`; default request/response
  bounds are 4 MiB. Existing child `SpineServices` remains the sole Bus intake.

## 2026-08-18 — Unary forwarding checkpoint

- RED: the first Coordinator acceptance failed because the private
  `node-coordinator` module did not exist. The initial clean worktree also
  lacked generated Protobuf output after build cleanup; normal frozen Proto
  generation restored the baseline before the RED was repeated.
- GREEN: a private `NodeCoordinator` uses `connectNodeAdapter`, generated
  `CommandService`/`QueryService` descriptors, `createGrpcTransport`, and the
  T-0205 membership kernel. It selects one READY member per unary call and
  performs no retry. Its request path keeps application headers, cancellation,
  and remaining deadline while excluding protocol-owned headers; response
  headers/trailers are copied back without duplicating gRPC framing headers.
- `ManagedServerCoordinator` opens this listener only through its production
  private dependency after the first READY cohort, owns it during close, and
  publishes an internal READY-membership notification. Existing fake clock and
  child tests deliberately omit that production-only dependency, preserving
  their deterministic lifecycle boundary.
- A real forked managed parent proves a request travels through the Coordinator
  to its child `Server` normal service. Focused fork verification passed 43/43;
  server typechecking passed. Generated manifest IDs created by the temporary
  generation step were restored and are not part of this task.

## 2026-08-18 — Forwarding contract completion

- Generated HTTP/2 acceptance proves selected-child failure has no retry,
  cancellation and deadlines reach the selected child, application metadata and
  downstream response headers/trailers cross the coordinator, and configured
  inbound/outbound message bounds reject oversized calls at the coordinator.
- Replacement selection uses the internal READY-member notification rather
  than polling or public topology.
