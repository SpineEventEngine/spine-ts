# T-0184 Review Log

Status: Correction closure complete; targeted re-review pending

Task: `build-protocol/tasks/T-0184-todo-interface-proof/TASK.md`
Branch: `task/T-0184-todo-interface-proof`
Baseline: `aed2f194`

## Assignment Evidence

The implementation assignment uses the existing `implementer` role with
explicit `gpt-5.6-terra` / medium. Desktop runtime telemetry does not expose
independent model metadata; the immutable configured role/profile is the
available evidence.

The specialist review wave uses only the existing configured roles:

- `typescript_api_docs_reviewer`, explicit immutable `gpt-5.6-terra` / high;
- `style_maintainability_reviewer`, explicit immutable `gpt-5.6-terra` / high;
- `performance_reliability_reviewer`, explicit immutable `gpt-5.6-terra` / high;
- `documentation_reviewer`, explicit immutable `gpt-5.6-luna` / medium.

All four assignments are concern-specific. Desktop runtime telemetry does not
expose independent child model metadata, so each immutable configured role and
explicit dispatch profile is the acceptance evidence. Security remains N/A for
T-0184 because this example introduces no new trust boundary; the final Wave
security review remains owned by T-0186.

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

## Typed-ID Compatibility Checkpoint

- The focused To-Do contract and black-box suite is GREEN (`2` files / `36`
  tests) after typed TaskListId migration and narrowly scoped rejection routing.
- Assignment lifecycle, target cardinality, replay, coverage, and formal review
  remain pending.

## Assignment Lifecycle Checkpoint

- Focused black-box proof now covers zero/one/two assignee target outcomes and
  four-event read-side rebuild. Durable Inbox no-reroute is a separate existing
  repository-routing contract. Full matrix coverage and review remain pending.

## Durable Replay Checkpoint

- A handler failure is deliberately acknowledged and cannot serve as a
  durable-retry fixture. The discarded RED attempt confirmed the resulting
  projection Inbox row is `DELIVERED`.
- The accepted public proof persists a valid pending `UPDATE_SUBSCRIBER` row
  with `DeliveryBuilder` after one live generated-TaskEvent admission. A fresh
  BlackBox context materializes the row while its replacement TaskEvent route
  would throw if invoked; it remains uncalled. Focused evidence is GREEN
  (`1/1`).
- This is implementation evidence only; coverage, preflight, and specialist
  review remain pending.
- `@spine-event-engine/storage` is intentionally not added as an example
  dependency: its public import is unresolved under Vitest. The proof imports
  the matching built workspace entrypoint by relative path so the storage
  factory shares server-runtime identity.

## Compile-Convergence Preflight

- No specialist review has been dispatched. The existing implementer assignment
  remains explicit `gpt-5.6-terra` / medium; desktop runtime telemetry remains
  unavailable, so the immutable configured profile is the acceptance evidence.
- Initial tooling RED was confined to stale To-Do test contracts: omitted
  `TaskListId`, incompatible exact-optional callback, string-ID view helper,
  unchecked generated optional fields, and scalar TaskList fixtures. Assigned
  tests now compile against generated types with guarded observations;
  `typecheck:tooling` and six focused Todo suites exit 0.
- Cleanup and TSDoc preflight remain RED solely for pre-existing, unassigned
  `examples/todo/src/index.ts` findings. No production behavior or API changes
  were made by this correction.
- Prior branch coverage was 86.54% (RED against 90%). Fresh LCOV and bounded
  verification disposition remain pending the one coverage-enabled `verify:task` run.

## Source Preflight Correction

- Cleanup/TSDoc findings in newly changed Todo handlers are resolved without
  weakening required explicit generated-event return types. Lifecycle event
  types use generated `*Event` aliases and the handlers follow the local
  multi-line TSDoc convention.
- Formatting, TSDoc before and after formatting, cleanup, ESLint, tooling
  typecheck, and diff hygiene are green. Individual black-box confirmation is
  pending before the single coverage-enabled task gate.

## Superseded Coverage Invocation

- A coverage task-profile invocation with raw `src/index.ts` and no
  `src/process.ts` was cancelled before acceptance. It is non-authoritative and
  provides no coverage evidence; the corrected source set is pending.

## Mechanical Preflight And Bounded Verification GREEN

- The exact authoritative coverage profile passed with all six Todo suites and
  sources `examples/todo/dist/src/index.js`, `examples/todo/src/smoke-task-lists.ts`,
  and `examples/todo/src/process.ts`. Generated build/tooling, lint, cleanup,
  TSDoc, format, documentation, Proto, containment, and release-readiness gates
  completed before coverage.
- Fresh LCOV is branches `90.38%` (`47/52`), functions `95.59%` (`65/68`), and
  lines `96.23%` (`204/212`), meeting the task's 90% threshold.
- No specialist lane is dispatched by this implementer. The branch is pushed
  and ready for the planned TypeScript/API, style, reliability, and TSDoc review.

## Accepted Correction Dispositions

- TypeScript/API P1: resolved. Existing command/event tags are preserved;
  TaskList field one remains reserved and its typed ID is field four. The
  snapshot reset is an example boundary and does not claim a migration for
  shared serialized contracts. New assignment rejections declare TaskListId and
  route from it directly.
- Style P1/P2: resolved. Assignment guards reject before mutation or normal
  event production, and the focused contract test prevents new-row TaskId
  inference from reappearing. Existing completion/reopen fallback is explicitly
  legacy-only.
- Performance/reliability: CLEAN. No new persistence, concurrency, or replay
  concern was introduced; rejection admission leaves assignment projections
  unchanged.
- Documentation: reader documentation is stale and deferred to T-0185. Its
  acceptance includes the assignment rejection table plus the snapshot
  reset/no-migration explanation.
- Splitter: the existing requirements-splitter decision used explicit
  `gpt-5.6-sol` / high. Desktop telemetry cannot independently expose runtime
  child metadata; the immutable configured profile is the recorded evidence.
- Reviewer profiles remain as assigned above; telemetry has the same desktop
  limitation. Security is N/A for T-0184 and remains T-0186 scope.
- Fresh correction-profile evidence: the six To-Do suites and authoritative
  compiled/source helper list completed under `verify:task --coverage`; LCOV is
  92.42% branches (61/66) and 96.54% lines (223/231).
