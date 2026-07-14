# T-0039b: Package And API Documentation

Status: Author assigned

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
