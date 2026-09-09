# T-0226: Async Handlers, Process Manager Queries, And BlackBox Signals

Status: In progress
Start: `2026-09-09 12:07 WEST`
End: Pending
Baseline commit: `437cafcf380da33222d852f86a802200ef5ddc41`
Task log path: `build-protocol/tasks/T-0226-async-handlers-querying-black-box/TASK.md`
Branch: `feature/async-handlers-querying-black-box`
Worktree: `.worktrees/t-0226`
Authoring sub-agents: `/root/t0226_implementer`,
`/root/t0226_implementer_2`, and `/root/t0226_implementer_3` in sequential
non-overlapping ownership; all use the existing `implementer` role configured
`gpt-5.6-terra` / medium reasoning
Reviewer sub-agents: Pending
Implementation commit: Pending branch commit
Final branch HEAD: Pending branch commit

Task classification: High-risk
Classification reason: This task changes public TypeScript contracts, permits
entity transactions to remain open across asynchronous handler work, attaches
tenant-aware query capability to Process Managers, and observes committed
signals across the server/testing boundary.

## Objective

Allow existing signal handlers to return their normal result either directly
or through `Promise`; give Process Managers a typed, read-only way to query
read-side state; and add external-event intake plus produced Command/Event
inspection to the runner-neutral BlackBox API.

## Human Outcome

As a Spine TS application developer, I want signal handlers to perform
asynchronous work and Process Managers to query projection state, so that I can
coordinate workflows using persistent read-side data and verify the resulting
signals through BlackBox.

## Estimate

Estimated active work: **14-20 uninterrupted agent-hours**.

| Work                                                                    |  Estimate |
| ----------------------------------------------------------------------- | --------: |
| Task records and accepted contract                                      | 1-2 hours |
| Promise-aware handler analysis and tests                                | 2-3 hours |
| Process Manager typed query API and runtime integration                 | 3-5 hours |
| BlackBox external-event and signal-history additions                    | 3-4 hours |
| Reader/API documentation                                                | 1-2 hours |
| Review, corrections, release verification, versioning, push, and report |   4 hours |

The largest uncertainties are sharing typed query concepts without a
`server -> client-node` dependency, binding reads to the active tenant and
actor, and recording only committed context-produced signals. The release gate
may add elapsed waiting time without increasing active work materially. Revise
this estimate promptly if implementation evidence changes those assumptions.

## Required Inputs Read

- `AGENTS.md`
- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/PROJECT_COMPLETION_PLAN.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- Current `core-jvm` `ProcessManager`, `Querying`, `QueryingClient`,
  `QuizProcess`, and `BlackBox` sources.
- Human feedback and approved proposal in the originating task conversation.

## Skill Applicability

Selected skills read before task actions:

| Skill                     | Source                                              | Applicability                    | Instructions Applied                                           |
| ------------------------- | --------------------------------------------------- | -------------------------------- | -------------------------------------------------------------- |
| `using-git-worktrees`     | `~/.agents/skills/using-git-worktrees/SKILL.md`     | Required isolated feature work   | Fresh official baseline and ignored project-local worktree     |
| `implement`               | `~/.agents/skills/implement/SKILL.md`               | Approved implementation task     | Focused typechecks/tests, review, commits                      |
| `test-driven-development` | `~/.agents/skills/test-driven-development/SKILL.md` | Runtime and API behavior changes | Observe focused RED before each production increment           |
| `user-story`              | `~/.agents/skills/user-story/SKILL.md`              | Development-ready task text      | Human outcome and testable scenarios                           |
| `api-design-principles`   | `~/.agents/skills/api-design-principles/SKILL.md`   | Public fluent query contract     | Reuse one typed query abstraction rather than isolated methods |

Skills passed to implementation and review roles must be recorded at dispatch.
No task-specific skill conflicts override the repository protocol.

Implementation dispatch passes `test-driven-development`, `implement`, the
task contract, accepted architecture review, and repository protocol. Both the
model and reasoning profile were explicit in the dispatch. The Desktop surface
does not expose separate live self-introspection; the immutable role profile
and explicit dispatch fields are the available runtime metadata.

## Scope

### Asynchronous handlers

- Accept direct existing return types and `Promise` of those same types for
  `@Assign`, `@Command`, `@React`, and `@Subscribe`.
- Unwrap the promise during build-time analysis, then apply the existing
  decorator-specific return validation.
- Keep generated runtime metadata independent of whether a handler is
  synchronous or asynchronous.
- Preserve commit-after-success, rollback-after-rejection, ordering, and
  synchronous compatibility.

### Process Manager queries

- Add protected typed `select(...)` access to `ProcessManager`, not Aggregate.
- Return a read-only query object supporting the established TypeScript query
  concepts: ID selection, typed predicates, logical groups, ordering, limits,
  masks, and asynchronous execution.
- Provide `findById()` and `all()` as convenience operations, not as the whole
  query contract.
- Execute through Stand internally without exposing Stand mutation methods.
- Bind reads to the active bounded context, actor, and tenant.
- Keep projection reads explicitly eventually consistent.
- Reuse or share existing typed query concepts without adding a production
  dependency from `server` to `client-node` and without creating incompatible
  query languages.

### BlackBox additions

- Add a TypeScript-conventional external-event operation corresponding to JVM
  `receivesExternalEvent`; the approved proposed name is `postExternalEvent` on
  `BlackBoxScope`.
- Route it through the external-event intake semantics with actor, tenant,
  zone, timestamp, and `EventContext.external = true` preserved.
- Add runner-neutral `assertCommands()` and `assertEvents()` immutable
  snapshots.
- Include only Commands and committed Events produced by the tested context.
- Exclude setup input Commands, setup domain Events, received external Events,
  and rolled-back output.
- Preserve production order and BlackBox lifecycle ownership.

### Documentation

- Correct the blanket prohibition on write-side projection reads: Process
  Managers may query eventually consistent read-side state; Aggregates may not
  use projections for invariants.
- Document handler promises, transaction duration, rejected promises, and the
  non-rollback nature of external side effects.
- Document safe query usage, `all()` limits, and BlackBox snapshot timing.
- Keep public TSDoc and beginner-facing examples current.

## Out Of Scope

- Query access from Aggregates.
- Direct write access to Stand from Process Managers.
- Strong consistency between a handler transaction and projection state.
- Rollback of HTTP or other external side effects.
- Distributed transactions or a new outbox subsystem.
- Cursor pagination.
- Async iterators, streams, or arbitrary thenables as handler results.
- Test-runner-specific assertion subjects.
- Pull-request creation, merge to `master`, or publication.

## Public Contract

The exact generic spelling is resolved against existing declarations, but the
approved behavior is equivalent to:

```ts
const pending = await this.select(AccessRequestViewSchema, AccessRequestViewColumns)
  .where(EntityQuery.eq(AccessRequestViewColumns.status, Status.pending))
  .orderBy(AccessRequestViewColumns.createdAt, "asc")
  .limit(10)
  .read();

const one = await this.select(AccessRequestViewSchema, AccessRequestViewColumns).findById(
  requestId,
);

const all = await this.select(AccessRequestViewSchema, AccessRequestViewColumns).all();
```

The query object exposes no update, archive, delete, transaction, storage, or
cross-tenant override operation.

BlackBox additions are equivalent to:

```ts
await box.onBehalfOf("external-system").postExternalEvent(AccessGrantedSchema, event);

const commands = box.assertCommands();
const events = box.assertEvents();
```

Snapshots represent the capture state at call time. Eventual tests use the
existing `blackBox.eventually(...)` operation explicitly.

## Acceptance Criteria

1. A synchronous handler for every supported decorator retains its current
   behavior and generated metadata.
2. An async `@Assign` handler may return a promise of every return shape already
   legal for synchronous assignment.
3. An async `@Command` handler may return a promise of every return shape already
   legal for synchronous command production.
4. An async `@React` handler may return a promise of every return shape already
   legal for synchronous reaction, including the established no-reaction form.
5. An async `@Subscribe` handler may return `Promise<void>`.
6. A promise of a decorator-invalid type fails build-time analysis with the
   established clear diagnostic.
7. Runtime commit occurs only after promise fulfillment; promise rejection
   rolls back entity state and publishes no provisional output.
8. A Process Manager can find one projection state by ID and use it in an async
   handler result.
9. A Process Manager can execute typed ID, predicate, logical grouping,
   ordering, mask, and limit operations through one query abstraction.
10. `findById()` returns `undefined` for a missing visible state; `all()` returns
    an immutable empty list when none are visible.
11. Query execution excludes deleted current records, leaves archived current
    records visible/filterable under the existing contract, and observes the
    active signal tenant; equal IDs in another tenant are not visible.
12. Aggregate has no public or protected `select(...)` capability.
13. Process Manager query types expose no state-changing Stand capability.
14. Query access fails clearly before runtime attachment and after context
    closure rather than reading an unrelated context.
15. `postExternalEvent()` reaches external handlers and does not reach
    domestic-only handlers for the same event type.
16. External-event intake retains the BlackBox actor, tenant, zone, timestamp,
    and external-origin marker.
17. `assertCommands()` returns context-produced Commands in production order
    and excludes incoming/setup Commands.
18. `assertEvents()` returns successfully committed context-produced Events in
    production order and excludes incoming domain/external Events and
    rolled-back output.
19. Returned signal snapshots and envelopes cannot mutate later snapshots or
    BlackBox history.
20. Closing BlackBox releases capture resources and rejects later operations.
21. Public package exports, generated declarations, API docs, package docs, and
    beginner guidance describe the implemented contract without exposing
    internal lifecycle or storage seams.

## TDD And Verification

- Add one focused behavior test at a time and record its expected RED result
  before changing corresponding production code.
- Run focused analyzer, repository, Stand/query, and BlackBox tests during each
  increment.
- Run affected package typechecks regularly.
- Run deterministic generated-source, formatting, lint, TSDoc, documentation,
  dependency-direction, and `git diff --check` checks before review.
- Run one complete relevant specialist review wave and return one aggregated
  correction batch to the implementation owner.
- Run `pnpm verify:release` once after review convergence because shared runtime
  and public contracts change.
- Select one common unused workspace version. Put only top-level version fields
  in the exact commit `Bump version -> <version>`; keep dependency pins,
  lockfile, and generated metadata in separate commits.
- Push every feature-branch commit to official `origin` immediately. Do not
  create or merge a pull request.

## Agent Routing

The Codex Desktop surface supports explicit child role profiles. Subagents may
not spawn subagents.

- Architecture/requirements pass: existing `requirements_splitter` role,
  configured `gpt-5.6-sol`, high reasoning, one pass before implementation.
- Implementation owner: existing `implementer` role, configured
  `gpt-5.6-terra`, medium reasoning, sole owner of production code and focused
  behavior tests.
- Mechanical verification: orchestrator function using the repository scripts.
- Review wave: existing style/maintainability, TypeScript/API docs,
  performance/reliability, documentation, and final security roles where the
  changed behavior makes each concern applicable.

Actual runtime self-introspection may be unavailable. The immutable configured
role profile and explicit dispatch fields are the acceptance evidence when the
surface exposes no additional metadata.

## Work Log

- `2026-09-09 12:07 WEST`: Fetched official `origin/master`; selected baseline
  `437cafcf380da33222d852f86a802200ef5ddc41`.
- `2026-09-09 12:07 WEST`: Created clean isolated worktree and branch. Initial
  accidental `npm install` in the coordination checkout failed with an npm
  internal `matches` error and changed no source; repository setup uses pinned
  pnpm and will be retried in the task worktree.
- `2026-09-09 12:07 WEST`: Persisted the human-approved contract and revised
  14-20 hour estimate before production implementation.
- `2026-09-09 12:24 WEST`: Assigned the first Promise-handler slice to the sole
  production implementation owner `/root/t0226_implementer`, using the existing
  `implementer` role with explicit configured `gpt-5.6-terra` / medium
  reasoning. The owner may not spawn subagents or revert concurrent work.
- `2026-09-09 12:32 WEST`: Completed slice 1 analyzer RED/GREEN and runtime
  settlement characterization. The analyzer unwraps exactly one outer built-in
  `Promise<T>` (including local aliases), preserves existing validation and
  generated metadata, and rejects promise-like, thenable, missing-generic, and
  nested-Promise forms. Runtime regression coverage proves delayed fulfillment
  does not expose state early, rejected promises roll back and suppress output,
  and same-Aggregate command execution remains serial.
- `2026-09-09 12:36 WEST`: Began slice 2 shared-query extraction. Moved the
  existing descriptor-column and wire-query builder foundations to core and
  retained client-node module-path compatibility forwarders. Core and
  client-node TypeScript builds are green; server reader extraction and Process
  Manager capability tests remain next.
- `2026-09-09 12:41 WEST`: Extracted and pushed the bounded reusable server
  query reader at `6d6c2ae65`; 114 focused SpineServices tests and server
  typecheck passed.
- `2026-09-09 12:42 WEST`: The first owner exhausted its execution window with
  no further changes. Sequential sole ownership transferred to
  `/root/t0226_implementer_2`, the same existing role with explicit configured
  `gpt-5.6-terra` / medium reasoning, for Process Manager queries and the
  remaining approved work.
- `2026-09-09 12:55 WEST`: The second owner pushed Process Manager query code
  and integration coverage through `f4f822bb0`, then exhausted its execution
  window with no uncommitted implementation. Sequential sole ownership
  transferred to `/root/t0226_implementer_3`, the same existing role and
  explicit configured profile, to close actor/bound/type proofs before
  BlackBox work.
- `2026-09-09 12:49 WEST`: Process Manager query RED/GREEN increments added a
  protected `select()` surface and shared storage-neutral query plan. The
  repository binds a cloned signal actor context and resolved tenant to each
  freshly loaded Process Manager before command/event handler invocation, then
  releases it in `finally`. Focused core/server typechecks and 37 focused tests
  passed. Remaining behavior coverage must exercise repository dispatch,
  lifecycle visibility, and concurrent tenant isolation before review.
- `2026-09-09 12:54 WEST`: Repository-dispatch coverage proves Process Manager
  reads isolate equal projection IDs by active tenant, retain archived records,
  exclude deleted records, and return state copies that cannot change a later
  read. The lifecycle test first failed because storage order is deliberately
  unspecified; its assertion now checks membership rather than order. Focused
  core/client-node/server builds and 302 query/repository tests passed.

## Decisions

- `D-0120` records the Process Manager query and async-handler boundaries.
- `ARCHITECTURE_REVIEW.md` records the accepted one-time high-risk architecture
  pass and three-slice TDD order.

## Human Questions And Answers

- Human confirmed that Spine JVM Process Managers may query read-side state and
  asked for source verification. Current JVM implementation and a real handler
  fixture confirmed it.
- Human approved a complete typed query interface rather than only
  `findById()` and `all()`.
- Human approved the full revised proposal and revised the estimate downward to
  14-20 active hours.
- Blocking questions: none.

## Files Changed

- This task and work log.
- `build-protocol/DECISION_LOG.md` for the accepted architecture boundary.
- `packages/proto-tools/src/generation/build-time-handler-analyzer.ts`.
- Focused analyzer and repository-routing behavior tests.

## Tests Run

- `pnpm install --frozen-lockfile` - passed with an unchanged lockfile; expected
  pre-build missing-bin warnings only.
- `pnpm check:node` - passed.
- `pnpm proto:generate` - passed all authored/frozen Proto checks.
- `pnpm typecheck:build:generated` - passed.
- Focused baseline Vitest run over build-time handler analysis, typed Entity
  queries, Stand, repository routing, testing BlackBox, and the cross-package
  BlackBox fixture - 5 files and 375 tests passed with zero failures.
- RED: `pnpm exec vitest run packages/proto-tools/test/build-time-handler-analyzer.test.ts`
  - 2 expected failures before implementation: legal Promise returns were
    rejected and invalid inner types bypassed existing schema diagnostics.
- GREEN: combined focused analyzer and repository-routing run - 314 passing
  tests; affected proto-tools and server TypeScript builds passed; `git diff
--check` passed. A rejected handler promise is intentionally suppressed at
  command intake after rollback, as characterized by the runtime regression.
- RED: `pnpm exec vitest run packages/server/test/repository/repository-routing.test.ts
packages/server/test/repository/repository.test.ts` - the new full-dispatch
  actor-context test failed as expected because `QueryReader.observe` was not
  implemented.
- GREEN: the same focused repository run passed 290 tests after adding the
  package-internal cloned wire-query observer, the Process Manager 1,000-row
  limit, compile-time query-surface assertions, and exact unbound/retained
  lifecycle errors.
- `pnpm exec tsc -b packages/core packages/client-node packages/server` - passed.
- Focused core/client/server query, service, and repository run - 418 tests
  passed with zero failures.

## Coverage Result

- Pending focused and release coverage.

## Documentation And Public API Impact

| Area                             | Impact                                                               |
| -------------------------------- | -------------------------------------------------------------------- |
| Package README impact            | Server and testing usage require updates                             |
| TypeDoc/API docs impact          | New Process Manager query and BlackBox APIs; promise handler returns |
| Public API additions/removals    | Additive APIs; no approved removals                                  |
| Framework `USER_GUIDE.md` impact | Async handler/query/BlackBox examples required                       |
| Example `USER_GUIDE.md` impact   | Update only if an affected public example uses these APIs            |
| API examples                     | Add beginner-level Process Manager and BlackBox examples             |
| Compatibility notes              | Existing synchronous handlers remain compatible                      |

## Security Impact

| Area                    | Impact                                                       |
| ----------------------- | ------------------------------------------------------------ |
| Dependencies            | No new dependency approved                                   |
| Secrets and credentials | No change                                                    |
| IPC                     | External event remains within existing intake semantics      |
| Validation              | Promise-unwrapped types retain existing schema validation    |
| Tenant boundaries       | High-risk: query capability must bind the active tenant      |
| `Any`/deserialization   | Existing query/envelope facilities only                      |
| Logging                 | Existing handler/query failure diagnostics remain applicable |

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                                              | Owner                | Disposition           | Next Review Point              |
| ----------------------------------------------------------- | -------------------- | --------------------- | ------------------------------ |
| Query types could create `server -> client-node` dependency | Implementation owner | Must avoid            | Architecture and API review    |
| Query capability could escape its active tenant/lifecycle   | Implementation owner | Must prevent          | Reliability/security review    |
| Signal capture could include inputs or uncommitted output   | Implementation owner | Must prevent          | Correctness/reliability review |
| `all()` may be costly on large projections                  | Documentation        | Accepted with warning | Documentation review           |
| HTTP side effects cannot roll back                          | Documentation        | Accepted limitation   | Documentation review           |

## Slice 2 Closure

The Process Manager path now builds the same wire `Query` as its fluent plan
and passes it through the bounded reader's package-internal test observer.
Full repository dispatch proves source actor, tenant, and zone preservation.
The process-manager-only query object rejects limits above 1,000, exposes no
mutation or tenant override at runtime or compile time, and rejects both
unbound access and retained query execution after release with the established
message. The observer is not exported from the server package entrypoint.

## Slice 3 Progress

RED: the BlackBox contract failed because produced-signal snapshots and scoped
external-event posting did not exist. GREEN: a server/testing-only observer
captures cloned SignalPublisher Command/Event admissions without affecting
publication, and BlackBox attaches it at creation, returns cloned snapshots,
and detaches it after server cleanup. `postExternalEvent()` now constructs the
scoped envelope and uses the narrow server testing external-intake seam.

## Review Waves And Dispositions

- One read-only architecture/requirements pass dispatched to the existing
  `requirements_splitter` role with explicit configured profile
  `gpt-5.6-sol` / high reasoning. The pass completed cleanly with no file edits;
  its dependency, lifecycle, and capture recommendations are accepted in
  `ARCHITECTURE_REVIEW.md`.

## Integration Result

Pending feature-branch commits, pushes, and human review.
