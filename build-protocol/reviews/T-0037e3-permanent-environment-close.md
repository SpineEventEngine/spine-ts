# T-0037e3 Review Log

Status: Slice 1 implementation assigned

Derived status mirror: the canonical current state is the `Status` header in
`build-protocol/tasks/T-0037e3-permanent-environment-close/TASK.md`.

- Security review remains deferred to T-0041 unless explicitly requested.
- Canonical concerns are style/maintainability, documentation, TypeScript/API
  docs, and performance/reliability. Every implementation slice requires a
  clean or concretely justified N/A disposition after focused verification.
- One requirements splitter is assigned the architecture-significant permanent
  close resolution at explicit expected `gpt-5.6-sol` / `high`, no subagents.
  Its output is documentation-only and must preserve public compatibility,
  D-0085 ordering, live-registration refusal, close/attach serialization,
  quiescence retry ownership, exhaustive owned-facility close attempts, and
  all explicit exclusions.
- Coordinator runtime evidence:
  `/Users/armiol/.codex/sessions/2026/07/13/rollout-2026-07-13T13-49-59-019f5b86-f6c1-7962-a2d1-8072e13410fe.jsonl`
  records actual `gpt-5.6-sol / high` at `2026-07-13T12:50:02.268Z`,
  matching explicit dispatch.
- The requirements splitter completed the canonical skill-applicability gate at
  `2026-07-13T12:51:31Z` before design inspection: exposed inventory, no
  task-provided skill name/path, expected manifest, all 47 readable installed
  entrypoints, and task-relevant installed-lock entries were checked; all eight
  expected entrypoints exist and no source was unreachable. Selected and fully
  read `architecture-decision-records`, `codebase-design` plus its directly
  relevant `DEEPENING.md`, and `domain-modeling`. Planning/product-splitting,
  broad architecture/API/backend, implementation/TDD/worktree, review, and
  completion-verification skills were skipped because accepted decisions and
  public scope are fixed and this pass owns only the four assigned records.
- Coordinator baseline evidence is clean after expected ignored-output setup:
  fresh-worktree `pnpm install --frozen-lockfile` succeeded using locked/reused
  dependencies; the initial five-suite run had four module-resolution failures
  for absent ignored `@spine-ts/storage`/`@spine-ts/proto` build output while
  `environment-delivery-records` passed 18 tests; `pnpm proto:generate` and
  `pnpm typecheck:build:generated` both exited 0; then the exact five suites
  passed 5 files / 190 tests. No tracked file changed.

## Architecture Handback

- Handback scope is exactly the task, new architecture resolution, work log,
  and this review log. No production/tests, generated output, examples,
  decisions, commit, push, or protected human-review file changed.
- The resolution fixes the existing `EnvironmentAttachments` serial gate as the
  close/attach linearization point, keeps a private zero-registration permanent-
  close record there, and leaves the existing facility group as the only
  per-facility retry ledger.
- It requires pre-mutation live-use refusal, permanent close-first admission,
  T-0037b invocation only through `DeliveryGeneration.retire()`, unsafe slot/
  dependency/facility retention, safe slot clearing despite reporting/inert
  cleanup error, complete ordered facility attempts, exact-once successful
  facility close, stable error ordering, and unreported-versus-reported
  cause-once behavior.
- It preserves public `ServerEnvironment.close(): Promise<void>` and excludes
  new public options/exports/errors/retry/state, reusable stop, detach,
  failed-start rollback, server/listener/context/resource integration, retry
  timing, monitor/topology/catch-up, examples, generated artifacts, and broad
  docs.
- Three implementation slices have explicit production/test/doc ownership,
  behavior acceptance, focused tests, risks, and exclusions. All canonical
  implementation review concerns remain pending; this splitter spawned no
  reviewers. The coordinator should accept or return this architecture handback
  before assigning Slice 1.
- Splitter handback consistency is clean: Prettier write/check passed on all
  four owned records, `git diff --check` passed, all four status headers agree,
  and the short status contains only those owned documentation changes. Tests,
  full verify, commit, push, and reviewer dispatch remain coordinator-owned.

## Architecture Coordinator Gate And Review Assignment

- Coordinator inspection and lightweight docs/status lint pass: synchronized
  status, documentation-only scope, no accidental public/internal concept leak
  outside the bounded resolution, no future-policy overclaim, focused
  formatting, and diff hygiene.
- Assigned profiles are style/maintainability `gpt-5.6-terra` / `high`,
  documentation `gpt-5.6-luna` / `medium`, TypeScript/API docs
  `gpt-5.6-terra` / `high`, and performance/reliability
  `gpt-5.6-terra` / `high`; read-only, no subagents, and bounded to the
  architecture resolution and active task claims.

## Architecture Review Findings And Fix Assignment

- Style/maintainability: P1 eager provisional-stop/serialized-close race.
- Documentation: P2 unsupported stop/readiness “rejection” claim.
- TypeScript/API docs: P2 “permanently closed” wording missing from proposed
  TSDoc.
- Performance/reliability: HIGH zero-registration/current-generation state is
  unreachable under current ownership; MEDIUM retained-operation close tests
  are omitted.
- Every reviewer used no subagents and is closed. The same Sol High requirements
  splitter receives the complete five-finding batch for architecture records
  only. No implementation is authorized until re-review is clean.

## Architecture Review-Fix Resume

- The same rollout records actual `gpt-5.6-sol / high` at
  `2026-07-13T13:13:05.956Z`, matching explicit dispatch for the resumed
  existing requirements splitter; no subagents were used.
- Prior canonical inventory/manifest/entrypoint/lock evidence remains valid.
  Before record edits, the splitter fully read and selected
  `receiving-code-review`, `codebase-design`, and its directly relevant
  `DEEPENING.md`. No new task-provided skill name/path was supplied.

## Architecture Review-Fix Handback

- This disposition supersedes the initial architecture handback's permanent-
  retirement ownership claims while preserving the coordinator-authored review
  history above.
- Performance/reliability HIGH disposition: resolved. Integrated reachability
  proves there is no legal close-owned zero-registration/current-generation
  state. Retained failed-start refuses through its existing explicit-retry
  channel; unsafe detach and incomplete reusable stop remain live and refuse as
  in use. Permanent admission requires no generation and adds no T-0037b caller.
- Style/maintainability P1 disposition: resolved. The eager unadmitted and not-
  completed stop has an explicit cancellation reason, all waiters reject and settle, `#stop` clears
  by identity, close never awaits the stop turn queued behind it, and that turn
  later rejects without lifecycle mutation. The deterministic race ends with a
  later attach rejecting from permanent state.
- Documentation and TypeScript/API P2 dispositions: resolved. Attach,
  `stopDelivery()`, and `retryDeliveryStop()` have defined promise rejection
  checks; readiness remains synchronous `void` and stale retired-coordinator
  notification no-ops. Proposed TSDoc says “permanently closed.”
- Reliability MEDIUM disposition: resolved. Focused tests explicitly attempt
  close during retained failed-start, unsafe last detach, and incomplete
  reusable stop, proving exact owner/admission/generation/slot/dependency/
  facility/error-state retention and deterministic continuation by the existing
  operation retry.
- All four canonical concerns are returned for re-review as one complete batch.
  Status is `Architecture review-fix handback requested`; implementation remains
  unauthorized. Only the four architecture/task/work/review records changed;
  no tests/full verify, commit, push, generated output, or protected human-review
  access occurred.
- Review-fix handback hygiene passed: Prettier write/check on all four records,
  `git diff --check`, synchronized status headers, and exact documentation-only
  four-file short status. The complete batch is ready for architecture re-review.

## Architecture Fix Coordinator Gate And Re-Review Assignment

- Coordinator inspection and lightweight pre-review lint pass for the complete
  five-finding correction; scope remains the four architecture records only.
- Assigned profiles are style/maintainability `gpt-5.6-terra` / `high`,
  documentation `gpt-5.6-luna` / `medium`, TypeScript/API docs
  `gpt-5.6-terra` / `high`, and performance/reliability
  `gpt-5.6-terra` / `high`; read-only, no subagents, and bounded to the fixed
  state model and acceptance tests.

## Architecture Re-Review Authority Findings

- Documentation: P1 active specification ownership contradicts corrected
  reachable state model.
- Style/maintainability: same P1 plus P1 serial gate must be released after
  permanent admission/cancellation and before facility teardown.
- TypeScript/API docs: CLEAN. Performance/reliability: CLEAN.
- Every reviewer used no subagents and is closed. Sol High authority
  reconciliation is assigned over the bounded active spec sections and current
  four records; implementation remains unauthorized.

## Architecture Authority And Serial-Phase Resume

- The same rollout records actual `gpt-5.6-sol / high` at
  `2026-07-13T13:32:53.484Z`, matching explicit dispatch for the resumed
  requirements splitter; no subagents were used.
- Prior canonical skill applicability remains valid. The splitter fully read and
  selected `receiving-code-review`, `architecture-decision-records`,
  `codebase-design`, and `DEEPENING.md` before changing the expanded seven-file
  documentation scope.

## Architecture Authority And Serial-Phase Handback

- Documentation authority P1: resolved. D-0085/D-0086 active outcomes, runtime
  architecture, completion plan, and current task records now agree that
  T-0037d/e1/e2 own all reachable generation retirement/quiescence/reporting.
  T-0037e3 refuses their retained states and admits only zero registrations/no
  generation. Former assignment text is explicitly superseded by integrated
  ownership evidence without changing public behavior or predecessor ordering.
- Style/maintainability serial P1: resolved. One bounded attachment callback
  performs refusal, provisional-stop/waiter cancellation, and irreversible
  permanent admission, then releases `#serial`. Only afterward does the existing
  coalesced public close attempt invoke `RetryableCloseGroup` outside the gate.
- Deterministic acceptance now defers one facility and proves the cancelled stop
  and waiter settle while public close remains pending, then resolves the
  facility and close. This directly guards against facility settlement starving
  the queued serial turn.
- Prior TypeScript/API and performance/reliability CLEAN dispositions remain
  unchanged. Re-review should verify the reconciled authority text, serial-
  release ordering, seven-file scope, and absence of public or T-0037b expansion.
- Status is `Architecture authority review-fix handback requested`.
  Implementation remains unauthorized; no tests/full verify, commit, push, new
  decision, generated output, or protected human-review access occurred.
- Handback hygiene passed across all seven owned records: Prettier write/check,
  `git diff --check`, synchronized four-record statuses, scoped authority/phase
  claim scans, and exact seven-file documentation-only short status. The
  complete authority/serial-phase batch is ready for re-review.

## Architecture Authority Coordinator Gate And Re-Review Assignment

- Coordinator inspection and lightweight docs/status lint pass for the exact
  seven-file authority reconciliation and serial-phase correction.
- Assigned profiles are style/maintainability `gpt-5.6-terra` / `high`,
  documentation `gpt-5.6-luna` / `medium`, TypeScript/API docs
  `gpt-5.6-terra` / `high`, and performance/reliability
  `gpt-5.6-terra` / `high`; read-only, no subagents, and bounded to active
  authority/phase consistency.

## Architecture Authority Re-Review Findings

- Documentation: P1 exact active D-0085/D-0086 clauses still conflict.
- Performance/reliability: P1 completed stop-first waiter state can be mistaken
  for a later provisional stop.
- TypeScript/API docs: P2 public in-use rejection/no-teardown wording and README
  consistency. Style/maintainability: CLEAN.
- Every reviewer used no subagents and is closed. The same Sol High splitter is
  assigned the three-finding docs batch; implementation remains unauthorized.

## Architecture Final-Fix Resume

- The same rollout records actual `gpt-5.6-sol / high` at
  `2026-07-13T13:49:34.308Z`, matching explicit dispatch for the resumed
  requirements splitter; no subagents were used.
- Prior canonical skill applicability remains valid. The splitter fully read and
  selected `receiving-code-review`, `architecture-decision-records`,
  `codebase-design`, and `DEEPENING.md` before changing the same seven-file
  documentation scope.

## Architecture Final-Fix Handback

- Documentation P1: resolved. The exact active D-0085/D-0086 clauses are
  narrowed and explicitly supersede T-0037e3 generation retirement/quiescence;
  appended outcomes no longer carry the correction alone.
- Performance/reliability P1: resolved. Cancellation requires an eager stop to
  be both unadmitted and not completed. New deterministic acceptance proves a
  completed stop-first no-generation record remains owner through waiter
  settlement, close commits second, the queued attach rejects from permanent
  state, and stop resolves normally before existing `#stop` cleanup.
- TypeScript/API P2: resolved. Proposed public TSDoc states in-use close rejects
  non-destructively and performs no owned-facility teardown; shipping it requires
  matching package README wording in the same implementation slice.
- Style's CLEAN disposition remains unchanged. The complete three-finding batch
  is returned for re-review. Status is
  `Architecture final-fix handback requested`. Implementation remains
  unauthorized; no tests/full verify, commit, push, README edit, new decision,
  or protected human-review access occurred.
- Final-fix hygiene passed across all seven records: Prettier write/check,
  `git diff --check`, synchronized headers, exact scoped status, and active-
  authority/stop-state/public-wording scans. The complete batch is ready for
  re-review.

## Architecture Final-Fix Coordinator Gate

- Coordinator inspection and lightweight pre-review lint pass for the exact
  seven-file final correction.
- Assigned profiles are style/maintainability `gpt-5.6-terra` / `high`,
  documentation `gpt-5.6-luna` / `medium`, TypeScript/API docs
  `gpt-5.6-terra` / `high`, and performance/reliability
  `gpt-5.6-terra` / `high`; read-only and no subagents.

## Architecture Final Re-Review Results And Slice 1 Assignment

- Style/maintainability, documentation, TypeScript/API docs, and performance/
  reliability returned CLEAN. Actual profiles matched dispatch; no reviewer
  used subagents and all are closed.
- Architecture is accepted. Slice 1 is assigned to one fresh implementer at
  explicit `gpt-5.6-terra` / `medium`, no subagents. Review is required after
  focused verification before any later slice begins.
