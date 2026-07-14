# T-0039b: Package And API Documentation

Status: Review round 1 findings accepted — fixes assigned

Started: `2026-07-14T11:46:19Z`

Baseline commit: `0868ecca`

Branch: `task/T-0039b-package-api-docs`

Worktree: `.worktrees/T-0039b-package-api-docs`

Dependency: T-0039a complete, merged, post-merge verified, and pushed.

## Objective

Reconcile the root README, all six package READMEs, public TSDoc, the API
overview, and generated TypeDoc with the final supported public framework
surface and accepted initial-release exclusions.

## Human-Imposed Requirements Ledger

- Continue autonomously until project completion or a real protocol blocker.
- Keep this slice limited to package/API documentation; T-0039c owns the
  framework user-guide journey and T-0040 owns example closure.
- Preserve accepted DDD, Protobuf/type-URL, public API, generated-output,
  end-user API, review, logging, worktree, verification, and push requirements.
- Do not add, remove, or rename public exports or change runtime behavior merely
  to simplify documentation.
- Public docs must describe current observable behavior and explicit release
  exclusions without promising future retry, monitor, supervision, topology,
  health, catch-up, or legacy import policy.
- Public examples use package imports only and keep end-user code free of
  framework envelopes, manual transactions, `@Apply`, schema-bearing
  decorators, and handler materialization.
- Use focused checks in inner loops and reserve full `pnpm verify` for final
  task and post-merge gates.
- Run only existing relevant review concerns; no per-task security review.
- Explicitly dispatch child model/reasoning and prohibit child subagents.
- Push the completed task branch and updated `main` to `origin`.
- Never read, edit, stage, delete, or use `human-review-1-jul.md`.

## Acceptance Criteria

- Root and `packages/{core,proto,server,storage,transport,testing}/README.md`
  accurately state package purpose, supported entry points, current behavior,
  and limitations.
- `docs/api/README.md` and public TSDoc agree with actual root/subpath exports,
  declarations, runtime behavior, ownership, and compatibility constraints.
- Generated TypeDoc contains every expected export and no internal coordinator,
  obligation, registration, generation, cursor, raw lifecycle access, ZeroMQ
  endpoint, or storage implementation detail leaks as public policy.
- Lifecycle documentation states only observable `Server`, `RunningServer`, and
  `ServerEnvironment` behavior, including startup recovery, listener ordering,
  shared/owned environment semantics, retry-safe close, and explicit exclusions.
- Legacy compatibility symbols retain narrow accepted wording; docs do not
  recommend new `@Apply`, import, raw callback-delivery, or manual-transaction use.
- Links, commands, package imports, code snippets, formatting, API export checks,
  generated cleanliness, and all relevant review concerns are clean.

## Scope

- Required surfaces: root README; six package READMEs; `docs/api/README.md`;
  public TSDoc necessary to make generated TypeDoc accurate.
- Tests/scripts may change only when a focused documentation/API assertion is
  necessary to prevent a concrete regression.
- Exclude `docs/USER_GUIDE.md`, example documentation/application behavior,
  runtime implementation, Protobuf contracts, generated output, dependency
  changes, and broad historical-log rewrites.

## Risk Assumptions

- The server README and API overview are large historical accumulations; edit
  concrete stale active claims instead of rewriting them wholesale.
- `docs:check` proves export coverage but not every prose claim, so compare
  lifecycle/transport/delivery statements with canonical T-0039a docs and actual
  public exports.
- Internal types may appear in explanatory implementation history. They must not
  be presented as stable application API or code examples.

## Planning Disposition

- No requirements splitter: this task changes no architecture, domain model,
  public/serialized contract, transaction, concurrency, or idempotency rule.
  `PROJECT_COMPLETION_PLAN.md` already defines the exact documentation packet.
- One Terra Medium author owns the bounded docs/TSDoc reconciliation. Review and
  verification remain coordinator-owned.

## Canonical Skill Applicability

- Read and apply `verification-before-completion`; use receiving-review after a
  finding batch. The coordinator owns worktree and requesting-review workflows.
- `doc-coauthoring` is N/A because its interactive drafting loop conflicts with
  autonomous factual reconciliation. TypeScript/API-design skills are relevant
  only when public TSDoc or declaration meaning must be checked; no API design is
  authorized.
- TDD/runtime/debugging/security/web/artifact skills are N/A unless a concrete
  focused docs assertion exposes a real code defect, which must be routed rather
  than absorbed into this task.

## Bounded Inventory

- Required surfaces total about 2,374 lines; server README and API overview are
  the large accumulations, so preserve accurate detail and make bounded edits.
- Concrete stale active formulations include `does not yet`, `future transport`,
  `later scheduler/retry stack`, `remains future work`, and production
  supervision/catch-up promises in package/API docs.
- Root and package docs already state many accepted exclusions. Reconcile
  contradictions without replacing current behavior with marketing prose.
- Existing API checker expects `100/28/205/19/17/3` exports for proto, core,
  server, storage, transport, and testing.

## Author Assignment

- Existing role: implementer.
- Explicit immutable profile: `gpt-5.6-terra` / medium.
- Scope: required README/API/TSDoc surfaces plus these three durable records;
  focused docs/API test assertion only when necessary.
- Read-only exclusions: runtime behavior, public export set, Protobuf, generated
  artifacts, user guide, example, dependencies, and unrelated historical logs.
- No subagents. No commit, merge, push, or other Git mutation; coordinator owns
  Git and independent review.
- Required handback: changed paths, each reconciled claim and implementation/
  export evidence, focused commands/results, skipped candidates/reasons,
  uncertainty, skill applicability, and actual immutable runtime profile.

## Author Handback

- Changed paths: `README.md`, `packages/core/README.md`,
  `packages/proto/README.md`, `packages/server/README.md`,
  `packages/storage/README.md`, `packages/transport/README.md`,
  `packages/testing/README.md`, `docs/api/README.md`, and the three T-0039b
  records.
- Reconciled claims: root/package ownership follows each package manifest and
  root export surface; lifecycle prose retains only observable `Server`,
  `RunningServer`, and `ServerEnvironment` startup/close/ownership behavior;
  ZeroMQ remains adapter-scoped, trusted same-host IPC with no exactly-once,
  durable-redelivery, retry, restart, or remote-delivery guarantee; release
  exclusions make no future-policy commitment; legacy `IMPORT_EVENT`, `@Apply`,
  and transaction wording is compatibility/framework-only and does not direct
  applications to use it.
- Evidence: `pnpm docs:check` reported the expected TypeDoc export counts
  `100/28/205/19/17/3`; focused package metadata/root-export tests passed
  `7` files / `71` tests; `pnpm typecheck:build` and
  `pnpm typecheck:generated` passed after producing this worktree's required
  local build outputs; exact-path Prettier, phrase/import/end-user scans, and
  Markdown-target scan passed.
- No public TSDoc or focused assertion changed: existing declarations already
  describe the generated TypeDoc surface, and no documentation-only regression
  needed a durable test.
- Skipped: full `pnpm verify` (reserved by the task for final/post-merge gates),
  runtime tests (no runtime change), TDD/debugging/security/web/artifact skills
  (no concrete defect or matching scope), and `doc-coauthoring`'s interactive
  loop (incompatible with this autonomous factual reconciliation).
- Uncertainty: no public snippet compiler covers the documentation-only
  `@example/tasks-proto` illustrative package imports; the required scan proves
  they are package imports rather than private relative paths. Coordinator
  review remains required.
- Actual immutable profile: existing implementer, `gpt-5.6-terra` / medium;
  no subagents.

## Coordinator Pre-Review Round 1

The focused local docs/status lint accepted the changed-path scope, equal
durable statuses, diff whitespace, release-exclusion wording, and absence of
private source/generated imports. It found this complete bounded fix batch:

1. The `packAny()` example builds an empty `Command` and therefore throws
   `ValidationException` with three violations before packing. Use a valid
   public `@spine-ts/proto` message so the shown default validation path runs.
2. The API overview's `RunningServer.close()` paragraph omits context transport
   drain and environment-delivery detach/quiescence, and its statement that
   cleanup continues after every close failure contradicts the public hard gate
   for network/context-intake failures. Reconcile it with the final observable
   lifecycle in `DEVELOPER_API.md` and `RunningServer` TSDoc.
3. `@example/tasks-proto` is intentionally an illustrative consumer-generated
   package but no such workspace package exists. State that substitution once
   before its first use so snippets do not imply a shipped dependency, while
   retaining package-only imports and leaving T-0040 example ownership intact.

Fix assignment returns to the existing implementer context with its immutable
`gpt-5.6-terra` / medium profile. Scope remains these docs and durable records;
no source, exports, generated output, dependencies, user guide, or example app
may change. No subagents; coordinator retains Git and independent review.

## Implementation Fix Handback Round 1

- Replaced the invalid empty-`Command` `packAny()` example with a package-only
  `FieldPathSchema` round trip using `fieldName: ["task", "title"]`; the built
  public packages return `type.spine.io/spine.base.FieldPath` and
  `task.title` under default validation.
- Reconciled the API overview with the public `RunningServer` lifecycle:
  listener/sessions, context transport intake and accepted-work drain,
  delivery detach/quiescence, contexts/resources, and the owned environment,
  including the network/context-intake hard gate and unfinished-phase retry.
- Identified `@example/tasks-proto` before its first use as a stand-in for the
  consumer's generated Protobuf package. No example, dependency, source,
  export, generated, or user-guide path changed.
- Focused verification evidence is recorded in the work and review logs.
  The built-package probe printed
  `type.spine.io/spine.base.FieldPath task.title`, and `pnpm docs:check`
  reported export counts `100/28/205/19/17/3`.
  Actual immutable profile: existing implementer, `gpt-5.6-terra` / medium;
  no subagents.

## Coordinator Verification Round 1

- Independently reproduced the built-package default-validation round trip:
  `type.spine.io/spine.base.FieldPath task.title`.
- `pnpm --config.verify-deps-before-run=false docs:check` passed with TypeDoc
  export counts `100/28/205/19/17/3`.
- Focused root-export/package API tests passed `6` files / `69` tests.
- Exact-path Prettier, equal-status, generated/private-import, changed-scope,
  unresolved-conflict, and diff-whitespace checks passed.
- The future-policy scan found only contextual current-state phrases: a
  caller-owned environment “remains open” after server close, and failed-start
  cleanup that “cannot yet complete.” Neither promises future policy.
- The complete pre-review batch is accepted. Full `pnpm verify` remains the
  final task gate after independent review closure.

## Independent Review Round 1 Assignment

- Immutable review range: `0868ecca..fcef6d35`.
- Style/maintainability: existing reviewer, explicit
  `gpt-5.6-terra` / high; assess bounded organization, duplication, clarity,
  and maintainable current-state wording only.
- Documentation completeness: existing reviewer, explicit
  `gpt-5.6-luna` / medium; assess factual completeness, links, commands,
  examples, exclusions, and active-vs-historical truth only.
- TypeScript/API docs: existing reviewer, explicit
  `gpt-5.6-terra` / high; assess public imports/exports, declarations, TSDoc,
  compatibility wording, examples, and internal leakage only.
- Performance/reliability: existing reviewer, explicit
  `gpt-5.6-terra` / high; assess lifecycle, delivery, transport, storage,
  ownership, bounded-resource, retry, and failure claims only.
- All reviewers are read-only, may not spawn subagents, and must ignore
  historical superseded text unless current task records or changed public docs
  claim it as active state. Security remains deferred to T-0041.

## Independent Review Round 1 Results

- Documentation completeness: clean.
- TypeScript/API docs: clean.
- Performance/reliability: clean.
- Style/maintainability: two accepted findings:
  1. `README.md` incorrectly excludes semantic-tag consumption in runtime
     routing even though D-0069 and current runtime routing consume command
     assignee and event receiver tags. Remove or narrow that false exclusion.
  2. `packages/server/README.md` repeats the same production supervision,
     topology, adapter, catch-up, and retry exclusions in adjacent sentences.
     Consolidate them while retaining backoff/scheduler ownership and the
     no-future-policy qualifier.
- Each dispatch explicitly supplied its assigned model/reasoning. The Desktop
  multi-agent runtime metadata declares the immutable role profiles used:
  documentation `gpt-5.6-luna` / medium and the other three reviewers
  `gpt-5.6-terra` / high. Child-local model introspection is not required
  because the orchestrator-facing role configuration is the runtime metadata
  and matched every explicit spawn field.
- The complete accepted batch returns to the existing implementer, immutable
  `gpt-5.6-terra` / medium, docs/records only, no subagents.
