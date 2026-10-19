# SQL delivery and subscription reliability

This branch corrects independent SQL persistence, direct Inbox cleanup,
processing and acknowledgement failure handling, subscription activation and
cancellation, and SQL-backed multiprocess examples. Shared Delivery remains
in-memory.

Author corrections: every Entity hands emitted Events to its Bounded Context
Event Bus without retaining delivery flags, recipient plans, or recovery
obligations. There is no Event republishing API or retry. Immutable Event history
remains readable; saved outgoing Commands retain their separate recovery
behavior. Bounded Context and managed close await admitted work without total
shutdown deadlines. Remote Inbox paging retains the JVM timestamp RPC and
emulated Time.

`DeliveryMonitor` follows Spine JVM: failed reception defaults to
`markDelivered()`, each failed repeat consults the monitor again, and monitor or
selected-action exceptions propagate even when shard release also fails. A
custom action that returns normally completes delivery. Managed repository
infrastructure errors propagate with the record still `TO_DELIVER`. After a
successful handler, only acknowledgement is retried, for at most three attempts.
There is no `leavePending()` policy or new status. Private route reservations
survive immediate retries and settle after each message completes.

The [subscription API addition](SUBSCRIPTION_API_PLAN.md) provides
`postAndSubscribe` for multiple Event/rejection types using exact immediate
Origin matching. Existing subscriptions support optional activation and
first-update timeouts, with no defaults. Subscriptions continue after the first
update or its timeout. Browser, Node, React, BlackBox, public documentation,
Message Board, and Todo use the supported APIs.

Official `master`, including the Agent feature, is integrated. The common
workspace version is `2.0.0-snapshot.24`, following master's snapshot 23.

Independent runtime, API, documentation, test, and security reviews resolved
confirmed findings. Live PostgreSQL 16/18, MySQL, MariaDB, two/eight-process
configurations, crash scenarios, and real subscription transports passed.
Agent Datastore checks passed; the pre-existing Datastore history-trimming test
still times out with the emulator. Release checks are recorded in
[PR #19](https://github.com/SpineEventEngine/spine-ts/pull/19/checks).
Detailed verification records remain disposable and outside Git.
