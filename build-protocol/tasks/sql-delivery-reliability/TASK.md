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
Before the subscription API addition, the monitor correction passed independent
review, live reruns, the full release profile, and the then-current PR checks.
Disposable evidence stays out of Git.

The [subscription API addition](SUBSCRIPTION_API_PLAN.md) is complete on this
branch. `postAndSubscribe` observes multiple Event/rejection types using exact
immediate Origin matching; existing subscriptions support optional activation
and first-update timeouts, with no defaults. Subscriptions continue after the
first update or its timeout. Browser, Node, React, BlackBox, public documentation,
Message Board, and Todo use the supported APIs.

Independent API, lifecycle, documentation, test, and security reviews are resolved.
The full release checks passed with 5,383 tests and 90.00% branch coverage; three
tests are intentionally skipped. Live PostgreSQL 16/18, MySQL, MariaDB, all 16
process/Delivery configurations, and real browser transports passed. All 19
snapshot 25 packages passed external-consumer checks and the offline release
trial. No packages were published. Disposable evidence remains ignored.

The author authorized back-merging current official `master` and correcting
Agent Event publication. Integration is in progress. Every Entity hands Events
to its Bounded Context Event Bus; it must not retain Event delivery flags,
recipient plans or recovery obligations afterward. Immutable Event history
remains separate from delivery. The next unpublished release after master's
snapshot 23 is snapshot 24; the merged workspace will use that version.
