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
