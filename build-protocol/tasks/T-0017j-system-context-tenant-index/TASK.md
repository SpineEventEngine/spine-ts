# T-0017j: System Context And Tenant Index

Status: in progress
Started: `2026-07-09`
Branch: `task/T-0017j-system-context-tenant-index`
Worktree:
`.worktrees/T-0017j-system-context-tenant-index`
Base commit: `11aef98`

## Objective

Add the first internal system-context pairing and tenant-index behavior needed
by production bounded contexts, while keeping the public TypeScript API small
and JVM-familiar.

## Scope

- Add internal system-context metadata/pairing for built domain contexts.
- Add tenant-index behavior for single-tenant and multitenant contexts.
- Keep tenant index selection explicit and framework-owned.
- Preserve existing service/bus/read-side tenant validation.
- Update docs/API docs and durable logs.

## Out Of Scope

- Full JVM command log repositories.
- Full system event taxonomy, tracing, monitors, or debug UI.
- Public exposure of raw system contexts.
- ServerEnvironment ownership, production storage selection, or transport
  worker supervision.
- ImportBus implementation unless a tiny tenant-index hook is needed and tested.
- Broad cross-context integration broker behavior.

## Human-Imposed Requirements Ledger

- Continue autonomously until all tasks are done or a real blocker appears.
- Keep `human-review-1-jul.md` untouched.
- Use this branch/worktree for this task.
- Spawn one implementation sub-agent for the task.
- Run independent reviewer sub-agents for code style/maintainability,
  documentation, TypeScript/API docs, security, and performance/reliability.
- Feed reviewer comments back to an authoring/fix sub-agent and repeat until
  all lanes are clean.
- Close every participating sub-agent once its role is complete.
- No change may be made without updating the relevant durable log.
- Server-module implementation requires close inspection of local Spine JVM
  docs and corresponding `core-jvm/server` sources when available before design
  or code changes.
- Prefer simpler JVM-familiar behavior over new abstractions.
- Do not over-engineer the `server` module; start from corresponding Spine JVM
  concepts and keep this slice deliberately smaller than full JVM machinery.
- Keep strict read-side/write-side segregation.
- End-user code must not use framework `Event` envelopes, manual
  transactions, schema-bearing decorators, `@Apply`, default-route target-ID
  extraction, or application-owned handler materialization.
- Native execution is explicitly allowed for `corepack`, `pnpm install`,
  `pnpm --config.verify-deps-before-run=false verify`, and local IPC/loopback
  listener tests.

## JVM Research Inputs

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, especially
  multitenancy, tenant index, system context, and environment/storage wiring.
- `spine-jvm-docs/spine-validation-storage-observability-and-support.md`,
  especially system-aware storage and system diagnostics implications.
- Relevant `core-jvm/server` sources when available locally or via source
  lookup: `SystemContext`, `SystemClient`, `SystemSettings`, `TenantIndex`,
  `DefaultTenantStorage`, `BoundedContextBuilder`, and
  `SystemAwareStorageFactory`.

## JVM Observations To Preserve

- Single-tenant contexts use a constant single-tenant tenant index.
- Multitenant contexts default to a storage-backed tenant index using the
  configured storage factory.
- Domain contexts have an internal paired system context derived from the
  domain context spec/name and tenant mode.
- Framework users should not work with raw system contexts directly.
- A system-aware storage policy prevents no-event system contexts from
  accidentally allocating/writing event streams.

## Acceptance Criteria

- Built bounded contexts expose internal system pairing metadata to framework
  code without exposing raw system contexts as public application API.
- Single-tenant contexts have a tenant index that reports the single-tenant
  boundary and rejects multitenant tenant recording.
- Multitenant contexts have a tenant index that can record and list tenant IDs
  through existing storage contracts.
- Service/bus/read-side tenant validation remains unchanged and covered by
  regression tests where touched.
- Public docs describe what exists now and what remains deferred: command logs,
  system events, tracing, and production `ServerEnvironment` remain later work.

## Verification Plan

- Focused bounded-context/system-pairing tests.
- Focused tenant-index storage tests.
- Existing tenant validation regression tests touched by the change.
- `pnpm --config.verify-deps-before-run=false typecheck:build`
- `pnpm --config.verify-deps-before-run=false format:check`
- `pnpm --config.verify-deps-before-run=false docs:check`
- `git diff --check`
