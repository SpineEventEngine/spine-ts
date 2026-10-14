# Transport harness review wave

Existing performance/reliability reviewer `/root/transport_harness_reliability`
and style/maintainability reviewer `/root/transport_harness_style` were explicitly
configured `gpt-6-sol` / `medium`. Both fields were present in dispatch; runtime
metadata is unavailable. Both inspected the frozen two-file transport harness
without editing files or rerunning tests. Parent records their substantive
findings and the complete aggregated disposition.

No P0/P1. Accepted P2 findings:

1. Both lanes: the held first ACK was released without proving the second child
   had already ACKed. Before release, wait for secondary activation/ACK, assert
   primary ACK count zero and logical activation still pending. Existing 48
   nested passes establish recovery/cleanup, but the stronger all-child readiness
   claim requires this corrected assertion and fresh focused evidence.
2. Reliability: the fixture consumed one Event and immediately canceled without
   counting sibling updates. Clarification accepted from the reviewer: two
   endpoints intentionally delegate to the same Project service, yielding two
   subscriptions to one publication. Assert two relayed updates with identical
   original Event ID/payload, one Command handler execution, and no extra update
   within a bounded observation. This is not a new production deduplication
   contract. The plan's one-update single-backend reconnect row remains separate.
3. Style: `bounded(waitUntil(...))` rejects on timeout but the poll loop remains
   alive. Stop the loop on its deadline or abort signal, including fixture
   termination, and show bounded failure exits without a leaked polling timer.

P3 recorded, not blocking: repeated scenario-membership lists across the driver
and wrapper can drift. Avoid unrelated refactoring solely for this preference.

One aggregated correction batch returns to the existing implementation context.
Only substantive assertions/resource-lifetime corrections require targeted
reliability verification; mechanical formatting and evidence wording do not
reopen a complete wave. Public API review is N/A for this test-only slice.

## Targeted correction review

The same explicit Sol/medium reliability reviewer confirms readiness ordering
and polling lifetime are resolved. Five focused PostgreSQL 16 fanout controls
pass and the helper tests pass 2/2. The exact Event-count assertion has one
remaining deterministic P2: both Event update arrays must have length one before
reading element zero. Otherwise an extra Event in the same update could evade
the third-update quiet observation. Add those two assertions after the active
96-row lifecycle matrix releases its measured-file freeze, then rerun affected
fanout controls and static checks. No production contract changes or another
whole review wave are needed. The quiet observation is bounded to 200 ms.
