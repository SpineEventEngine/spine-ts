# T-0105: System Event And Inbox Contracts

Status: Active

## Objective

Adds the serialized foundations required by the distributed delivery and Stand
runtime tasks: the exact frozen JVM system-event source containing
`EntityStateChanged`, its exact frozen dependency, and one Spine TS-owned Stand
subscription record. It also proves that the existing frozen Inbox labels are
the shared Aggregate, Process Manager, and Projection routing contract, so no
parallel label system is introduced.

## Classification

High-risk. The task changes Protobuf descriptors, type URLs, frozen-source
provenance, generated package metadata, and package compatibility policy.

## Baseline And Isolation

- Baseline: `origin/main@f9bd8b76`.
- Branch: `task/T-0105-system-event-inbox-contracts`.
- Worktree: `.worktrees/T-0105-system-event-inbox-contracts`.
- The primary checkout is coordination-only and its existing dirty files remain
  outside this task.

## Acceptance Criteria

1. Copy these files byte-for-byte from
   `SpineEventEngine/core-java@461a8281e484c12636d8cf660a1d6c929fbbd7ec`
   without building JVM:
   - `server/src/main/proto/spine/system/server/entity_log_events.proto`;
   - `server/src/main/proto/spine/system/server/entity_type.proto`.
2. Record exact upstream paths, URLs, commit, and SHA-256 values in the frozen
   source manifest. Source verification detects any divergence.
3. Preserve the exact `EntityStateChanged` package, type URL, fields, tags,
   required/validate options, and the non-sequential `old_state = 6` tag.
4. Add `spine/system/server/stand_subscription.proto` as a Spine TS-owned
   `internal_all` schema. `StandSubscriptionRecord` contains one canonical
   `spine.client.Subscription`, phase, creation time, optional pending deadline,
   and unsigned revision. It does not duplicate `Subscription.topic`.
5. Generated system schemas remain technically available to framework packages
   through the generated wildcard, but are absent from curated root/named
   exports and are explicitly outside the end-user compatibility contract.
6. Keep the existing frozen Inbox wire labels and prove their intended reuse:
   `HANDLE_COMMAND = 1` for Aggregate/Process Manager commands,
   `UPDATE_SUBSCRIBER = 3` for Projection events, and
   `REACT_UPON_EVENT = 4` for Process Manager event reactions. No new label or
   alternative target/shard representation is added.
7. Tests prove exact descriptor/type-URL compatibility, manifest coverage,
   canonical non-duplicated topic storage, field constraints, Inbox values, and
   curated-export absence.
8. Generated outputs are reproducible and remain untracked.
9. Update the Proto human/reference documentation in the same slice, without
   end-user Wave/task jargon.

## Stand Record Validation Boundary

`StandSubscriptionRecord` deliberately records the serialized storage shape;
it does not declare `(required)` or `(validate)` options on its lifecycle
fields. A valid record depends on lifecycle semantics that Protobuf options
cannot express: `subscription` must carry a usable identifier and topic,
`phase` must be a known lifecycle value, `created_at` must be present, and
`pending_until` is allowed only while pending. T-0108 owns that codec and
registry validation boundary, including rejecting malformed records before
they enter storage. This task proves the wire fields, the required/validated
constraints frozen on `EntityStateChanged`, and that `pending_until` remains
optional; it does not introduce a partial parallel validator.

## Explicit Exclusions

- No Stand registry persistence or codec implementation; T-0108 owns it.
- No Stand EventBus observation; T-0109 owns it.
- No Aggregate/Process Manager routing change; T-0106 owns it.
- No JVM source change or JVM build.
- No public root export for system-event or Stand-record schemas.

## Implementation Assignment

The existing `implementer` owns all production/test/documentation changes for
this task. Expected dispatch is explicit `gpt-5.6-terra` / `medium`. The agent
must use RED-first focused tests, must not spawn subagents, must preserve other
work, and must push every commit to `origin` immediately. Runtime
self-introspection is unavailable on this surface; acceptance uses the
immutable configured role/profile plus explicit dispatch fields and rejects any
visible mismatch.

## Review Dispositions

- Style/maintainability: relevant to keeping one contract path and concise
  generated-boundary tests.
- Documentation: relevant because the Proto README/reference compatibility
  wording changes.
- TypeScript/API docs: required for exact serialized and export contracts.
- Performance/reliability: required for record shape, bounds foundation, and
  downstream persistence safety.
- Security: N/A unless implementation changes a trust boundary; schemas alone
  do not process credentials or authorize requests.

## Verification

Run focused RED/GREEN Proto tests and generation checks first. After review
convergence, run `verify:release` once because serialized contracts change.
