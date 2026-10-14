# Retention count review

Accepted bounded performance/reliability review by `/root/retention_count_review`,
explicitly configured `gpt-6-sol` / `medium`; both fields present in dispatch,
runtime metadata unavailable. Read-only classification; no tests or files changed
by reviewer. Parent persists the substantive result here.

No confirmed reliability finding. PostgreSQL 18/p2 original DELIVERED keepUntil
was 1791944684804; the extra Planning entry was at 1791944685698 (+894 ms), between
samples with nine matching rows at 1791944682191 and none at 1791944687442.
PostgreSQL 18/p8 keepUntil was 1791944814130; the extra entry was at
1791944815271 (+1141 ms), between nine rows at 1791944812119 and none at 1791944817130. The nine rows were one DELIVERED plus eight TO_DELIVER, unchanged
in the first six samples. No exact deletion time was measured.

Delivery page duplicate checks include the DELIVERED identity only while its
keepUntil is in the future (`delivery.ts` 1044–1052). The recent-delivery cache is
process-local, per Inbox wrapper and bounded to 1,000 identities (999–1025,
1081–1116). Expired delivered rows are eligible for direct cleanup (702–731).
A repeat after retention is compatible with the documented absence of an
exactly-once guarantee. The eight pending duplicate rows can remain while no
successful drain removes them; their sampled persistence alone does not establish
the cause or a violated guarantee.

After the Inbox was observed empty and a fresh process set started, explicit
known-ID repair added exactly one entry per recipient relative to the immediate
baseline. Create stayed at one, the final four typed DELIVERED rows were present,
and original Event ID and bytes matched. Parent accepts the clean bounded
disposition. Report measured ordering and compatibility with retention limits;
do not claim proven cleanup causality, a precise deletion instant, or exactly
two Event-handler executions overall. Detailed counts remain in
`process-fault-matrix/cold-repair-intervening-entries.json`.
