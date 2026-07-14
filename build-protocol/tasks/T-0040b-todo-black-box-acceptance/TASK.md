# T-0040b: To-Do Black-Box Acceptance

Status: In progress - Wave 1 fixes verified; targeted re-review pending

Started: `2026-07-14T18:27:30Z`

Baseline commit: `acd9f05c`

Branch: `task/T-0040b-todo-black-box-acceptance`

Worktree: `.worktrees/T-0040b-todo-black-box-acceptance`

Dependency: T-0040a is complete, integrated, post-merge verified, remotely
synchronized, and cleaned up.

## Objective

Consolidate the to-do application as a black-box release specimen that proves
the accepted public framework behavior through real generated clients, a real
ephemeral loopback server, asynchronous delivery, and deterministic lifecycle
cleanup.

## Human-Imposed Requirements Ledger

- Continue autonomously until project completion or a real protocol blocker.
- Keep this slice limited to black-box acceptance and minimal example/test
  harness corrections exposed by those tests. T-0040c owns README and example
  user-guide closure; T-0041 owns project-wide security review.
- Preserve accepted DDD, Spine Protobuf/type-URL, public API, generated-output,
  review, logging, verification, worktree, remote-push, and cleanup rules.
- Use only supported public package imports in example application and
  black-box client code. Do not import `packages/**/src` internals or expose a
  framework internal merely to make a test pass.
- Start a real local gRPC-compatible server on an ephemeral loopback port and
  use generated clients for command, query, and subscription behavior.
- Prove immediate successful command acknowledgement separately from eventual
  aggregate/projection handling through asynchronous delivery.
- Prove query-all, exact ID, and supported column filtering; subscription
  activation, update delivery, cancellation, and shutdown; packed validation
  details; business refusal; and missing/invalid default-route target rejection
  before handler invocation.
- Prove generated handler-registry failure and recovery, server close waiting
  for delivery lifecycle, and absence of leaked listeners/sessions.
- Retain the real child-process/local-IPC proof from T-0040a as part of the
  acceptance surface; do not duplicate or weaken it.
- Ordinary end-user handlers remain free of framework `Command`/`Event`
  envelopes, `packCommand()`/`packEvent()`, schema-bearing decorators,
  aggregate `@Apply`, manual transactions, internal IDs/default-target
  extraction, handler materializers, and internal lifecycle APIs.
- Use behavior-focused TDD for every new behavior or defect. Record RED before
  GREEN. Prefer focused native loopback/IPC checks during inner loops and reserve
  full `pnpm verify` for the final task and post-merge gates.
- Dispatch every child with an explicit existing role, model, and reasoning;
  record immutable runtime metadata; prohibit child subagents; close each child
  promptly.
- Record a clean or concrete N/A disposition for style/maintainability,
  documentation, TypeScript/API docs, and performance/reliability. Security is
  deferred to T-0041.
- After acceptance, push the completed task branch and verified `main` to
  `origin`, record remote refs, and remove only the clean merged worktree.
- Never read, edit, stage, delete, or use `human-review-1-jul.md`.

## Acceptance Criteria

- Clean Protobuf and handler-registry generation produces ignored outputs and a
  buildable example.
- A standalone to-do server binds an ephemeral loopback port and generated
  clients connect without private framework imports.
- Successful command posting acknowledges immediately; aggregate and projection
  effects become observable only through bounded asynchronous acceptance waits.
- Query acceptance covers all rows, exact task-list ID, and one supported
  column filter without relying on storage internals.
- Subscription acceptance covers activation, a relevant update, cancellation,
  and server shutdown without a retained stream/session.
- Invalid input returns packed Spine validation details. Invalid complete and
  reopen transitions return the accepted business refusal.
- Missing and invalid first-field IDs are rejected by the default route before
  the application handler is called.
- A missing/stale generated handler registry fails with actionable diagnostics,
  then clean regeneration restores startup/handling.
- Server close waits for delivery quiescence and leaves no listener, client
  session, child process, socket, or temporary artifact.
- T-0040a's real local multi-process test remains part of the focused example
  acceptance gate.
- Static scans reject every forbidden end-user API pattern listed in the ledger.
- Focused example/native acceptance, generated-clean checks, coverage,
  typecheck/lint/format/diff, all relevant reviews, final `pnpm verify`, and
  post-merge verification pass.

## Scope

- Expected writes: focused black-box tests under `examples/todo/test`, minimal
  public example start/client seams only when existing source cannot be driven
  black-box, example test/build metadata only when necessary, and T-0040b
  durable records.
- Existing `examples/todo/src/index.test.ts` and T-0040a local multi-process
  acceptance may be consolidated or reused; avoid duplicating their behavior.
- Generated Protobuf and handler-registry output remains ignored and untracked.

## Out Of Scope

- README or example user-guide closure (T-0040c).
- New framework public APIs, transport adapters, persistence, authentication,
  deployment, production supervision, health checks, tracing, remote-host
  topology, retry backoff, or monitoring policy.
- Reimplementing framework unit/integration coverage already proven below the
  example boundary.

## Risks And Guardrails

- Black-box tests must not pass through an in-process shortcut when they claim
  real server/client behavior.
- Every wait, stream, listener, and child/process resource needs one explicit
  owner, deadline, and deterministic cleanup path.
- Validation/refusal assertions must inspect public wire details rather than
  matching incidental internal exception strings.
- Registry recovery tests must restore generated state even when assertions
  fail and must not leave generated output tracked.
- No requirements splitter is assigned: this task changes no public/serialized
  contract, domain ownership, transaction, concurrency, or idempotency rule. A
  demonstrated missing mandatory public seam would stop example edits and be
  escalated as a separate tiny framework child.

## Initial Assignment

- Investigation found no missing public framework seam. Existing tests prove
  registry failure/recovery, context metadata, all domain operations, query
  shapes, subscription behavior, validation details, refusals, and catch-up;
  T-0040a proves real local IPC. The real-loopback test currently covers only a
  happy command/query/subscription path and basic close.
- Move the legacy `examples/todo/src/index.test.ts` test out of production
  source into `examples/todo/test/black-box.test.ts`, preserving all 20 current
  cases and adjusting only path-sensitive references. Existing Vitest and
  tooling discovery already include the destination; no config change is
  authorized.
- Extend the real generated-client coverage for query all/by-ID/column,
  validation details, complete/reopen refusals, subscription cancellation and
  stream settlement, listener closure, and missing/blank target rejection with
  no observable task effect. Reuse current helpers and avoid duplicate fixtures.
- Public command payload validation may intentionally reject missing/blank
  required IDs before repository routing. If the wire path cannot distinguish
  that earlier valid rejection from default-route rejection, retain the existing
  focused repository-route proof in the task gate and record the mapping; do not
  weaken validation, alter Protobuf, or expose a new seam.
- Implementation uses existing immutable `implementer`, expected explicit
  `gpt-5.6-terra` / medium, one write owner, no subagents, and no Git mutation.
  Ownership: the moved test, minimal test-only helpers, this task brief, and work
  log. Production source, dependencies, build config, and review log are not
  owned unless a concrete blocker is returned first.

## Implementation Evidence

- `2026-07-14`: RED source/test separation check counted 20 legacy cases and
  failed because `examples/todo/src/index.test.ts` still existed. The generic
  cleanup checker passed because it does not currently enforce example test
  placement; the explicit criterion check is the task-level proof.
- `2026-07-14`: moved all 20 legacy cases to
  `examples/todo/test/black-box.test.ts`; the only path-sensitive source
  assertion now reads `../src/index.ts`. Vitest and tooling TypeScript discover
  the destination without configuration changes.
- Five coherent real ephemeral-loopback generated-client cases now share one
  `withRemoteTodo(onRun)` owner for server start, generated clients, explicit
  public HTTP/2 session ownership, and bounded deterministic cleanup. They
  prove an immediate OK acknowledgement and bounded eventual projection
  observation as separate public outcomes; all rows, exact ID, and
  `open_task_count` filter queries;
  activation, delivered update, cancel ACK, iterator return/settlement, server
  close, and closed-listener rejection. They also prove packed
  `ValidationError` details and unchanged state for invalid rename; both
  business refusals and unchanged state; and stable public rejection/no effect
  for missing and blank task IDs. Payload validation is permitted to precede
  repository routing, so `packages/server/test/repository/repository-routing.test.ts`
  remains the direct before-handler route proof.
- No production defect was found: the stable runtime passed the new acceptance
  assertions on its first complete execution. A TypeScript-only RED in the new
  iterator-return fallback was corrected with the minimal explicit
  `IteratorResult<SubscriptionUpdate>` type.
- `readRemoteEventually()` now names its callback `onAccept`, bounds each read
  by the overall deadline, and throws a sanitized diagnostic containing query
  ID, elapsed budget, read attempts, status, bounded row count, and bounded row
  IDs when acceptance never succeeds. A controlled test first failed because
  the helper silently returned the unacceptable response, then passed after
  the helper change. The closed-listener probe owns and aborts a separate
  public `Http2SessionManager` in `finally`.
- Focused evidence: black-box, local multi-process, and server lifecycle tests
  passed (3 files, 65 tests); focused route rejection passed (3 selected tests,
  122 skipped); build and tooling no-emit TypeScript passed; focused ESLint,
  cleanup enforcement, generated-clean, direct Prettier formatting, and
  whitespace diff checks passed. Repository `format:check` remains deferred to
  the coordinator: before Git stages the authorized rename, its tracked-file
  enumerator still asks Prettier to read the deleted
  `examples/todo/src/index.test.ts`. No Git mutation is authorized in this role.

## Coordinator Pre-Review Findings

- Split the single 200-line real-loopback scenario into coherent acceptance
  cases with one small shared owner for server, clients, HTTP/2 session, and
  cleanup. Keep all cases in the moved file so registry mutation remains
  serialized.
- Rename the function-valued `accept` parameter to `onAccept` and make
  `readRemoteEventually()` throw an actionable bounded diagnostic when the
  predicate is still false at its deadline instead of returning an unaccepted
  response.
- Give the closed-listener probe its own explicit public
  `Http2SessionManager` and abort it in `finally`; no implicit client session may
  outlive the assertion.
- Preserve current behavior/evidence and add focused proof for deadline failure
  if the helper change needs a new branch. Same implementer/profile and write
  scope; no production, dependency, config, public-doc, or review-log edit.

## Coordinator Implementation Verification

- Inspected the 76% Git rename and complete moved test. All 20 legacy cases are
  preserved, five coherent real-loopback cases own the new acceptance, and the
  shared `withRemoteTodo(onRun)` helper owns one public HTTP/2 session plus
  bounded server cleanup. The closed-listener probe owns and aborts a separate
  session.
- `readRemoteEventually()` uses `onAccept`, bounds each read to remaining time,
  and throws capped sanitized diagnostics. Its controlled deadline test proves
  query ID, deadline, attempts, status/row context, and control-character
  sanitization.

## Reviewer Wave 1 Finding Batch

- Documentation accepted P2: the missing-registry criterion promises actionable
  diagnostics, but the test only proves rejection and recovery. Assert stable,
  useful diagnostic content before restoring the registry.
- Style and reliability accepted P1: replace the fixed pre-stream delay with a
  causal, bounded public activation probe before the update under test.
- Style and reliability accepted P1: rejected command no-effect assertions
  currently accept the pre-delivery snapshot immediately. Fence each rejected
  batch with a later valid command observed through the projection, then assert
  the target snapshot is unchanged.
- Style/reliability strict ACK-before-update scheduling assertion is rejected as
  an overstatement of the accepted public contract. The completion plan requires
  immediate successful acknowledgement and eventual asynchronous handling as
  separate observations; it does not guarantee which HTTP/2 promise settles
  first after intake. Rename current task/test wording that says "before
  delivery" and preserve the two independent public observations.
- TypeScript/API docs is clean. All four reviewers are closed. The same
  implementer owns this complete test-and-record fix batch; no production,
  dependency, configuration, or public-doc change is authorized.
- Fresh native coordinator regression passed 3 files and all 65 tests.
  Focused repository routing passed 3 selected tests with 122 skipped.
- `typecheck:build`, `typecheck:tooling`, full lint/cleanup, repository
  `format:check` after staging the authorized rename, generated-clean checks,
  generated tracking, forbidden end-user API scan, and `git diff --check`
  passed. No production, dependency, config, public-doc, or public API file
  changed. Commit and begin targeted review.

## Reviewer Wave 1 Fix Evidence

- The missing compiled-registry case now asserts the stable conventional module
  path plus `must exist and be readable`, restores the registry in `finally`,
  and proves context creation recovers afterward.
- Subscription activation no longer depends on a fixed delay. A bounded
  `iterator.next()` begins activation, a distinct valid probe command is posted,
  and its update is observed before a fresh bounded `next()` owns the command
  update under test. Subscription creation, both command acknowledgements,
  stream reads, cancellation, iterator settlement, and cleanup are bounded.
- The ACK test and task wording now prove OK acknowledgement and eventual query/
  subscription effects as separate observations without claiming strict HTTP/2
  promise settlement order.
- Invalid rename and reopen-open share a later valid projected sentinel fence;
  repeated completion has its own later valid projected fence; and missing/
  blank ID rejection has a later valid projected fence. Target snapshots and
  row counts are read only after those causal fences, eliminating acceptance of
  a merely pre-delivery snapshot.
- These changes strengthen test observation rather than production behavior.
  The focused registry diagnostic case passed on first execution (1 selected /
  24 skipped), the causal activation case passed on first execution (1 selected
  / 24 skipped), and the fenced refusal/invalid-ID cases passed on first
  execution (2 selected / 23 skipped). No production RED was fabricated.
- Coordinator inspection confirmed the probe update crosses the same public
  stream before a fresh tested read, and each later sentinel is observed through
  its public projection before the rejected target is compared. Native focused
  regression passed 3 files / 65 tests; direct route proof passed 3 selected /
  122 skipped. Build/tooling typechecks, full lint/cleanup, format,
  generated-clean, and `git diff --check` passed.

## Skill Applicability

- Session inventory source: Desktop-provided skills list. Repo inventory source:
  `build-protocol/skills/EXPECTED_SKILLS.md`. Installed entrypoints and
  `/Users/armiol/.agents/.skill-lock.json` are readable advisory sources.
- Read and selected for coordination/implementation: `using-git-worktrees`,
  `subagent-driven-development`, `test-driven-development`,
  `javascript-testing-patterns`, `nodejs-backend-patterns`,
  `requesting-code-review`, and `verification-before-completion`.
- `typescript-advanced-types` is deferred unless investigation finds a real
  compile-time contract issue. Architecture/design skills are N/A because the
  task consolidates stable public behavior and has no deep-planning trigger.
- No dependency/library search is needed initially: the accepted stack already
  supplies Vitest, Connect/gRPC-compatible generated clients, the server,
  testing utilities, and ZeroMQ. Reassess only if a concrete gap is proven.
