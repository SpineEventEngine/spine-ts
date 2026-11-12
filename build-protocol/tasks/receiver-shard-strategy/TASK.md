# Receiver shard strategy

Status: implemented and independently reviewed. Local release verification passed.
Baseline: origin/master 99f2b9aff. Branch: receiver-shard-strategy.

## Requirements

Restore the configured DeliveryStrategy for Projection Inbox rows, endpoint
registration, startup notification, and stored-row validation. Use the routed
receiver ID and receiver state type for ordinary Events and Entity-state
subscriptions. Preserve immediate asynchronous delivery and exclusive shard
processing, including same-shard follow-up signals.

Record the human's project-wide rule: ask about behavioral differences in
mechanisms shared by Aggregates, Process Managers, and Projections, after
comparison with the latest Spine JVM and an explanation of practical effects.
The human has approved eliminating this Projection strategy bypass.

No new public strategy API, hashing changes, migrations, artificial limits,
transactions across deliveries, or GitHub PR/Issue changes are authorized.
Use small semantic commits and push each immediately. Protect master.
Domain-correct Protobuf fixtures, when_ Timestamp names, documented declarations,
and source-checked examples remain required.

## Approach

Pass the environment strategy to LocalProjectionInbox. Compute the shard before
its handoff key and storage write. Remove caller-selected shards from Projection
Inbox input. Register every configured shard and validate stored rows using the
same strategy. Keep the default single-shard behavior.

Tests cover nonzero and receiver-specific shards, routed recipient IDs,
Entity-state subscriptions, persisted-row mismatch, startup with pending rows,
and existing one-shard follow-up behavior. Update human and API documentation
with environment-level configuration and receiver-specific policy examples.
Ensure To-Do and Message Board managed launchers install their selected shard
strategy in the Production environment rather than only the Local profile.

## Verification

Regression tests reproduced the strategy bypass before the correction. The
release suite passes 7,167 Vitest tests and 44 Node tests, with all global coverage
thresholds above 90%. Independent documentation, API, maintainability, and
reliability reviews have no unresolved blocking findings. The external-Event
integration test now derives its held shard from the fixture strategy.
GitHub CI requires a human-created pull request.
