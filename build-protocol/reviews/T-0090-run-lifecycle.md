# T-0090 Review Record

Status: Wave 1 findings accepted; correction in progress

## Required Concerns

- Style/maintainability: required for changed lifecycle ownership structure.
- Documentation: conditional on changed public reference prose.
- TypeScript/API docs: required for `run()`, `start()`, and close contracts.
- Performance/reliability: required for concurrency, signals, retry, teardown,
  and resource ordering.
- Security: N/A because authentication and network trust boundaries are
  unchanged.

Expected reviewer models/reasoning are recorded in the task before dispatch.
Actual runtime metadata will be recorded when exposed; otherwise the configured
role/profile and limitation are the acceptance evidence.

## Wave 1 Dispatches

- Existing `style_maintainability_reviewer`; scope: the complete T-0090 diff,
  ownership placement, coordinator simplicity, naming, and focused test
  maintainability. Expected `gpt-5.6-terra` / high.
- Existing `documentation_reviewer`; scope: changed public lifecycle TSDoc and
  affected server reference claims for beginner clarity and exact observable
  behavior. Expected `gpt-5.6-luna` / medium.
- Existing `typescript_api_docs_reviewer`; scope: `run()`, `start()`,
  `RunningServer.close()`, internal ownership types, compatibility, and public
  declarations/TSDoc. Expected `gpt-5.6-terra` / high.
- Existing `performance_reliability_reviewer`; scope: mixed admission,
  concurrent/repeated close, signals, sibling retirement, final environment
  ordering, retry, and leak behavior. Expected `gpt-5.6-terra` / high.

Every dispatch explicitly supplies the recorded model and reasoning. The wave
reviews endpoint `fdddc2ea`; findings will be aggregated before correction.

## Wave 1 Runtime Evidence

- Style/maintainability completed under the configured existing role with
  `gpt-5.6-terra` / high. Runtime self-introspection was unavailable; the
  immutable configured role/profile is the available metadata.
- Documentation completed under the configured existing role with
  `gpt-5.6-luna` / medium. Runtime self-introspection was unavailable; the
  immutable configured role/profile is the available metadata.
- TypeScript/API docs completed under the configured existing role with
  `gpt-5.6-terra` / high. Runtime self-introspection was unavailable; the
  immutable configured role/profile is the available metadata.
- Performance/reliability completed under the configured existing role with
  `gpt-5.6-terra` / high. Runtime self-introspection was unavailable; the
  immutable configured role/profile is the available metadata.

No dispatch omitted its required explicit model or reasoning configuration,
and no visible mismatch or fallback occurred. All four results are accepted.

## Wave 1 Accepted Finding Batch

1. Coalesce concurrent `run()` calls on the same `Server` before coordinator
   admission so one underlying start produces one lifecycle record and one
   returned managed handle.
2. When final environment closure fails, retain signal-driven retry
   reachability until a later close attempt succeeds. Add a failure followed
   by a second-signal regression test.
3. Add a failed-startup regression using an occupied port. It must prove
   `run()` leaks no SIGINT/SIGTERM listeners and releases ownership so a later
   caller-managed `start()` succeeds.
4. Keep coordinator retirement mechanics module-private instead of exposing a
   public internal object method whose parameter is the private mutable
   `RunRecord` type.
5. Correct lifecycle documentation in `packages/server/README.md`,
   `packages/server/REFERENCE.md`, `docs/USER_GUIDE.md`, and
   `docs/architecture/README.md`. Clearly distinguish caller-managed `start()`
   from run-managed `run()`, their exclusive active-generation ownership,
   sibling `run()` sharing, final environment closure, and retry behavior.
6. Expand public `start()`/`run()` TSDoc with the observable ownership,
   admission, final-close, and retry contract.

The same implementation owner receives this single aggregated batch. A second
review wave will cover only behavior, API, maintainability, reliability, and
documentation materially changed by these corrections.

## Wave 1 Correction Disposition

- Implementer: existing `implementer`, configured `gpt-5.6-terra` / `medium`;
  runtime self-introspection unavailable, with configured profile retained as
  evidence.
- Findings 1–2 resolved: same-builder concurrent `run()` calls coalesce before
  coordinator admission, and a failed final close remains reachable for a
  second-signal retry.
- Finding 3 confirmed: occupied-port failed `run()` startup leaks no signal
  listeners and releases ownership for caller-managed startup.
- Finding 4 resolved: retirement record mechanics are module-private.
- Findings 5–6 resolved: required lifecycle prose and public TSDoc now cover
  ownership, admission, sibling sharing, final close, and retry behavior.
- Focused validation passed: server and attachment suites 133/133; affected
  lint, formatting, TSDoc, and whitespace checks passed. Narrow re-review is
  pending orchestrator dispatch.

## Wave 2 Dispatches

The correction endpoint is `2dbb6f97`. Re-review is restricted to the
substantively affected concerns:

- Existing `style_maintainability_reviewer`; scope: concurrent-run coalescing,
  module-private retirement, retained final record, and regression-test
  maintainability. Expected `gpt-5.6-terra` / high.
- Existing `documentation_reviewer`; scope: corrected server README/reference,
  user guide, architecture guide, and lifecycle TSDoc. Expected
  `gpt-5.6-luna` / medium.
- Existing `typescript_api_docs_reviewer`; scope: public `start()`/`run()` and
  managed-close declarations/TSDoc plus private coordinator surface. Expected
  `gpt-5.6-terra` / high.
- Existing `performance_reliability_reviewer`; scope: concurrent admission,
  failed-start rollback, signal-driven final-close retry, and bounded listener
  and record lifecycle. Expected `gpt-5.6-terra` / high.

Every dispatch must explicitly supply the expected model and reasoning. Actual
runtime metadata will be recorded if exposed; otherwise the immutable role
profile and that limitation remain the acceptance evidence.

## Wave 2 Results

- Style/maintainability: clean under the explicitly configured existing
  reviewer with `gpt-5.6-terra` / high.
- Performance/reliability: clean under the explicitly configured existing
  reviewer with `gpt-5.6-terra` / high.
- TypeScript/API docs: one P1 stale-handle contract defect and the shared stale
  user-guide claim under the explicitly configured existing reviewer with
  `gpt-5.6-terra` / high.
- Documentation: one P1 contradiction, one P2 beginner-workflow defect, and
  one retry-wording clarity gap under the explicitly configured existing
  reviewer with `gpt-5.6-luna` / medium.

Runtime self-introspection was unavailable in all four lanes; the immutable
configured role/profile is the available evidence. No visible mismatch or
fallback occurred, so every result is accepted.

## Final Narrow Correction Batch

1. After a successful managed close, a later call to the same `Server.run()`
   must not return the cached closed handle. Preserve the cached handle while
   close remains retryable, then either clear it and let the terminal
   environment reject a new run or reject terminally at the server boundary.
   Add a regression for the observable behavior.
2. Qualify the stale `docs/USER_GUIDE.md` assertion that server close never
   closes process facilities so it applies only to caller-managed `start()`.
3. Make the server README's standalone beginner example use run-managed
   `run()`, or relabel it unambiguously as caller-managed startup.
4. Clarify that final run-managed close retries unfinished environment cleanup
   as well as unfinished server cleanup.

This batch is narrow and deterministic. Reliability and maintainability lanes
do not reopen. After focused GREEN evidence, the orchestrator will inspect the
stale-handle regression and documentation changes directly, run the release
gate, and close the task without a third specialist wave unless the correction
changes the contract again.

## Final Narrow Correction Disposition

- Resolved: successful managed close clears the same-builder cached run handle;
  failed close retains it for retry. Focused regression passes.
- Resolved: USER_GUIDE caller-managed qualification, README standalone `run()`
  example, and final-environment retry wording are corrected.
- Validation: focused server tests 58/58; affected lint, Prettier, TSDoc, and
  whitespace checks passed.
