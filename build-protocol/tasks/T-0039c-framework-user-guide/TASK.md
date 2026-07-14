# T-0039c: Framework User Guide Closure

Status: Review wave 3 assigned

Started: `2026-07-14T13:03:12Z`

Baseline commit: `aaa31116`

Branch: `task/T-0039c-framework-user-guide`

Worktree: `.worktrees/T-0039c-framework-user-guide`

Dependency: T-0039b complete, merged, post-merge verified, remotely
synchronized, and cleaned up.

## Objective

Make `docs/USER_GUIDE.md` sufficient for a new framework user to model, build,
run, validate, observe, test, and close a supported Spine TS server application
without reading internal source.

## Human-Imposed Requirements Ledger

- Continue autonomously until project completion or a real protocol blocker.
- Keep this slice limited to the framework user guide and its durable records;
  T-0040 owns local multi-process example behavior and example-specific docs.
- Preserve accepted DDD, Spine Protobuf/type-URL, public API, generated-output,
  review, logging, verification, worktree, push, and cleanup requirements.
- Ordinary application code uses bare decorators and generated domain messages.
  It must not use framework `Command`/`Event` envelopes, `packCommand()` or
  `packEvent()` in handlers, schema-bearing decorators, aggregate `@Apply`,
  manual transaction controls, internal IDs/default-target extraction, handler
  materializers, or internal lifecycle APIs.
- Public guide claims describe observable current behavior and explicit initial-
  release exclusions without promising future retry, monitoring, supervision,
  topology, health, catch-up, import, or legacy compatibility policy.
- Public snippets use package imports. Illustrative generated/application
  packages must be identified as consumer substitutions, and practical snippets
  must compile or be explicitly labeled with their required fixture inputs.
- Use focused checks in inner loops and reserve full `pnpm verify` for final and
  post-merge gates.
- Run only existing relevant review concerns; per-task security remains deferred
  to T-0041.
- Explicitly dispatch child model/reasoning, prohibit child subagents, push the
  completed branch and verified `main`, and remove the clean merged worktree.
- Never read, edit, stage, delete, or use `human-review-1-jul.md`.

## Required User Journey

1. Install dependencies and generate Protobuf-ES output.
2. Model IDs, state, commands, and events with accepted Spine conventions.
3. Write bare-decorated aggregate, process-manager, and projection handlers with
   valid explicit return types.
4. Generate and load the framework-owned handler registry.
5. Assemble storage, bounded contexts, and `ServerEnvironment`.
6. Start and close `Server` with correct startup, ownership, and retry-safe close
   expectations.
7. Post commands and distinguish immediate acknowledgement from asynchronous
   framework work.
8. Query and subscribe to state through supported service/client paths.
9. Handle validation failures and business refusal without internal envelopes.
10. Test through `@spine-ts/testing` and real Connect/gRPC clients.
11. Understand at-least-once/replay-safe delivery expectations, local IPC trust
    boundaries, initial-release exclusions, and non-production adapters.

## Acceptance Criteria

- The guide follows the required journey in a discoverable order and uses one
  coherent generated application vocabulary instead of implementation history.
- Every practical command, import, code fence, and link is current and either
  executable/typeable or explicitly identifies fixture/consumer substitutions.
- Handler examples use only bare `@Assign`, `@Command`, `@React`, and
  `@Subscribe` as appropriate, with generated domain-message inputs/returns and
  no framework-owned materialization or transaction control.
- Generated registry, bounded-context async assembly, storage/environment
  selection, server startup/recovery/listener ordering, caller/server/facility
  ownership, retry-safe close, and shutdown ordering match current public APIs.
- Command acknowledgement/asynchronous work, query/subscription behavior,
  validation/refusal semantics, testing seams, delivery guarantees, and ZeroMQ
  trust/limitation wording match current code and canonical docs.
- Legacy/internal compatibility APIs are omitted from the user journey or
  identified narrowly as non-application surfaces; `IMPORT_EVENT` and import
  buses are not recommended.
- The guide does not claim future policy or expose internal coordinator,
  obligation, generation, cursor, endpoint, raw callback, or lifecycle controls.
- Focused snippet/end-user scans, docs/API checks, links, formatting, diff, and
  every relevant review concern are clean before the final full gate.

## Scope

- Primary write scope: `docs/USER_GUIDE.md` and these three T-0039c records.
- A focused documentation/snippet assertion may change only when needed to
  prevent a concrete user-guide regression.
- Exclude runtime source, public exports, package manifests, dependencies,
  Protobuf contracts, generated output, package READMEs, example source/docs,
  canonical architecture/specification, and historical-log rewrites.

## Risk Assumptions

- The existing 1,340-line guide mixes historical slice inventories with user
  guidance; preserving every section would preserve contradictions. Prefer a
  coherent supported journey while retaining only useful current limitations.
- Package imports for consumer-generated schemas/domain modules are illustrative
  and must be labeled because those packages do not resolve in this workspace.
- `docs:check` verifies API coverage but not prose or every snippet; focused
  end-user and identifier/import audits remain necessary.
- T-0040 may refine example-specific commands later. This task documents the
  current framework workflow without claiming unfinished multi-process example
  behavior.

## Planning Disposition

- No requirements splitter: this task changes no architecture, domain model,
  public/serialized contract, transaction, concurrency, or idempotency rule.
  The completion plan already supplies the exact user journey and prohibitions.
- One Terra Medium implementer owns the bounded guide rewrite. Coordinator owns
  commits, independent review, full gates, merge, push, and cleanup.

## Author Assignment

- Existing role: implementer.
- Explicit immutable profile: `gpt-5.6-terra` / medium.
- Write ownership: `docs/USER_GUIDE.md` and these three records only; focused
  guide assertion only after recording a concrete need.
- Read current public package docs, `DEVELOPER_API.md`,
  `RUNTIME_ARCHITECTURE.md`, and public source/tests as factual evidence.
- No subagents. No commit, merge, push, worktree, or other Git mutation.
- Required handback: changed paths, journey coverage, evidence for lifecycle/
  handler/testing/delivery claims, practical versus illustrative snippet
  disposition, focused command results, exclusions, uncertainty, skills used,
  and actual immutable runtime profile.

## Author Handback

- Reconciled `docs/USER_GUIDE.md` into the required eleven-step end-user
  journey without changing runtime, public APIs, packages, generated output, or
  example sources/docs.
- Evidence: current root and package READMEs, `DEVELOPER_API.md`,
  `RUNTIME_ARCHITECTURE.md`, public server/testing/transport exports, and
  server lifecycle/handler source were used to retain current behavior.
- Snippets using `@example/*` are explicitly identified consumer substitutions;
  client and fixture snippets name every required consumer fixture. No focused
  guide assertion was needed because the rewrite introduced no concrete
  regression test need.
- Focused validation and scan results are recorded in the work log. Full
  `pnpm verify`, review, Git integration, remote synchronization, and cleanup
  remain coordinator work.
- Immutable author profile actually used: implementer,
  `gpt-5.6-terra` / medium; no subagents.

## Coordinator Pre-Review Findings

- At `2026-07-14T13:15:07Z`, the lightweight docs/status lint found two
  accepted documentation defects before reviewer dispatch.
- The Protobuf model declares `Task` as the aggregate state, while the handler
  fragment extends `Aggregate<string, typeof TaskStateSchema, number>` and also
  references process-manager/projection state schemas not modeled in the
  preceding contract. The fragment therefore is not the coherent typeable
  example it claims to be. Make the modeled entity schemas, generated imports,
  entity ID generics, and handler classes agree without adding internal APIs.
- `PROJECT_COMPLETION_PLAN.md` still presents T-0039a as the active frontier in
  its three current-status statements. Update only those current-status lines
  to the factual T-0039c pre-review-fix state; do not rewrite historical plan
  creation context or later packets.
- The same existing implementer context is assigned the complete batch with
  explicit immutable `gpt-5.6-terra` / medium dispatch and no subagents. Write
  scope is the guide, these three records, and only the plan's three stale
  current-status statements. Full verification, review, Git mutation,
  integration, push, and cleanup remain coordinator-owned.

## Pre-Review Fix Implementation

- Reconciled sections 2 and 3 around one generated consumer vocabulary:
  `TaskId`, aggregate state `Task`, process-manager state `TaskWorkflow`,
  projection state `TaskList`, and the exact commands/events used by handlers.
- Updated aggregate, process-manager, and projection ID generics and schemas to
  those modeled messages. Bare decorators, explicit generated domain-message
  returns, public package imports, and consumer-substitution boundaries remain
  intact.
- Updated only the completion plan's three assigned current-status statements
  to the T-0039c framework-user-guide pre-review-fix frontier.
- Focused validation passed for the final assigned scope. Full verification and
  specialist review remain coordinator-owned.

## Pre-Review Fix Handback

- Changed paths: `docs/USER_GUIDE.md`; the task, work, and review records for
  T-0039c; and only the three assigned current-status statements in
  `PROJECT_COMPLETION_PLAN.md`.
- Sections 2 and 3 now form one coherent typeable consumer example whose
  modeled messages, generated schemas/types, entity ID generics, handler
  inputs, and explicit generated returns agree.
- Exact focused command evidence, exclusions, and remaining uncertainty are
  recorded in the work log. No runtime, package, Proto source, generated
  output, example, canonical specification, or historical-plan packet changed.
- Skills used for this fix: doc-coauthoring for reader-facing vocabulary
  reconciliation and verification-before-completion for fresh handback
  evidence.
- Actual immutable profile: existing implementer, `gpt-5.6-terra` / medium; no
  subagents.

## Second Coordinator Pre-Review Finding

- At `2026-07-14T13:22:15Z`, the renewed journey audit found that the aggregate,
  process-manager, and projection examples emit or consume messages but never
  demonstrate updating their modeled entity state. A reader following the
  fragment could therefore persist only default state and would not learn the
  public protected draft-state API needed for the query/subscription journey.
- The same existing implementer is assigned this one guide correction with
  explicit immutable `gpt-5.6-terra` / medium dispatch and no subagents. Use
  the current modeled schemas and framework-owned transaction boundary; do not
  add manual transaction controls, default-route ID extraction, internal APIs,
  runtime changes, or new scope.

## Coordinator Pre-Review Closure

- The second fix demonstrates framework-owned state updates for the aggregate,
  process manager, and projection using their modeled schemas and `this.id`.
- Fresh coordinator checks passed: exact five-file Prettier, `docs:check` with
  expected export counts `100/28/205/19/17/3`, generated-output cleanliness,
  status equality, package/internal and prohibited end-user API scans,
  future-policy scan, exact changed-path scope, and `git diff --check`.
- The future-policy scan's only lexical match remains the public fixture method
  name `readEventually`; it is not policy prose. No duplicate implementation
  constant/helper applies to this documentation-only slice, and no public root
  or TypeDoc export changed.
- The completion plan's three live statements now use the durable T-0039c
  framework-user-guide review frontier. The candidate endpoint may now be
  committed and packaged for the four relevant specialist concerns.

## Review Wave 1 Assignment

- Implementation endpoint: `66a491e12972f942190cb1fd1ab83d4a89babf88`.
- Review package:
  `.superpowers/sdd/review-aaa31116..66a491e1.diff` (`125348` bytes, four
  commits from literal baseline `aaa31116`).
- Style/maintainability: existing specialist reviewer, explicit immutable
  `gpt-5.6-terra` / high, read-only, no subagents.
- Documentation completeness: existing specialist reviewer, explicit immutable
  `gpt-5.6-luna` / medium, read-only, no subagents.
- TypeScript/API docs: existing specialist reviewer, explicit immutable
  `gpt-5.6-terra` / high, read-only, no subagents.
- Performance/reliability: existing specialist reviewer, explicit immutable
  `gpt-5.6-terra` / high, read-only, no subagents.
- Every lane is bounded to its recorded concern, the task ledger, the package,
  and affected public journey. Historical superseded text is not a finding
  unless the current guide/plan/task records claim it as active.

## Review Wave 1 Result

- Complete wave collected and every reviewer closed. Style/maintainability and
  documentation completeness are clean. TypeScript/API docs accepted one P2;
  performance/reliability accepted three P2 findings.
- Required Protobuf modeling convention: split or clearly label state,
  `*_commands.proto`, and `*_events.proto` source units in the guide, including
  needed imports and repeated deterministic package/type URL declarations.
- Query contract: state that positive ordered limits are capped at `1000`.
- Subscription contract: state that inactive records default to a 30-second
  TTL and are consumed on activation; active streams/queued updates are
  process-local, default to a 100-update cap, and close/discard queued updates
  when a consumer exceeds that bound.
- Delivery contract: state that a failed supported callback may remain pending
  without an automatic retry scheduler or monitor, so durable handoff is not an
  autonomous eventual-delivery guarantee.
- Repository evidence confirmed every finding against `TECHNICAL_SPEC.md`,
  `PROTOBUF_CONTRACT.md`, `spine-services.ts`, package docs, and delivery docs.
  The same existing implementer receives this complete batch with explicit
  immutable `gpt-5.6-terra` / medium and no subagents.

## Review Wave 2 Assignment

- Wave 1 fixes are committed at literal endpoint
  `03d47b93e663c5cc15a2aedfbd336497de0160d5`.
- Review package:
  `.superpowers/sdd/review-aaa31116..03d47b93.diff` (`139142` bytes, seven
  commits from literal baseline `aaa31116`).
- All four concerns rerun because the fixes changed Proto section structure,
  reader completeness, TypeScript/Protobuf contract wording, and reliability
  guarantees. Style/API/reliability use their existing explicit immutable
  `gpt-5.6-terra` / high roles; documentation uses its existing explicit
  immutable `gpt-5.6-luna` / medium role. All are read-only/no-subagent.
- Historical superseded text remains non-actionable unless current T-0039c
  records, completion-plan live state, or changed guide prose claims it as
  active behavior.

## Second Pre-Review Fix Implementation

- Section 3 now demonstrates protected `updateDraftState()` use in the
  aggregate, process-manager, and projection handlers with their exact modeled
  generated schemas.
- State replacements use the framework-provided `this.id` identity and are
  deterministic for replay. The example adds no transaction lifecycle calls,
  target extraction, schema-bearing decorators, internal imports, or runtime
  controls.
- Focused verification passed for the final second-fix scope.

## Second Pre-Review Fix Handback

- Changed paths for this fix: `docs/USER_GUIDE.md` and the three T-0039c
  records only. The previously accepted completion-plan status diff was
  preserved without further edit.
- Aggregate, process-manager, and projection handlers now replace their exact
  modeled draft states through protected `updateDraftState()` calls and use
  the framework-provided routed identity.
- Exact command evidence, exclusions, and remaining uncertainty are recorded
  in the work log. Full verification and specialist review remain
  coordinator-owned.
- Skills used: doc-coauthoring and verification-before-completion. Actual
  immutable profile: existing implementer, `gpt-5.6-terra` / medium; no
  subagents.

## Review Wave 1 Fix Implementation

- Split the guide's modeled vocabulary into three internally coherent labeled
  source units: entity state `task_state.proto`, `task_commands.proto`, and
  `task_events.proto`, with deterministic package/type URL declarations and
  required imports in every file.
- Added the ordered query limit maximum, exact inactive/active subscription
  lifetime and queue behavior, and the non-autonomous failed-delivery wording
  from the accepted P2 batch.
- Focused verification passed for the complete accepted batch.

## Review Wave 1 Fix Handback

- Changed paths are `docs/USER_GUIDE.md` and the three T-0039c records only.
- All four confirmed P2 items are addressed: coherent state/command/event Proto
  files, ordered query limit cap, exact subscription lifecycle/queue bounds,
  and explicit non-autonomous failed-delivery behavior.
- Exact evidence and remaining uncertainty are recorded in the work log. Full
  verification and affected-lane rereview remain coordinator-owned.
- Skills used: doc-coauthoring and verification-before-completion. Actual
  immutable profile: existing implementer, `gpt-5.6-terra` / medium; no
  subagents.

## Review Wave 2 Result

- Complete wave collected and all reviewers closed. Style/maintainability and
  documentation completeness are clean. TypeScript/API docs accepted one P2;
  performance/reliability accepted two P2 findings.
- Subscription client call shape: say that `Cancel` accepts the returned
  `Subscription` message and show `await subscriptions.cancel(subscription)`;
  do not tell readers to pass only the opaque ID.
- Delivery scope: replace ambiguous “live projection subscriptions” with
  explicit projection `@Subscribe` handler delivery so it cannot be confused
  with process-local `SubscriptionService` streams.
- ZeroMQ scope: add the adapter's explicit lack of transport-owned retry loops
  and retry/restart guarantees, not only durable redelivery.
- Current tests and transport docs confirm every finding. The same existing
  implementer receives the complete batch with explicit immutable
  `gpt-5.6-terra` / medium and no subagents.

## Review Wave 2 Fix Implementation

- Corrected the subscription client contract so `Cancel` receives the returned
  `Subscription` message, and placed
  `await subscriptions.cancel(subscription)` in the client snippet's cleanup
  path.
- Named projection `@Subscribe` handler delivery as the durable server-side
  handoff and explicitly separated it from process-local client-facing
  `SubscriptionService` streams.
- Added the ZeroMQ adapter's absence of transport-owned retry loops and retry
  or restart guarantees without adding future-policy commitments.

## Review Wave 2 Fix Handback

- Changed paths are `docs/USER_GUIDE.md` and the three T-0039c records only;
  no plan, runtime, Proto source, package, or example file was changed.
- Focused call-shape, delivery-scope, and ZeroMQ limitation evidence confirms
  all three accepted P2 items. Exact command results and remaining uncertainty
  are recorded in the work log; full `pnpm verify` remains final-only.
- Skills used: receiving-code-review, doc-coauthoring, and
  verification-before-completion. Actual immutable profile: existing
  implementer, `gpt-5.6-terra` / medium; no subagents.

## Review Wave 3 Assignment

- Literal endpoint: `6caf1c8ebb624a6d996d82de5c2cb85db59a2799`.
- Package: `.superpowers/sdd/review-aaa31116..6caf1c8e.diff` (`151555` bytes,
  ten commits from literal baseline `aaa31116`).
- Rerun TypeScript/API docs and performance/reliability only, each through its
  existing explicit immutable `gpt-5.6-terra` / high read-only/no-subagent
  role. The Wave 2 style and documentation CLEAN dispositions remain valid:
  this fix did not reorganize the journey or add/remove reader coverage.
- API rechecks the `Cancel(Subscription)` call shape; reliability rechecks the
  server-handler/client-stream boundary and ZeroMQ retry/restart limits. Both
  prompts retain the ledger, current exclusions, and historical-text rule.
