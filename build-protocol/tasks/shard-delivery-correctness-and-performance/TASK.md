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
  release of inactive sessions and reconnect. Keep the Admin gRPC contract and report actual stored counts.
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
- Use JVM's ordinary shard pickup and release. A repeat pickup by the same
  worker refreshes its pickup time. A release from a different worker leaves
  the current pickup intact. Preserve Protobuf seconds and nanoseconds.
- The application worker reads inbox pages, dispatches pending messages, marks
  successful deliveries and sets their retention deadlines. For a remote
  inbox it writes the changed messages through `InboxService.WriteMany` and
  sends selected duplicates and expired completions through `RemoveMany`.
  Report completion of a message after its storage operation succeeds.
- In application-managed SQL storage, delete expired delivered messages by
  shard, stored status and retention deadline in one database operation.
  Datastore cannot express this predicate in one deletion. Its corresponding
  cleanup remains an unresolved provider requirement.
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

## Delivery gRPC contract

Use the JVM Delivery server's Inbox, Shard, Admin and health contracts. The
one additional public RPC is `ShardObservingService.ObserveAll`. Pickup,
same-worker refresh and worker-checked release use the JVM shard messages.
The Delivery server stores what the application sends. It does not decide
whether a handler succeeded, which pending message is a duplicate, or which
delivered messages the application should remove.

## Acceptance

Exercise normal application entry points, live SQL and Datastore query behavior,
remote transport, local handoff, session loss and cleanup. Maintain checked
examples. Review the entire task and documentation in two consecutive standalone
Astra 6.2 High rounds, each with a general review and critique. Apply accepted
findings before the next round. Run release verification on the final changes.
