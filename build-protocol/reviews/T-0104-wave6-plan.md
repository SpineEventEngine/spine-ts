# T-0104 Review Record

Status: Corrections pending re-review

## First Review Wave

- Style/maintainability: changes requested. Dynamic backend discovery was
  outside the frozen Wave 6 scope, and ownership of registry operations versus
  reconciliation was ambiguous.
- Documentation: changes requested. The outcome incorrectly implied that an
  explicitly selected in-memory registry was visible to every node.
- TypeScript/API docs: changes requested. The plan duplicated the canonical
  topic, did not pin the exact JVM `EntityStateChanged` wire contract, and left
  the registry/builder and multi-backend Gateway migrations underspecified.
- Performance/reliability: changes requested. Shared registry capacity,
  snapshot/delete consistency, Gateway fan-in bounds and cancellation fencing,
  and the claimed Inbox ordering guarantee were underspecified.

All findings were accepted as one correction batch. The plan now:

- limits Wave 6 to a fixed configured Gateway backend set and assigns dynamic
  discovery to Wave 7;
- assigns persistence and snapshot operations to T-0108 and the 10-second
  listener reconciliation lifecycle to T-0109;
- qualifies durable versus in-memory registry visibility;
- freezes the exact JVM system-event source, fields, type URL, dependency, and
  internal export policy;
- stores one canonical `Subscription` without a duplicate `Topic`;
- names the public registry, builder method, persistence capability, warning
  owner, documentation obligation, and direct no-deprecation Gateway migration;
- bounds shared admission, records, snapshots, backend count, stream resources,
  cleanup, and partial activation rollback;
- fences reconciliation and cancellation races, and removes unsupported
  ordering and deduplication promises.

## Review Assignments

- Style/maintainability: existing `style_maintainability_reviewer`, explicit
  `gpt-5.6-terra` / `high`; concern is task cohesion, ordering, and avoiding
  parallel mechanisms.
- Documentation: existing `documentation_reviewer`, explicit
  `gpt-5.6-terra` / `medium` fallback because this surface does not expose Luna
  in its explicit model selector; concern is clear, internally consistent
  active planning and decision text.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, explicit
  `gpt-5.6-terra` / `high`; concern is the planned public/serialized contract
  boundary and compatibility.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicit `gpt-5.6-terra` / `high`; concern is sharding, persistence,
  reconciliation, cleanup, lifecycle, and bounded resource behavior.

The surface does not expose separate runtime self-introspection. Immutable role
profiles and explicit dispatch fields are the acceptance evidence; visible
mismatches will be rejected.

Actual accepted runtime metadata is therefore the immutable role/profile named
above plus the explicit dispatch fields. No visible fallback or mismatch
occurred. The documentation lane ran with the recorded Terra/medium fallback;
all other lanes matched their expected Terra/high profile.
