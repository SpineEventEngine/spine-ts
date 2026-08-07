# T-0129: Wave 8 Storage Correction Plan

Status: Complete

## Objective

Records the approved Wave 8 correction of the generic storage model, MySQL and
Datastore physical layouts, persisted framework records, Delivery monitoring,
and validation dependency. Produces a dependency-ordered implementation plan
that removes unsupported inventions and keeps all affected documentation and
examples accurate.

## Classification

High-risk. Wave 8 changes public and serialized contracts, storage layout,
transaction and failure semantics, delivery lifecycle policy, generated Proto
types, multiple provider adapters, and repository-wide documentation.

## Baseline And Isolation

- Baseline: `origin/main@56805f23`.
- Branch: `task/T-0129-wave8-storage-correction`.
- Worktree: `.worktrees/T-0129-wave8-storage-correction`.
- The stale, dirty primary checkout remains coordination-only and untouched.
- The recent verified Wave 7 closure on `origin/main` is the baseline evidence;
  no duplicate full baseline gate will run before planning.

## Human-Imposed Requirements Ledger

1. Replace the shared-table/shared-kind storage design with Spine JVM-style
   record specifications. Every Entity current-state type has its own physical
   table or Datastore kind and stores `spine.server.entity.EntityRecord`.
2. State history and event history use their own grouped record storage when
   enabled. Events, Inbox messages, subscriptions, node discovery, and every
   other non-Entity record use their own Proto record specification and
   physical storage.
3. Default physical names follow the current Spine JVM JDBC and Datastore
   libraries. Framework users can customize layout for every framework-owned
   record family.
4. `SpecScanner` accepts only the Entity class and derives its ID, state schema,
   and `(column)` metadata. Materializing several columns unpacks state once.
5. `(column)` values are stored as provider-native columns/properties and used
   for provider-side query pushdown. The framework does not create indexes for
   user-declared columns automatically.
6. MySQL startup validates the live table structure and fails with diagnostics
   for missing or incompatible required columns and primary keys. It does not
   alter existing tables. Harmless extra indexes and compatible nullable or
   defaulted columns do not fail validation.
7. Framework users can replace table-creation operations, including selecting
   MySQL or MariaDB engines and options. Verify InnoDB, MyISAM, and MariaDB
   Aria behavior without claiming cross-table atomicity from nontransactional
   engines.
8. Datastore exposes JVM-familiar record organization and custom
   record/entity-storage hooks. There is no migration or compatibility layer
   for the incorrect pre-Wave-8 layout because no deployed applications exist.
9. Remove compatibility fingerprints, stored spec metadata, commit receipts,
   JSON packed into `Any`, delivery attempts, attempt exhaustion, quarantine,
   invented coordination records, `packages/delivery-client`'s
   `RemovalQuarantine`, and the Message Board quarantine and revoked-session
   facilities. Do not replace removed inventions with new ones.
10. Persist only approved Proto messages. Inbox persistence uses the existing
    `spine.server.delivery.InboxMessage`; delivered rows provide deduplication.
    Shard ownership, not per-message claims, provides delivery exclusion.
11. Move application-node discovery Proto to
    `spine/deployment/node_discovery.proto`, package `spine.deployment`. Use
    `spine.server.NodeId`, add `NodeRegistrationId`, remove encoding metadata,
    and use no primitive ID fields.
12. No authored Proto file may use `optional`. This is a permanent,
    deterministic repository rule.
13. Rename the Stand record to `spine.client.SubscriptionRecord` in
    `spine/client/subscription_record.proto`. Its first field is the explicit
    subscription ID, followed by the subscription, status, `when_created`, and
    approved activation-expiry time. Remove revision and generation. Rename
    the enum to `SubscriptionStatus`, its field to `status`, and its zero value
    to `SS_UNSPECIFIED`.
14. Replace the Gateway binding record with
    `spine.auth.GatewayAuthenticatedSubscription` in
    `spine/auth/authenticated_subscription.proto`. Its first field is the
    subscription ID and it stores the subscription and `when_expires`.
15. In every non-frozen Proto, adjacent declarations and their documentation
    are separated by a blank source line. A multi-paragraph comment ends with a
    blank `//` line before the declaration. Enforce these rules mechanically.
16. Implement the JVM-style controlling `DeliveryMonitor`, `FailedReception`,
    and actions to mark delivered or repeat dispatching. The default reception
    failure marks the message delivered. Monitor/action failures are contained;
    delivery continues where safely possible and never dies as a process-level
    reaction to one failed signal.
17. If durable marking fails, leave the message pending, stop later messages
    for the same target, continue independent targets, release the shard, and
    ensure later delivery can retry. Do not silently claim success.
18. Upgrade to the latest compatible `@spine-event-engine/validation` release
    available for this work.
19. Update all affected examples, package READMEs and REFERENCES, framework and
    example guides, architecture/provider/deployment/delivery documentation,
    TSDoc, Proto comments, diagrams, and build-protocol records. Do not leave
    stale descriptions of the removed physical layout or retry policy.
20. Before Wave 9, audit every persisted record, serialization, public API,
    hidden limit, retry/quota/cleanup mechanism, delivery/subscription/auth/
    deployment/provider layout, example, and documentation claim. Classify it
    as approved, a JVM counterpart, an approved TS-specific necessity, removed,
    or requiring a future human decision. Wave 9 cannot start with an
    unresolved invention.
21. Wave 9 contains operational logging, the Google Cloud Logging adapter, and
    repository-wide copyright-header correction. Questions are deferred to its
    Q&A. Multiple Gateway replicas move to Wave 10. Cloud Run remains outside
    the initial offering.
22. Never build Spine JVM during this work. Source inspection only.
23. Do not publish packages to npm or push to the future migration remote.
    Push every feature-branch commit to `origin` immediately.
24. Preserve all user-owned files and unrelated dirty work, especially
    `human-review-1-jul.md` and `human-review-22-jul.md`.

## Skill Applicability

- Inventory sources checked: the session skill catalog, the complete
  `~/.agents/skills` entrypoint listing, `build-protocol/skills/EXPECTED_SKILLS.md`,
  and `~/.agents/.skill-lock.json`.
- Selected and fully read: `executing-plans`,
  `subagent-driven-development`, `using-git-worktrees`,
  `test-driven-development`, `architecture-patterns`, and
  `event-store-design`.
- Repository protocol overrides the generic subagent skill where it asks for a
  `.superpowers` scratch ledger or generic per-task reviewers. Durable project
  task/work/review logs and the four existing specialist concerns are used
  instead; the removed `.superpowers` directory will not be recreated.
- `requesting-code-review` and `verification-before-completion` apply later at
  review and closure and will be read before those governed actions.
- `architecture-decision-records`, `cqrs-implementation`,
  `projection-patterns`, and `typescript-advanced-types` were triaged but not
  selected: current project decision/task formats govern the record, and the
  approved storage correction does not need generic alternative designs or
  advanced type-system invention.
- No library search is needed for the planning slice. Implementation must reuse
  the existing Protobuf, MySQL, Datastore, and validation dependencies unless a
  recorded dependency upgrade is explicitly in scope.

## Requirements-Splitter Assignment

- Existing role: requirements splitter acting as a senior Spine storage and
  delivery architect.
- Scope: turn the frozen ledger into small, dependency-ordered, review-sized
  tasks with exclusive file ownership, RED-first behavior tests, documentation
  obligations, review relevance, verification profiles, and explicit removal
  boundaries. Reuse the already inspected latest Spine JVM `core-jvm`, JDBC,
  and Google Cloud concepts; do not invent migration or compatibility layers.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Dispatch requirement: both fields must be explicit.
- Subagents may not spawn subagents or edit files.

## Requirements-Splitter Result

- Existing role performed: requirements splitter.
- Configured runtime profile: `gpt-5.6-sol` with `high` reasoning, explicitly
  supplied in the dispatch fields.
- Actual runtime metadata: the child surface exposes the configured role but no
  independent model/reasoning self-introspection. The immutable role profile
  and explicit dispatch fields are the available evidence; no visible fallback
  or mismatch occurred.
- Result: no blocking contradiction. The proposed dependency sequence covers
  Proto policy, validation, generic storage, current Entity records, histories
  and Event Store, MySQL, Datastore, discovery, Stand, authenticated Gateway
  subscriptions, Inbox/shard delivery, `DeliveryMonitor`, examples,
  documentation, and the final invention audit.
- Orchestrator acceptance: accepted with one sequencing normalization in
  `WAVE_8_STORAGE_CORRECTION_PLAN.md`. The validation upgrade is independent of
  the Proto freeze and moves near final consumer convergence, allowing the
  runtime critical path to continue if snapshot `.7` has not yet reached the
  npm registry. No vendoring or unapproved Git dependency is inferred.

## Current Dependency Split

The canonical, reviewable split is
`build-protocol/planning/WAVE_8_STORAGE_CORRECTION_PLAN.md`, covering T-0130
through T-0144. It serializes overlapping storage and delivery ownership and
defers broad example/documentation work until runtime contracts stabilize.

## Review Dispositions

- Style/maintainability: accepted after two waves. Its final P2 naming omitted
  Gateway integration paths is corrected explicitly in T-0138.
- Documentation: clean final targeted result under the immutable Luna/medium
  role after conditional validation prose, canonical navigation, and exact
  `RemovalQuarantine` deletion were proved.
- TypeScript/API docs: accepted after two waves. The final P1 batch is resolved
  by literal descriptor evidence, public generated/facet classification, exact
  constructor/builder contracts, precedence, and non-throwing monitor outcomes.
- Performance/reliability: accepted after two waves. The final P1/P2 batch is
  resolved by the complete durable-family matrix, engine-specific write/failure
  behavior, hook-specific fallbacks, and in-flight stop ownership rule.

No P0/P1 remains and every accepted P2 is resolved. A third complete wave is
not opened under the protocol's review-round limit; deterministic verification
proves the record-only final corrections.

## Verification Profile

Planning uses `verify:task -- --no-tests` after deterministic Markdown checks.
The completed Wave 8 runtime sequence uses `verify:release` once after review
convergence because it changes shared runtime, dependencies, generated types,
and serialized storage contracts.

The planning profile passed on 2026-08-07 after the standard ignored Proto
output was generated. The initial clean-worktree attempt failed only because
those derived files were absent; the repeated canonical command passed.
