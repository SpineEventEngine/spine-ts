# App Queries and read-side filtering

Status: extending the implementation with shared environment subscription capacity
and lifetime Message Board statistics using App Queries and read-side filters.

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

- No migrations or migration guidance are provided. Remove migration-specific
  paths and instructions; maintain only the current contract. This supersedes
  earlier proposal text requesting migration deliverables.
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
- Within each subscription, filter execution and result delivery are sequential.
  Filtering the next update must not begin before filtering the previous update
  finishes; parallel filtering followed by ordered delivery is not permitted.
  All Server-served and direct Stand subscriptions use the single
  ServerEnvironment.subscriptionQueueCapacity setting: 100 waiting updates by
  default, plus one update being processed. No Server, service, Bounded Context,
  or subscription override is permitted. A Stand needs no Server to obtain it.
  Zero permits active processing without waiting; invalid values are rejected.
  Subscriptions retain separate queues. This supersedes any earlier per-consumer
  configuration. Overflow terminates only
  that subscription with an explicit error; writes and other subscribers continue.
  Clear waiting updates and suppress late results when the subscription closes.
- Trusted principal/authority information must reach app-node execution through
  replaceable authentication/forwarding ports. Reject forged forwarded context.
  Public access can lack a principal; no provider-liveness promise.
- The Message Board App Query returns statistics since board creation, including
  total messages and distinct participating users. Maintain cumulative statistics;
  do not label a limited result set or the latest announcement as lifetime totals.
  Combine statistics from the separate supplying Bounded Contexts. Keep the
  message and announcement lists. Its browser page uses Entity
  updates and permitted MessagePosted notifications. Public readers see public
  content with author names hidden; authenticated readers see public authors;
  verified authority grants permit restricted content. Access filters belong to
  supplying Bounded Contexts; Server filters redact returned author information,
  including nested results and domain Event payloads. Real authentication ports
  supply the principal and authority facts; Actor IDs never grant access.
- Deliver two separate chat Markdown pieces: complete explanatory story and PR
  description, both rewritten from the implemented result. Explain concrete
  authenticated-principal configuration and receipt. Use “the framework” in
  prose and four-space PR code indentation. The PR description omits verification,
  test counts, coverage, audit results, and agent-review records. Do not publish
  the PR text to GitHub. No documentation-writing skills or popup questions.
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

App Query generation, discovery, registration, validation, trusted reader
forwarding, app-node execution and typed clients are implemented. Entity and App
Query results, retained histories, native Entity/Event subscriptions, and direct
Stand subscriptions now apply their installed read-side filters at the specified
boundaries. Direct Stand subscribers use the approved independent configurable
queue and sequential observer delivery, including removals and terminal errors.

Focused behavior, type, documentation and generated-output checks passed with
independent API, reliability, maintainability and documentation review. The
maintained multi-package example and installed/bundled consumer checks cover
metadata discovery and App Query usage. Actual container build/runtime checks
passed for the packaging work before the direct Stand changes. Workspace versions
are aligned at `2.0.0-snapshot.26`, with the required version-only commit separate
from dependency and lockfile updates.

Final integrated source security review is complete with no actionable findings.
The dependency audit correction and its compatibility and security reviews are
complete. The final shared-validator correction also passed focused API, reliability
and security review. Final acceptance requires the unchanged full release profile
and the branch commit’s Build and trial-publication checks to pass.
The standalone performance investigation found that the existing one-Event,
1,000-Process-Manager workload exceeded its one-second target even without a
subscriber. The queue change does not establish that throughput target.
