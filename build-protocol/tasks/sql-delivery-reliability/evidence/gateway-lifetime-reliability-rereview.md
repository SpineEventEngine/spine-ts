# Gateway lifecycle correction reliability re-review

Existing performance/reliability reviewer resumed with immutable explicit `gpt-6-sol` / `medium`; actual runtime metadata unavailable. Parent persists the complete substantive report because the reviewer performed no file edits. No tests, builds, or services were run by the reviewer.

**Disposition: no unresolved findings in the focused corrections.**

Generic ACK-disabled child rejection and EOF now enter `#failActivation` cleanup because its readiness guard is removed. Focused tests assert one disposal, original rejection/EOF, AggregateError ordering, and retained failed disposal retried by Cancel. The child failure handler validates current child/controller identity and intentional abort before touching readiness or lifetime, including an intentionally replaced child's abort rejection. Missing-member readiness is deferred during reconciliation, then `#finishReadinessReconcile` validates the final member snapshot. No new actionable issue was found in these corrected paths.

Source evidence: four affected suites 170/170 and final static checks pass. Compiled transport rerun was still in progress when review ended; parent subsequently received the final build and real transport results. This is focused correction acceptance, not whole-task or release acceptance.
