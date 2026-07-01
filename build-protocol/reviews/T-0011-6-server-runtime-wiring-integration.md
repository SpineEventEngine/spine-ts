# Review Log: T-0011.6 Server Runtime Wiring Integration

Status: Pending

## Required Review Lanes

- Code style/maintainability:
  `019f1b8a-31c5-7b21-b4dc-f34289c0ee8e` comments; closed.
- Documentation completeness:
  `019f1b8a-3245-7de0-a1b2-5fe37e75c387` comments; closed.
- TypeScript/API docs: `019f1b8a-32c0-70e0-a543-2e833cd85848` comments;
  closed.
- Security: `019f1b8a-3342-7a72-b1c6-b32040073bc2` comments; closed.
- Performance/reliability: `019f1b8a-33de-7bb0-829e-10d711f556c0` comments;
  closed.

## Agent Ledger

- Implementation sub-agent:
  `019f1b72-d92b-77c3-bea5-b734213b1035` (`Curie the 7th`) spawned on
  `2026-07-01 03:12 WEST`; returned `STATUS: DONE` with commit `67a217b`;
  closed by orchestrator after report was consumed.
- Round 1 code style/maintainability reviewer:
  `019f1b8a-31c5-7b21-b4dc-f34289c0ee8e` (`Aquinas the 7th`) spawned;
  returned comments; closed.
- Round 1 documentation reviewer:
  `019f1b8a-3245-7de0-a1b2-5fe37e75c387` (`Anscombe the 7th`) spawned;
  returned comments; closed.
- Round 1 TypeScript/API reviewer:
  `019f1b8a-32c0-70e0-a543-2e833cd85848` (`Nietzsche the 7th`) spawned;
  returned comments; closed.
- Round 1 security reviewer:
  `019f1b8a-3342-7a72-b1c6-b32040073bc2` (`Zeno the 7th`) spawned; returned
  comments; closed.
- Round 1 performance/reliability reviewer:
  `019f1b8a-33de-7bb0-829e-10d711f556c0` (`Peirce the 7th`) spawned;
  returned comments; closed.

The root thread does not expose `list_agents`; the orchestrator must track every
spawned T-0011.6 sub-agent ID here and close each agent immediately after its
result is consumed.

## Round 1 Findings

### Code Style/Maintainability

- High: event worker/subscriber identifiers derive from handler method names,
  making handler renames externally visible and leaking handler internals.
- Medium: server-local logical-name normalization duplicates transport-owned
  logical ID validation/canonicalization policy.
- Medium: the root `@spine-ts/server` API exports every intermediate route
  flavor and planner detail, broadening the public surface for a minimal seam.

### Security

- High: planner dereferences nested readiness metadata directly from
  caller-supplied lookup objects, so accessor/proxy metadata can execute during
  planning or surface raw JS exceptions instead of deterministic validation
  failures.
- Medium: public route entries embed full readiness metadata (`assignee` and
  `receiver`), including handler/entity/registered-handler details across the
  routing seam.
- Medium: event subscriber/worker identifiers are derived from entity full type
  names and handler method names, leaking handler details through transport
  identifiers.

### Performance/Reliability

- High: planner trusts nested handler schema/kind values after validating only
  top-level message names, allowing malformed readiness metadata to emit
  misrouted plans instead of explicit failures.
- Medium: event worker identifiers use lossy normalized names, allowing
  distinct receivers to collapse to the same worker ID and merge registrations.

### Documentation

- Medium: `packages/server/README.md` says `createServerRuntimeRoutingPlan()`
  returns only immutable transport-owned contracts, which is inaccurate for the
  current plan shape with context/deferred data and readiness metadata.
- Low: `docs/api/README.md` top-level current-status summary does not mention
  the new runtime-routing seam.

### TypeScript/API

- Public `ServerRuntimeRoutingPlanInput` accepts interface-based custom
  lookups, but route entries store returned assignee/receiver objects by
  reference, so mutable custom lookups can mutate the supposedly immutable
  plan after creation.
- Custom readiness metadata is only partially validated, producing incidental
  low-level failures instead of deterministic routing-plan rejections.
