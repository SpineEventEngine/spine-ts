# Delivered Inbox retention

Status: implemented and independently reviewed on `receiver-shard-strategy`.
Local release verification passed. Remote completion uses the existing gRPC
service contract and the application's delivery clock.

## Human-Imposed Requirements Ledger

- Newly received Inbox messages have no `keepUntil`.
- Marking a message `DELIVERED` sets its deadline to that time plus five seconds.
  A repeated acknowledgement of a matching stored completion preserves its
  deadline. Local conditional updates preserve the first concurrent completion.
- Remote delivery sets both fields in the application and writes them through
  the existing gRPC operation. Do not impose server-clock timestamping, add RPCs,
  alter frozen Proto, or require new behavior from either Delivery server.
- Apply the rule uniformly to Inbox delivery. The additional protection for
  Aggregates and Process Managers is completely separate and must not change.
- Duplicate detection across storage pages is explicitly deferred by the human.
  Do not add lookup APIs, indexes, caches, or provider changes for that issue.
- Pending messages remain ineligible for delivered-record cleanup. Expiry permits
  cleanup rather than scheduling an exact-time deletion.
- Preserve current acknowledgement boundaries, asynchronous follow-up delivery,
  receiver shard strategy, and separate delivery records for separate receivers.
- Use existing shard coordination and remote unknown-outcome handling. Do not
  claim conditional remote writes or stronger concurrency guarantees than the
  current gRPC contract provides.
- No migrations, arbitrary limits, cross-receiver transactions, or speculative
  Entity protection changes. Genuine domain fixtures and documented declarations
  remain required. Authored Timestamp fields use `when_` names.
- Keep this work in the existing branch and worktree. Push each semantic commit
  immediately. Do not modify GitHub pull requests or issues. Questions use only
  the final reply's Questions section, never popup tools.

## Approach

This is high-risk persistence and acknowledgement work. Remove reception-time
initialization for Commands, Events, batch reception, and Projections. Set the
local deadline in its existing conditional completion update. Set the remote
deadline when the application prepares the delivered record, preserving stored
completion on acknowledged retries. The worker uses the returned completed row.

Tests cover delayed delivery, completion retries, local concurrent completion,
cleanup boundaries, separate receivers, and remote application-clock completion
through the unchanged wire contract. Use controlled time rather than real waits.
Update maintained input types, custom ports, fixtures, and human/API documentation.

The final profile is `verify:release` because delivery is shared runtime.
Independent maintainability, documentation, API, and reliability reviews cover
the complete retention diff. The prior receiver-sharding review remains valid
unless retention changes affect its verified behavior.

## Verification

The release profile passes 7,175 Vitest tests and 44 Node tests, with all global
coverage thresholds above 90%. Twenty live PostgreSQL, MySQL, and Datastore
checks pass. Independent maintainability, documentation, API, and reliability
reviews have no unresolved blocking findings. Remote completion documentation
now states the existing read/upsert guarantees precisely.

GitHub CI requires a human-created pull request. Cross-page duplicate detection
and additional Entity protection remain outside this task.
