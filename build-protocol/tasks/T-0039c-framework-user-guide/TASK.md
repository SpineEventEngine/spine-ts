# T-0039c: Framework User Guide Closure

Status: Second coordinator pre-review finding assigned

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
