# T-0196: Wave 13 Complete Failing-Before Gate

Status: COMPLETE

## Objective

Commit executable failing-before acceptance for all RED-01 through RED-22 in
the accepted Wave 13 plan before any product implementation changes.

## Baseline

- Spine TS: `c1b45018fb404129df56843b0e31e15470b7a947`
- Pinned Spine JVM: `0779b5fa42ca5cebd0d2935fc3a3489ab47846dc`
- Branch: `wave13-t0196-red`

## Ownership

One existing `implementer`, explicitly `gpt-5.6-terra` / medium, owns only new
Wave 13 test, test-support, child fixture, and this task's RED evidence files.
It must not edit production, generated, package, configuration, or accepted
T-0195 files, and must not spawn child agents.

## Acceptance

- Every RED-01–RED-22 has a named executable case or a precise mapping to a
  named case in a shared conformance suite.
- Failures arise from missing Wave 13 behavior/contracts, not missing fixtures,
  invalid setup, timeouts, syntax, or unrelated baseline regressions.
- Cross-process proof models two normal application processes and contains no
  direct transport publication or EventBus forwarding shortcut.
- `RED_EVIDENCE.md` records command, baseline, expected failure, and observed
  failure for each group.
- No product code changes.

## Testability Contract Refinement

The accepted Wave 13 plan now pins the previously unnamed additive dispatcher
and environment shapes required to write behavior-complete REDs. This is a
reviewed refinement of the existing dispatcher and ServerEnvironment concepts,
not a broker accessor, registration DSL, or additional configuration concept.
