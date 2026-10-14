# SQL delivery and subscription reliability

The feature branch implements independent SQL persistence and direct Inbox
cleanup; saved-Event repair; bounded processing and acknowledgement; delivery
failure handling and shutdown coordination; subscription activation; exact
Inbox paging; and SQL-backed multiprocess examples. The shared Delivery server
remains in-memory. D-0129 through D-0133 record the durable contract decisions.

Release verification and live acceptance passed across PostgreSQL 16/18,
MySQL 8.4, and MariaDB 11.4. The live suite covered process, recovery, and
transport behavior.
