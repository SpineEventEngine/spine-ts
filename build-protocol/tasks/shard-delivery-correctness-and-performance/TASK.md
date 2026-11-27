# Shard delivery correctness and performance

The TS delivery branch starts at official master `569dd58c0`. All application nodes
use the same handlers and delivery configuration. Changes to the gRPC contracts,
inbox mutation, repository history and concurrent delivery are high risk.

## Work discovery

- Each node using remote storage subscribes to `ShardObservingService.ObserveAll`.
  Register before looking for existing work. Send only the full shard identity when
  a free shard contains pending messages. Stay silent while idle or while a worker
  holds the shard. Repeat unclaimed work after the configured interval, ten seconds
  by default. Further writes do not postpone reminders. Check again on release,
  expiry and reconnect. Keep the Admin gRPC contract and report actual stored counts.
- A node may process different shards concurrently. Only server notifications accept
  an optional per-node concurrency limit. Concurrent calls on one node for the same
  shard share one run. A joining caller may stop waiting independently.
- A custom observer uses application-managed storage. Invoke it after a successful
  write and when a normal run releases its shard and finds late work. Clear the
  local run before invoking the callback. Log callback failures. A storage failure
  remains an error. Remote inbox storage always uses server notifications.
- The default Delivery server runs in one process. With multiple storage
  subprocesses, route by shard index modulo the fixed process count. The public
  parent combines global replies and replaces a failed subprocess in the same
  slot. Each subprocess handles shard operations directly. A lost process loses
  its in-memory messages. See JVM Delivery issues #70 and #71 for the count,
  per-shard storage, repeat pickup and release rules.

## Inbox operations

- Generate an inbox UUID per independently received signal. One create-or-update
  write at the complete inbox ID replaces its contents. Do not pre-read or combine
  independent arrivals. Application code posts through its bus.
- Maintain ordered trees for stored and pending messages in each in-memory shard.
  Order by receive seconds, nanoseconds, inbox counter and UUID. The counter is
  field 10 of the upstream InboxMessage. Admin counts retained completions too.
- Recover an uncertain pickup with the same run identity. Use a fresh identity for
  each independent run. Preserve Protobuf timestamp precision, managed session
  expiry and renewal. Only the current worker can change a shard under its session.
- A worker reads pages. Mark a successfully handled message delivered by its exact
  inbox ID from the page. Keep the first retention deadline on retry. Remove the
  snapshot-comparison service, wire copies and acknowledgement re-reads. A caller
  waiting for a completed local dispatch receives its result.
- Delete expired delivered messages by shard, stored status and retention deadline
  with one storage call and one database operation. A missing deadline qualifies
  only for a delivered message. In SQL, use a predicate DELETE. Pending duplicate
  removal has a separate purpose. Datastore has no native delete by this predicate.
  Its single-operation cleanup is an unresolved provider requirement.
- Use exact numeric receive time for Datastore ordering. Fetch only the newest
  matching message when one is requested. Continue pages using the same total
  order, including timestamps inside one native Datastore microsecond.
- The inbox distinguishes Commands from Events when checking for duplicates.
  Use a valid shared UUID in the test that delivers both kinds to the same recipient.

## Aggregate dispatch

Only Aggregate repositories can enable the guard, with
`doubleDispatchGuard: { depth: N }` where N is a positive integer. Omission
disables it. With the guard enabled, inspect recent Events emitted by the
receiving Aggregate for the typed immediate cause. Reuse the live instance's
history, including successful earlier outputs from the current delivery batch.
Read only missing history from the repository's Entity storage. Restrict a
database read by producer and depth and order by Entity version and creation
time. Avoid the Bounded Context-wide Event Store for this operation.

Remove the guard for Process Managers and the Agent's process-local completed
input set. Their ordinary persistence, optional Process Manager Event history and
the immediate cause on output envelopes remain independent of this feature.
See [core-jvm issue #1744](https://github.com/SpineEventEngine/core-jvm/issues/1744).

## Acceptance

Exercise normal application entry points, live SQL and Datastore query behavior,
remote transport, local handoff, session loss and cleanup. Maintain checked
examples. Review the entire task and documentation in two consecutive standalone
Astra 6.2 High rounds, each with a general review and critique. Apply accepted
findings before the next round. Run release verification on the final changes.
