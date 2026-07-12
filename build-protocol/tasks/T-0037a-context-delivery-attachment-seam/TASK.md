# T-0037a: Context Delivery Attachment Seam

Status: Round 2 fixes active; RED pending

Started: `2026-07-12T09:52:53Z`

Baseline commit: `f7c2ddb1`

Branch: `task/T-0037a-context-delivery-attachment-seam`

This `Status` header is canonical for T-0037a. Its work/review logs are
derived mirrors and must match it before review.

Dependency: T-0036 complete; D-0086 accepted. First T-0037 implementation
child.

## Objective

Expose one small package-internal built-context descriptor/readiness seam that
later environment lifecycle code can consume without rediscovering context
internals or replacing the current local handoff owner prematurely.

## Human-Imposed Requirements Ledger

- Continue autonomously until this child is complete or a real blocker occurs;
  keep the implementation/review package small and limited to this child.
- Implement only this child in its own branch/worktree with one author
  using TDD.
- Do not assign duplicate authors or reviewers for the same role, and close
  every participating author/reviewer agent after its role completes.
- Every implementation and review role must perform and durably record the
  canonical skill-applicability check from `BUILD_PROTOCOL.md` before its work.
- Apply the Human Review Reset: prefer the smallest JVM-familiar concepts,
  replace or delete wrong abstractions instead of preserving them, and invent
  no abstraction without corresponding Spine JVM evidence. Treat
  `bounded-context.ts` as the specific caution: redundant error-detail
  hierarchies and invented snapshot/registration-conflict concepts are defects
  unless Spine JVM proves they belong.
- Before server-module implementation, inspect and record the relevant Spine
  JVM `core-jvm/server` notes and source as required by `BUILD_PROTOCOL.md`.
- Run lightweight docs/status lint before review.
- Run all four independent review lanes until clean; defer security review to
  final project readiness.
- Use focused inner-loop tests/checks; run full `pnpm verify` only at final child
  acceptance and again after merge.
- Treat superseded history as non-actionable unless an active record claims it.
- Preserve D-0085 and D-0086; this child is context attachment only.
- Keep every new type and access path package-internal. Commit no generated
  artifacts and make no root/public export or API change; emitted internal
  declarations may change. Add no public option, example, or public API docs.
- Keep generated Protobuf output out of VCS and do not touch the user-owned
  `human-review-1-jul.md`.

## Current Facts

- Built contexts retain the `StorageFactory` actually selected at build time
  behind `boundedContextAccess.storageFactory(context)`; it may differ from the
  environment default because a builder can select its own factory.
- `TenantIndex.all()` can enumerate recorded multitenant tenants, while a
  single-tenant index returns the single-tenant sentinel shape. No server
  startup path currently enumerates tenant delivery work.
- Process-manager command/event and projection-event handoffs construct a
  short-lived tenant-specific `Delivery`, persist through the local inbox, and
  immediately exact-drain that received row.
- T-0036 remains explicitly invoked and unchanged.

## Exact Ownership

This child alone owns the package-internal descriptor for a built context's
actual delivery storage, tenant enumeration, supported endpoint/shard facts,
and a synchronous non-throwing readiness callback installed around the existing
handoff path. Readiness
is emitted after every successful individual supported-row persistence,
including each earlier success when a later `receiveAll`/batch row rejects. A
rejected or unattempted write emits none. The seam must preserve tenant identity
and sufficient configured obligation identity for later attachment; it must not
carry payloads, errors, timing, or policy.

Notification failure is not part of the seam: implementations must isolate any
observer machinery behind the callback and make the callback return normally.
It cannot reject `receive()` after persistence, stop later `receiveAll()` writes,
or alter exact-drain error compatibility. Internal observation failure, if any,
must be handled by its owner without entering this callback payload or return
channel.

The current immediate exact drain remains authoritative in this child. T-0037d
alone may switch lifecycle ownership after a coordinator and environment
registration exist; this seam must support that later atomic no-overlap switch.

## Likely Files

- `packages/server/src/context/bounded-context.ts`
- `packages/server/src/context/tenant-index.ts`
- `packages/server/src/context/local-inbox-handoff.ts`
- `packages/server/src/context/process-manager-handoff.ts`
- `packages/server/src/context/projection-handoff.ts`
- `packages/server/src/repository/repository.ts`
- Focused context handoff and bounded-context tests
- This task's durable task/work/review records and narrowly affected
  current architecture wording

## TDD Acceptance

- RED proves no package-internal descriptor currently returns the built
  context's actual storage factory, startup tenant scopes, endpoint/shard facts,
  and readiness attachment as one coherent seam; GREEN adds that seam.
- A builder-selected storage factory is reported exactly, not replaced by or
  copied from the environment default.
- Multitenant startup enumeration returns recorded tenants; single-tenant
  attachment produces exactly its non-tenant delivery scope.
- A successful single-row `receive` emits exactly one readiness notification
  after its persistence fulfills and before exact-drain work can settle.
- A rejected single-row persistence emits no readiness, and a later drain
  rejection cannot retract readiness for the row already persisted.
- A successful `receiveAll` emits once for every individually persisted row,
  even when multiple rows map to the same configured scope; call, configured-
  scope, and batch grouping never reduce the per-row emission count.
- When row N in `receiveAll` rejects, every earlier successfully persisted row
  has already emitted readiness exactly once, while row N and later unattempted
  rows emit none.
- When all batch writes persist but a later exact drain rejects, every persisted
  row has still emitted readiness exactly once.
- The callback is synchronous and non-throwing. Observer implementation failure
  cannot reject a durable single-row receive, interrupt later batch writes, or
  replace an exact-drain error; focused tests pin those compatibility outcomes.
- Existing exact-row immediate drain, deduplication, tenant validation, and
  close behavior remain green.
- Package-root exports and public API docs remain unchanged; emitted internal
  declarations may change and no generated artifact is committed.

## D-0085 Invariants

- Readiness means only durable supported work exists; it carries no timer,
  backoff, action, payload, or retry policy.
- No automatic worker start or second owner is introduced.
- Preserve pending/skipped `CATCH_UP`, fail-closed legacy `IMPORT_EVENT`, and
  T-0034/T-0036 behavior.
- JVM evidence is limited to environment ownership and post-persist readiness;
  do not copy singleton state, threads, repeat callbacks, public monitors,
  catch-up stations, or global storage copying.

## Explicit Exclusions

No worker coordinator, coalescing, parked record, environment registration,
direct-drain disablement, startup recovery, rollback, detach, generation,
server lifecycle integration, retry timing, public API, or T-0036 loop/worker
change belongs here.
