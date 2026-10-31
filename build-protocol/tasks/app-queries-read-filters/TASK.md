# App Queries and read-side filtering

Status: active implementation.

Branch: `app-queries-read-filters`. Baseline: official `origin/master`
`3135caaa202cdc2de71d249f2859cc4c4329b8c3`.

Approved contract: [full proposal](PROPOSAL.md). User authorized implementation
in a separate worktree and early pushes to origin. No pull request or merge
authorized. Risk: high; generated/public/serialized APIs, authentication,
read-side authorization, subscription lifecycle, and shared build changes.

## Human-Imposed Requirements Ledger

The full approved proposal is binding, including its examples, status matrix,
and acceptance section. This ledger indexes the requirements; it does not
replace or narrow that proposal.

- AppQueryHandler<Q, R> uses generated message types, with nested Query/Response
  declarations discovered by `_queries.proto`. No marker option, decorators,
  AppQueryDefinition, separate generation procedure, or query-only type registry.
- Generated/spine-metadata.ts replaces the handler-only file name. Existing
  generation emits Q/R aliases and metadata. Build-time dependency discovery
  composes local/transitive package metadata into one generated bootstrap.
  Support model-only packages, handler packages, BCs built in app from dependency
  classes, and one BC spanning packages. Passive discovery does not activate
  handlers. Browser exports cannot import server implementations.
- App Queries register only on Server, never ServerEnvironment or BC. Execute
  runs on app nodes after authentication. Q/R runtime metadata is class-keyed;
  duplicate Q implementations are rejected per Server only when registered.
- Deep input validation precedes handlers, reads, and subscription mutation.
  No Proto optional anywhere in authored definitions. Respect declared rules.
  Close every confirmed TS gap in the proposal's latest JVM comparison.
- Query invalid input becomes INVALID_ARGUMENT with structured Spine details;
  unexpected technical errors use sanitized INTERNAL, not empty success.
  Preserve Command Ack semantics and tenant/auth distinctions.
- Unknown/expired activation becomes NOT_FOUND with UNKNOWN_SUBSCRIPTION.
  Unknown cancellation remains OK. Duplicate active is not unknown. Preserve
  bounded managed-client resubscription, Entity recovery, and Event gap notices.
- ReadSideFilter targets a concrete schema/type URL and receives mutable detached
  Proto messages plus trusted operation/actor/principal context. Same-type
  replacements and null removal; no generic application type-switch, masking
  system, output state validation, or automatic field-redaction conventions.
- Filters install on Server gRPC outputs and/or BC builder/Stand read-side
  outputs. Each installation applies once at its boundary, in order. Include
  Entity/AppQuery responses, Entity/Event subscriptions, and BC histories.
- Nested matching is opt-in with parent inspection, deterministic parent-first
  traversal, correct Any/container removal, isolation, bounded work, and errors
  instead of unfiltered fallback.
- Entity removal uses existing no_longer_matching with original identity; no
  delivered-ID ledger or global client-cache mutation. Per-consumer Topics.
  Event null suppresses delivery, not persistence/replay or a past delivery.
- Trusted principal/authority information must reach app-node execution through
  replaceable authentication/forwarding ports. Reject forged forwarded context.
  Public access can lack a principal; no provider-liveness promise.
- Follow BUILD_PROTOCOL, CODE_QUALITY, TECHNICAL_SPEC, DEVELOPER_API, and accepted
  decisions except where this newly approved contract explicitly supersedes them.
  Use meaningful domain Proto fixtures, no optional authored Proto, generated
  output ignored, strict TS/TSDoc, existing review roles and explicit profiles.
- Never use codex/ branches. Only official origin. Push every commit promptly;
  no master writes, PR creation, remote rewriting, or deletion. One version-only
  commit before review readiness; dependency pins/lockfile separate.

## Acceptance and verification

Implement all proposal acceptance items. Focused behavior-first tests and cheap
preflight per slice; relevant specialist review before acceptance. Full
verify:release after convergence because shared runtime/build/serialized
contracts change. Required runtime coverage >=90%. Keep user guides, package
README/REFERENCE, API docs, generated fixtures/examples current. Complete
final security review and final-SHA CI where repository triggers permit.

## Execution

One architecture decomposition using existing requirements_splitter, followed
by one bounded production implementer at a time. Independent read-only checks
and concern-specific reviews may overlap. No grandchildren. Detailed sequence
is recorded in MILESTONES.md. Detailed execution and review records remain outside Git.

## Current work

Shared validation, read-side RPC status mapping, unknown-subscription activation,
metadata discovery, App Query declarations and generation, trusted reader
forwarding, subscription reader binding, and Server App Query execution are
implemented, including typed browser/Node clients and Execute forwarding through
gateways and Coordinators. Server accepts explicit App Query handlers and
supports direct app-node Execute and typed internal calls. The typed filter
engine is implemented with detached callback inputs, exact type matching, and
nested-message traversal. Bounded Context filters now apply to outward Entity
reads and retained Entity/Agent histories; Server filters apply to Entity Query
and App Query gRPC results. Native Entity and Event subscriptions now apply
Bounded Context and Server filters after original matching and queue admission.
Direct Stand subscription delivery and integrated release verification remain,
as listed in MILESTONES.md.

The App Query preflight passed generated/source compatibility checks, builds,
focused tests, documentation and independent review. Installed model and handler
packages were checked through generation, compilation and relocation. Trusted
reader forwarding and retained identity passed focused transport, lifecycle,
restart, and isolation checks and independent review. Server dispatch and scoped
internal calls passed focused validation, isolation, cancellation, shutdown, and
review checks. Typed clients passed installed browser/Node consumer checks;
Execute passed browser, native, Coordinator, and real managed-child checks,
including trusted reader forwarding and invalid input. Full release coverage
and final security review remain due after implementation.

The filter engine passed focused root/nested traversal, container removal, byte
isolation, deep traversal, and readonly-context checks. Independent review
confirmed the corrections for shared bytes and unnecessary parent-tree copies.

Read-boundary integration passed focused boundary, history, cancellation, actor
context, sanitized-status and data-isolation checks, followed by independent
API, reliability, style and documentation review. The remaining direct
subscription admission decision is recorded in MILESTONES.md.

Native subscription filtering passed focused Entity/Event, reader isolation,
activation-race, cancellation, transport and client recovery checks. Independent
API, reliability, style and documentation review is complete, including a
regression preventing delivery after cancellation between policy settlement
and output. Direct Stand filtering remains pending the admission decision.

The maintained multi-package Message Board example and current migration guides
now cover generated handler metadata, App Query Q/R calls, Bounded Context and
Server read policies, trusted-reader facts, and native Entity/Event delivery.
Focused example, installed-consumer, bundled-discovery, generation, source
quality, and documentation checks passed independent API, reliability, style,
and documentation review. Direct Stand filtering still awaits its admission
decision. Integrated security review, image rebuild, version alignment, and
the full release verification remain pending.
