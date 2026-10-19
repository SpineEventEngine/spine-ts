# SQL delivery and subscription reliability

This branch corrects independent SQL persistence, direct Inbox cleanup,
processing and acknowledgement failure handling, subscription activation and
cancellation, and SQL-backed multiprocess examples. Shared Delivery remains
in-memory.

Author corrections: Event publication makes one initial attempt, with no
republishing API or publication retry. Context and managed close await admitted
work without total shutdown deadlines. Remote Inbox paging retains the JVM
timestamp RPC and emulated Time.

`DeliveryMonitor` follows Spine JVM: failed reception defaults to
`markDelivered()`, each failed repeat consults the monitor again, and monitor or
selected-action exceptions propagate even when shard release also fails. A
custom action that returns normally completes delivery. Managed repository
infrastructure errors propagate with the record still `TO_DELIVER`. After a
successful handler, only acknowledgement is retried, for at most three attempts.
There is no `leavePending()` policy or new status. Private route reservations
survive immediate retries and settle after each message completes.

Independent runtime, API, documentation, and test reviews addressed the changed
behavior. Focused tests, PostgreSQL 16/18, MySQL, MariaDB, two/eight-process
configurations, crash scenarios, and real subscription transports have passed.
The final monitor correction passed independent review, live reruns, and the
full release profile. The PR checks record verification of the pushed commit.
Disposable evidence stays out of Git.

The requested [subscription API addition](SUBSCRIPTION_API_PLAN.md) is planned
on this same branch. Independent review findings are addressed; no product
questions remain. Documentation and formatting checks pass. Implementation has
not started; the runtime verification summary above applies to existing changes.
