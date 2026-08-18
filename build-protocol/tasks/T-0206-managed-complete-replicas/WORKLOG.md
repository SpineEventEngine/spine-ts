# T-0206 work log

## 2026-08-18 — Framing and code map

- Fresh baseline is integrated `origin/main` at `ec9a382b9`; the protected
  primary checkout was not used for implementation.
- Current `Server.start()` is caller-managed; `Server.run()` adds process
  signal ownership through the private `ProcessServerCoordinator`.
  `RunningServer` exposes only host, port, URL, and close.
- No managed multi-process application implementation exists. Existing real
  process fixtures in server and Delivery provide bounded readiness,
  termination, and orphan-cleanup patterns but are not product supervisors.
- The implementation belongs in `server`, not `deployment`: `server` already
  depends on `deployment`, so the inverse import would create a cycle.
- The existing `RetryableCloseGroup`, `RunningHttp2Server` close ordering, and
  process signal coordinator are reusable lifecycle patterns. Delivery's
  reconnect backoff is evidence for bounded timers but is not reused as child
  restart policy because the ownership and healthy-reset semantics differ.
- At framing, an immutable internal assembly report was considered for runtime
  manifest derivation. The later human correction below rejects that
  precautionary mechanism.
- No conceptual blocker was found. Product implementation remains pending
  until this framing checkpoint is pushed.

## 2026-08-18 — Checkpoint A: validation RED/GREEN

- Implementation owner: existing `implementer` role, configured explicitly as
  `gpt-5.6-terra` / `medium` by the orchestrator. This execution surface does
  not expose runtime model telemetry, so the immutable dispatch profile is the
  available record. No subagents were used.
- Selected governing skill: `test-driven-development`, fully read before
  product changes. `systematic-debugging` was fully read after the first RED
  was blocked unexpectedly before test collection.
- JVM guardrail inspected: `spine-jvm-docs/spine-validation-storage-observability-and-support.md`,
  including its `ServerEnvironment` source mapping and process-wide semantic.
  This slice retains that local complete-server assembly model and adds no JVM-
  divergent application routing concept.
- The initial focused Vitest invocation failed before collection because fresh
  workspace package exports pointed to absent generated/build outputs. Root
  cause evidence: `packages/core/dist` was absent and direct `tsc -b` showed
  absent generated Proto imports. `pnpm proto:generate` plus
  `pnpm typecheck:build:generated` restored the normal test resolution path;
  this was a worktree prerequisite, not a product change.
- RED evidence retained: `pnpm exec vitest run
packages/server/test/server/managed-server-application.test.ts` then collected
  six tests and failed each with `ManagedServerApplication` undefined.
- GREEN evidence: the same command passed 6/6 after adding the smallest public
  validation boundary. It rejects missing, zero, negative, fractional,
  non-finite, and unsafe `processCount` values without CPU inspection.
- Checkpoint A remains in progress: topology, IPC, manifests, lifecycle policy,
  real-process fixtures, and public documentation are still pending.

## 2026-08-18 — Checkpoint B: initial fork topology

- Restored exactly the ten generated `.spine-proto-generation.json` and
  `spine-proto-manifest.json` generation-ID byproducts to `HEAD` after local
  prerequisite generation. The restoration was mechanical and touched no other
  path.
- RED: the real-process one-child fixture failed with `Managed server process
lifecycle has not started.` before parent/child implementation.
- GREEN: after `pnpm typecheck:build:generated`, the focused lifecycle test
  passed 7/7, including one parent-managed distinct child PID, private ready
  IPC, and parent-requested child close.
- Still pending: N-child topology, deterministic manifest, synchronization
  gates, replacement/backoff, and public documentation.

## 2026-08-18 — Delivery strategy manifest correction

- A bounded architecture audit confirmed that arbitrary `DeliveryStrategy`
  behavior has no exact runtime configuration identity: the public seam is
  only `shardCount` plus `shardFor()`, and finite sampling or function-source
  comparison cannot prove behavioral equality.
- The human clarified that Delivery strategy selection is the framework user's
  responsibility and every deployed replica must use the same application
  code. The framework therefore must not identify, serialize, compare, sample,
  or restrict the strategy in managed mode.
- This intermediate disposition removed only strategy identity while retaining
  a narrower replica manifest. The later human correction below supersedes it
  and removes runtime application attestation entirely.
- This initially appeared to resolve the architecture blocker by narrowing the
  manifest, but the following human correction removes the unrequested
  manifest mechanism entirely.

## 2026-08-18 — Remove invented runtime attestation

- The human rejected the Delivery-strategy identity and the broader runtime
  application-manifest mechanism as unrequested precautionary architecture.
- The managed launcher already runs the same configured application entry
  module in every child. Framework users own complete application assembly,
  Delivery strategy, code, and deployment configuration across nodes.
- Removed runtime manifests, schema/handler digests, build attestations,
  strategy identities, sampling, and custom-strategy restrictions from the
  accepted plan and T-0206 contract. No product implementation of those ideas
  was committed.
- T-0206 now implements only necessary deployment behavior: explicit process
  count, real child assembly/listeners, synchronization readiness gates,
  bounded replacement, graceful drain, and deterministic cleanup.

## 2026-08-18 — Ownership transfer and managed lifecycle checkpoints

- Ownership transferred to the current existing `implementer` role with the
  explicit configured profile `gpt-5.6-terra` / `medium`; this surface does not
  expose runtime model telemetry and no subagents were used.
- The predecessor's uncommitted endpoint/gate prototype was restored to its
  pushed `HEAD` before implementation. A new real-child endpoint acceptance
  test then failed against that head (`childEndpoints` was `undefined`), and
  passed after the smallest readiness message implementation. This is the
  retained RED/GREEN evidence for the transferred hunk.
- `979efe2e7` reports the actual child listener endpoint only after its local
  server and synchronization gates settle. Focused real-child suite: 9/9.
- `8bd24ca2c` adds stable parent slots, private per-incarnation UUIDs,
  replacement after unexpected exit, bounded restart settings, and close-time
  timer cancellation. The real-child suite passed 11/11 after a generated
  build refreshed the fixture's `dist` import. The initially hung run was
  diagnosed as a source-vs-built-child IPC-shape mismatch; only its known stale
  test parents and child fixtures were terminated, and a subsequent single run
  left no process handles.
- No application manifest, schema/handler digest, Delivery-strategy identity,
  sampling, build attestation, new public Proto, signal IPC, or application
  payload transport was introduced.
