# T-0184 Review Log

Status: Resumed — implementation and verification pending

Task: `build-protocol/tasks/T-0184-todo-interface-proof/TASK.md`
Branch: `task/T-0184-todo-interface-proof`
Baseline: `aed2f194`

## Assignment Evidence

The implementation assignment uses the existing `implementer` role with
explicit `gpt-5.6-terra` / medium. Desktop runtime telemetry does not expose
independent model metadata; the immutable configured role/profile is the
available evidence.

## Planned Dispositions

- TypeScript/API: generated and authored interface token imports, type/value
  compatibility, and route callback contracts in the To-Do model.
- Style/maintainability: small plausible domain, one generated Task event route,
  one authored assignment route, and no invented semantic routing API.
- Performance/reliability: exact precedence, zero/one/many targets, persisted
  targets, durable replay without rerouting, and loopback topology preservation.
- Documentation/TSDoc: accurate Proto/model provenance and narrow TSDoc claims.
- Security: N/A unless the example introduces a trust boundary; T-0186 owns the
  final Wave security review.

## Review Boundary

Review begins after focused RED/GREEN, changed example-production coverage of at
least 90%, cheap preflight, and bounded `verify:task` with loopback permissions.

## Implementation Checkpoint

- Focused contract RED is recorded: the initial test failed `2/2` while the
  required `TaskEvent` declarations and application token routes were absent.
- The same test is GREEN after the To-Do changes: `1` file and `2` tests pass.
- Direct To-Do generation succeeds, including generated provenance/no-copyright
  interface files.
- Historical review blocker: review could not begin because root atomic generation failed when the staged model
  cannot discover authored sources/configuration, and direct generated-model
  typechecking fails with `TS9013` for unannotated generated `memberSchemas`
  tuples. Both were outside the T-0184 example-only implementation boundary.
- These blockers are superseded by T-0184A, integrated, tagged, and post-merge
  verified at `0bacb0b3`. The resumed task must rerun its focused behavior,
  preflight, and bounded verification before specialist review.
- No specialist lane has been invoked. Security remains N/A for this checkpoint;
  T-0186 owns final Wave security review.

## Runtime Admission Correction

- Root-cause tracing found that `Task.task_list_id` was incorrectly
  `(set_once)`: a framework-created Task already contains its ID, so CreateTask
  legitimately assigns the list ID in the first state update. The transition
  was rejected before event binding, independently of token or exact routing.
- The example retains `(required)` and `(validate)` and removes only
  `(set_once)`. Focused first-transition and generated-TaskEvent routing tests
  are GREEN after regeneration; the temporary exact-schema diagnostic was
  removed after proving routing was not causal.
- No specialist lane has been invoked; this is implementation evidence only.
