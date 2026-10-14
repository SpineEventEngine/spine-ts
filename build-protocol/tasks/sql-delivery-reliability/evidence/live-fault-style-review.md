# Live SQL fault test style review

Existing style/maintainability reviewer, explicit gpt-6-sol / medium, Standard.
Original profile retained; runtime introspection unavailable. No edits or runs.
Parent persisted chat result.

P2: cause-code and forbidden-repeat assertions at inbox-provider-faults.integration
test lines138–142 run inside onReceptionFailure. Delivery safelyValue contains
callback rejection and substitutes leavePending, so an assertion can fail without
failing the outer test. Capture facts and assert after run instead.

Generated Todo Event/TaskListId fixtures are domain-correct. Test inventory and
provider command changes match the opt-in suite. No other confirmed findings.
