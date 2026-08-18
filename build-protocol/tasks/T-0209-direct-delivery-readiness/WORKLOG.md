# T-0209 Work Log

## 2026-08-19 — planning checkpoint

- Recorded the exact baseline `722a62b4704a5d910db22e7f9934bfd5535a151b`,
  high-risk lifecycle/concurrency classification, binding human requirements,
  owned paths, and T-0210 handoff before product changes.
- Reviewed the frozen T-0203 Delivery disposition and RED 22–28, D-0126,
  existing managed-server lifecycle/tests, and predecessor T-0206/T-0208
  records. No architecture re-plan is authorized or needed.
- Role record: existing `implementer`, explicit `gpt-5.6-terra` / `medium`.
  Runtime telemetry is unavailable. Subagents are prohibited and none were
  used. Accepted explorer record: `codebase explorer`, explicit
  `gpt-5.6-luna` / `low`, read-only/no subagents, telemetry unavailable.
- TDD skill was read completely before product work. The next action is to add
  the first narrow failing readiness/drain behavior test and capture its RED
  output before implementation.

## 2026-08-19 — contract blocker found before RED

- `ManagedServerApplicationOptions` currently conveys only `createServer()` and
  opaque optional `synchronize()`. The child can report only an endpoint; it
  does not expose a Delivery facility, a strategy selection, or drain state.
- The existing `ServerEnvironment` can reveal a configured delivery object
  only after child assembly. Its public facility is merely closeable; its
  package-private structural `ServerEnvironmentDelivery` form can show ports
  and optional `source`, but cannot prove remote/shared identity. Existing
  `BoundedContextBuilder` snapshots a strategy and defaults it to one shard,
  losing whether the user explicitly selected it.
- Consequently no current private seam can implement the binding admission
  rule “explicit remote/shared Delivery facility and explicitly selected shard
  strategy” without either (a) adding a managed-readiness configuration/
  declaration contract, or (b) weakening it to structural post-assembly
  inference, which would violate the frozen prohibition on inferred strategy
  behavior and would not prove explicit selection. This is a genuine required
  public-concept decision under the T-0209 instruction. No product test or
  source edit has been made pending disposition.
