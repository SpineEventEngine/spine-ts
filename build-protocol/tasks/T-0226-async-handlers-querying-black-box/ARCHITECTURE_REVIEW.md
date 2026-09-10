# T-0226 Architecture Review

Status: Accepted before production implementation.

Reviewer: Existing `requirements_splitter` role, explicitly dispatched with
configured `gpt-5.6-sol` and high reasoning. The role made no file changes and
did not spawn subagents.

## Accepted implementation boundaries

### Promise settlement

- Normalize exactly one outer built-in `Promise<T>` before every existing
  handler return check, including framework-envelope diagnostics.
- Resolve aliases to `Promise<T>`.
- Reject `PromiseLike`, arbitrary thenables, missing type arguments, and
  decorator-invalid inner types.
- Emit byte-equivalent registry metadata for `T` and `Promise<T>`.
- Treat delayed fulfillment, rollback on rejection, publication suppression,
  and serial execution as runtime regression obligations; invocation already
  awaits returned values.

### Shared query seam

- Preserve dependency direction `client-node -> core <- server -> storage`.
- Move the canonical descriptor-backed Entity columns, predicates, and wire
  query builder into a dedicated `@spine-event-engine/core` module.
- Retain `client-node` and `client-node/codegen` compatibility forwarders so
  existing application and generated imports remain valid.
- Extract the validated wire Query to `NormalizedQueryPlan` reader used by
  `SpineServices`; reuse it for Process Manager execution so validation, the
  1,000-result bound, lifecycle visibility, and Stand behavior cannot drift.
- Attach a minimal query-only capability to each freshly instantiated Process
  Manager through a private `WeakMap`. Do not expose BoundedContext, Stand,
  cross-tenant overrides, or `AsyncLocalStorage` state.
- Bind a cloned active `ActorContext` and resolved tenant before handler
  invocation. Reuse existing signal-metadata origin traversal for Events.
- `findById()` and `all()` execute through the same fluent query path as
  `byId`, `where`, `mask`, `orderBy`, `limit`, and `read`.
- Deleted current records are excluded. Archived current records remain visible
  and filterable under the existing query contract.

### BlackBox signal observation

- Observe only `SignalPublisher.publishCommand()` and `publishEvent()` at
  admission order, after successful producing-entity commit and before detached
  downstream completion.
- Setup inputs, received domain/external Events, rolled-back output, System
  Events, and stored-event redispatch bypass this observer.
- Provide package-internal observer registration with a close handle through
  `@spine-event-engine/server/testing`; observer failure never changes
  publication.
- Clone at capture and return newly cloned immutable snapshots.
- Keep capture attached while admitted server work drains, then detach it in
  guaranteed BlackBox cleanup.
- Post external BlackBox events through a narrow server testing/context intake
  seam that applies external semantics; do not expose EventBus internals.

## Accepted TDD sequence

1. Promise analyzer shapes, aliases, and invalid promise-like returns.
2. Runtime fulfillment, visibility, rejection, suppression, and ordering.
3. Shared core query contract with compatibility exports.
4. Characterize and extract one server query compiler/reader.
5. Process Manager query binding, complete DSL, lifecycle, actor, and concurrent
   tenant behavior.
6. Publisher observation and BlackBox snapshot/copy/lifecycle behavior.
7. External-event routing, metadata, domestic exclusion, and capture exclusion.
8. Public documentation, deterministic gates, review, corrections, and one
   release verification.

## Residual decision

For this task, "committed Event" means output admitted through
`SignalPublisher.publishEvent()` after the producing entity transaction commits.
Waiting for downstream EventBus completion would reorder output by completion
time and make input filtering ambiguous. EventStore persistence failures remain
normal downstream handling failures and do not retroactively change the
producer transaction or capture order.
