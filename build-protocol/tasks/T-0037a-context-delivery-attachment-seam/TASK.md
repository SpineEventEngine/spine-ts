# T-0037a: Context Delivery Attachment Seam

Status: Candidate; not started

Dependency: T-0036 complete; D-0086 accepted. First T-0037 implementation
child.

## Objective

Expose one small package-internal built-context descriptor/readiness seam that
later environment lifecycle code can consume without rediscovering context
internals or replacing the current local handoff owner prematurely.

## Human-Imposed Requirements Ledger

- Implement only this child in its future isolated branch/worktree with one
  author, TDD, focused checks, and all four required review lanes.
- Preserve D-0085 and D-0086; this child is context attachment only.
- Keep every new type and access path package-internal. Add no root export,
  public option, generated declaration, example, or public API documentation.
- Keep generated Protobuf output out of VCS and do not touch
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
and a readiness callback installed around the existing handoff path. Readiness
is emitted only after the supported inbox write has durably settled. The seam
must preserve tenant identity and sufficient configured obligation identity for
later attachment; it must not carry payloads, errors, timing, or policy.

The current immediate exact drain remains authoritative in this child. A later
child may switch lifecycle ownership only after a coordinator and environment
registration exist.

## Likely Files

- `packages/server/src/context/bounded-context.ts`
- `packages/server/src/context/tenant-index.ts`
- `packages/server/src/context/local-inbox-handoff.ts`
- `packages/server/src/context/process-manager-handoff.ts`
- `packages/server/src/context/projection-handoff.ts`
- `packages/server/src/repository/repository.ts`
- Focused context handoff and bounded-context tests
- This task's future durable task/work/review records and narrowly affected
  current architecture wording

## TDD Acceptance

- RED proves no package-internal descriptor currently returns the built
  context's actual storage factory, startup tenant scopes, endpoint/shard facts,
  and readiness attachment as one coherent seam; GREEN adds that seam.
- A builder-selected storage factory is reported exactly, not replaced by or
  copied from the environment default.
- Multitenant startup enumeration returns recorded tenants; single-tenant
  attachment produces exactly its non-tenant delivery scope.
- Supported handoffs notify readiness only after persistence fulfills, once per
  committed handoff scope; persistence rejection emits no readiness.
- Existing exact-row immediate drain, deduplication, tenant validation, and
  close behavior remain green.
- Package-root exports and generated API docs remain unchanged.

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
startup recovery, rollback, detach, generation, server lifecycle integration,
retry timing, public API, or T-0036 loop/worker change belongs here.
