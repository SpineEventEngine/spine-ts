# T-0213 — Deployment correction closure

**Status:** Complete; merged, post-merge verified, and pushed

**Baseline:** `origin/main@4c28e2223b89fb203709413400770944778c071c`

## Scope

Close only the accepted complete-replica deployment correction:

- managed complete application replicas with deployer-selected process count;
- private Coordinator command/query forwarding and subscription fan-out;
- direct per-replica Delivery observation, readiness, drain, and replacement;
- domestic and ThirdParty external events through process-local integration
  channels;
- optional integration configuration with the shared in-memory default;
- removal of ZeroMQ, generic signal routing, and the Todo bypass fixture;
- directly affected provider/example/documentation behavior;
- proportional verification, review, integration, and remote cleanup.

## Accepted outcome

- The release verifier contains one global coverage test run and no invocation
  or exclusion for a deleted cross-process broker test.
- The removal guard rejects restoration of deleted broker-cross-process and
  Todo local-multiprocess paths or current guidance.
- Todo no longer carries the retired transport dependency and accurately
  distinguishes single-process development from deployer-configured managed
  complete replicas, Coordinator forwarding, and direct Delivery observation.
- Retained managed-process, subscription, Delivery, external-event, Todo,
  Docker, and Compose acceptance passes.
- Affected API/documentation/style/reliability concerns are clean, the required
  repository verification passes, and the correction is merged and pushed.

## Explicit non-goals

- No unrelated Gateway capacity, quota, rollout, or multiple-Gateway policy.
- No general dependency-upgrade or whole-project security program.
- No broad historical status/capability-matrix rewrite beyond current claims
  made stale by this correction.
- No Gateway-hosted Integration Hub, replacement transport, automatic process
  or shard-count selection, platform autoscaling, TLS, identity provider,
  secrets manager, or observability product.
