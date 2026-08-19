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

## 2026-08-19 — example-lane managed Message Board checkpoint

- RED-31 retained first: the Message Board deployment-entrypoint test required
  `managed-entry.ts`, explicit `PROCESS_COUNT` and `DELIVERY_SHARD_COUNT`, a
  Coordinator-managed entry module, and no ZeroMQ/IPC setting in the
  replacement configuration. It failed because that entrypoint did not exist.
- The managed entry now runs the same module in parent and child processes,
  builds the full Message Board context only in each child, opens that child's
  `RemoteDelivery`, and explicitly selects its application-owned shard
  strategy. The Gateway keeps only browser/subscription responsibilities and
  does not configure Delivery or a runtime environment.
- Message Board's old production ZeroMQ configuration was removed from this
  replacement path. Repository-wide transport deletion remains T-0212.
