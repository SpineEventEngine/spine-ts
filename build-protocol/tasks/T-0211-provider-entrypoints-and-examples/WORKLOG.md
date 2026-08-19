# T-0211 work log

## 2026-08-19 — intake and ownership split

- Baseline fixed at `origin/main@f3a2d92b30537c8290dee2c963d079d4d2f978dc`.
- Classified high-risk because it changes deployable entrypoints and provider
  endpoint meaning, while preserving existing public and wire contracts.
- Read-only provider inventory used `gpt-5.6-luna` / `medium`; runtime telemetry
  unavailable and subagents prohibited. It confirmed GKE/GCE discovery already
  handles authoritative empty snapshots, scale changes, and stable identities,
  but currently describes ordinary application listeners rather than managed
  Coordinators.
- Read-only example inventory used `gpt-5.6-luna` / `medium`; runtime telemetry
  unavailable and subagents prohibited. It confirmed Message Board production
  examples still configure ZeroMQ and standalone application listeners, while
  Todo retains an obsolete ZeroMQ child-process fixture. Existing managed
  server acceptance supplies the replacement machinery.
- Work is split between non-overlapping provider and example lanes. The parent
  integration worktree remains coordination-only until both lanes are green.

## 2026-08-19 — provider Coordinator entrypoints

- Retained RED-32 in provider policy tests before product changes: neither
  provider template supplied explicit managed process/shard settings, GKE
  targeted a child-style `grpc` port, and entrypoints used standalone `Server`.
- GKE now exposes each ready Pod's node-local Coordinator through the headless
  Service. Its managed children remain loopback-only complete replicas.
- GCE starts its Coordinator and initial replicas before its registrar publishes
  the VM endpoint. The composed handle withdraws that lease, stops children,
  and closes the registry in that order; abrupt VM loss remains lease expiry.
- The managed child re-executes the same entry module. It therefore recognizes
  the existing framework-owned child marker and assembles its replica without
  constructing or publishing a second GCE lease for the VM.

## 2026-08-19 — provider review corrections

- GKE readiness now probes the same named `coordinator` port exposed by its
  ready-only headless Service. The policy test binds probe, container, and
  Service names together.
- GCE snapshots the pre-existing process signal listeners, removes only the
  private managed listeners added during its own startup, and installs one
  provider-owned `SIGINT`/`SIGTERM` close path before registrar startup, so
  registration itself has no signal-ordering gap. It removes those outer
  listeners after the idempotent close settles. That close path withdraws the
  lease before managed-child and registry closure.
- Registrar startup failure now invokes `registrar.close()` before the existing
  managed/registry rollback, preserving each failure as a flat ordered aggregate.
- `application_process_count` and `delivery_shard_count` are required Terraform
  inputs and explicit example values. They are independent configuration: the
  app assembly receives the shard count and selects its own Delivery strategy.
- Provider docs and references now explain Coordinator discovery and the two
  explicit settings. No ZeroMQ, direct transport, child endpoint, or new wire
  concept was introduced.
