# SQL delivery and subscription reliability

This branch corrects independent SQL persistence, direct Inbox cleanup,
processing and acknowledgement failure handling, subscription activation and
cancellation, and SQL-backed multiprocess examples. Shared Delivery remains
in-memory.

Author correction: Event publication makes one initial attempt, with no
republishing API or publication retry. Context and managed close await admitted
work without the rejected total shutdown deadlines. Remote Inbox paging uses
the existing JVM timestamp RPC with emulated Time in multipage tests. The
correction preserves processing/acknowledgement recovery and subscription
cleanup. These instructions supersede the related earlier design records.

Independent reviews and targeted re-reviews are complete; all findings are
resolved. Real PostgreSQL 16/18, MySQL, and MariaDB checks, two/eight-process
database-only/shared Delivery configurations, fault scenarios, and native,
gRPC-Web, and Connect subscription checks pass. One overlapping eight-process
run exceeded the database connection limit; its isolated rerun passed.

Local release gates passed. The full test run exposed an unstaged-deletion
scan and a stale Protobuf file count; both were corrected and the affected
groups pass. Final release and coverage results are recorded by the PR checks
on the pushed commit. Disposable evidence is excluded from Git.
