# T-0120: Wave 7 Scaling And Redeployment Plan

Status: Execution authorized; dependency split complete

## Objective

Records the approved Wave 7 deployment, discovery, scaling, and redeployment
boundaries, resolves the remaining human questions, and produces the accepted
dependency-ordered implementation plan.

## Classification

High-risk. Wave 7 changes dynamic application-node discovery, Gateway routing
and subscription lifecycle, persisted deployment coordination, failure
behavior, rolling replacement, and production infrastructure templates.

## Baseline And Isolation

- Baseline: `origin/main@e6666605`.
- Branch: `task/T-0120-wave7-plan`.
- Worktree: `.worktrees/T-0120-wave7-plan`.
- The stale and dirty primary checkout remains coordination-only and untouched.

## Human-Imposed Requirements Ledger

1. Cloud Run is outside Wave 7, Wave 8, and the initial offering.
2. Wave 7 supports GKE and GCE, with a detailed beginner-oriented deployment
   guide for each platform.
3. The framework provides generic discovery capability. Platform-specific
   behavior belongs in separate packages.
4. Use `@spine-event-engine/deployment`,
   `@spine-event-engine/deployment-gke`, and
   `@spine-event-engine/deployment-gce` as the package boundaries.
5. One logical standalone Gateway discovers and connects to all current
   application nodes. Multiple Gateways remain Wave 8 work.
6. GKE discovery uses a headless Service and DNS. The Gateway refreshes the
   result on a configurable ten-second interval and respects DNS TTL behavior.
7. GCE discovery uses a storage-backed leased application-node registry. The
   registry receives an explicit `StorageFactory` and uses a separate logical
   namespace, although an application may point it at the same physical
   storage system as domain data.
8. The initial GCE lease policy renews every 20 seconds, expires after 60
   seconds, and lets the Gateway refresh discovery every 10 seconds.
9. The default expected application-node count is 32. Discovery continues to
   use every node when that threshold is exceeded. Load tests document tested
   capacity but do not impose a hard runtime maximum.
10. The minimal GCE Terraform topology may colocate the Gateway and the
    in-memory simple delivery server. Production guidance recommends separating
    them.
11. Supply optional platform autoscaling configuration, disabled until the
    operator selects metrics and thresholds. Spine TS does not perform scaling.
12. Scaling the same application version up and down, including scale to zero,
    is supported. Operators own scaling policy.
13. Compatible business-logic versions may overlap during rolling application-
    node replacement. Incompatible changes use stop-all/start-new replacement.
    Pending Inbox work may execute under the new version.
14. A single Gateway may be replaced in Wave 7 with a documented interruption.
    Durable subscription definitions survive; clients reconnect and re-query.
15. Deployment templates pass configuration and external secret references but
    never select the application's storage engine.
16. Wave 8 owns multiple-Gateway behavior, framework operational logging and a
    Google Cloud Logging adapter, the then-current `validation-ts` upgrade, and
    Datastore/RDBMS physical-layout tuning controls. Its logging work emits an
    ERROR when discovered application nodes exceed the configured expected
    count; Wave 7 continues serving every node.
17. No Wave 7 implementation starts until the human approves the completed
    plan.
18. Do not publish packages to npm or push to the future migration remote.
19. Push every feature-branch commit to `origin` immediately.
20. Preserve user-owned files, especially `human-review-1-jul.md` and
    `human-review-22-jul.md`.
21. Each GCE application process runs its own registrar according to the
    lifecycle in `WAVE_7_SCALING_REDEPLOYMENT_PLAN.md`.
22. GCE publishes a private node address by default and permits an explicit
    endpoint override for nonstandard networking.

## Human Q&A Result

Every Wave 7 product decision is resolved. The final planning step may now
produce and review the dependency-ordered implementation split. On 2026-08-06,
the human explicitly instructed the autonomous process to start Wave 7. That
instruction approves execution of the accepted plan without another routine
approval pause.

## Requirements-Splitter Assignment

- Existing role: requirements splitter.
- Scope: turn the accepted Wave 7 contract into small dependency-ordered tasks
  with observable acceptance criteria, RED-first tests, documentation
  obligations, relevant review concerns, and verification profiles.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Dispatch requirement: both model and reasoning must be explicit fields.
- The prior `wave7_requirements` result is rejected as superseded because it
  imposed a hard node ceiling and fail-closed overflow behavior contradicted by
  the final human decision.
- Subagents may not spawn subagents.

## Requirements-Splitter Result

- Existing role performed: requirements splitter.
- Configured runtime profile: `gpt-5.6-sol` with `high` reasoning, explicitly
  dispatched by the orchestrator.
- Actual runtime metadata: this child surface does not expose a self-
  introspection API for model/reasoning metadata. The immutable configured
  role/profile and explicit dispatch fields are the available evidence; no
  visible fallback or mismatch occurred.
- Skill applicability: the epic-breakdown advisor applied workflow,
  business-rule-variation, and simple/complex splitting. Interactive questions
  were unnecessary because T-0120 records complete human-approved context and
  execution authorization.
- Result: eight review-sized slices, T-0121 through T-0128, are specified in
  `WAVE_7_SCALING_REDEPLOYMENT_PLAN.md` with dependencies, observable
  acceptance criteria, RED-first tests, exclusive ownership, documentation,
  review dispositions, verification profile, risks, and exclusions.
- Orchestrator acceptance: accepted. The dispatch explicitly supplied the
  expected model and reasoning, the result preserves every final human
  decision, and the dependency order removes transient topology from durable
  subscription identity before adding platform membership sources.

## Planning Review Assignments

The complete planning diff receives one concern-specific review wave before
T-0120 integration. Subagents may not spawn subagents.

- Existing style/maintainability reviewer: task sizing, ownership, dependency
  order, and avoidance of duplicate mechanisms. Expected and explicitly
  dispatched `gpt-5.6-terra` / `high`.
- Existing documentation reviewer: plan clarity, human-ledger completeness,
  and accurate current/future wording. Expected and explicitly dispatched
  immutable role profile `gpt-5.6-luna` / `medium`.
- Existing TypeScript/API documentation reviewer: proposed public/package and
  persisted-contract boundaries. Expected and explicitly dispatched
  `gpt-5.6-terra` / `high`.
- Existing performance/reliability reviewer: bounded all-node reconciliation,
  subscription lifecycle, leases, DNS, cleanup, shutdown, scaling, and
  replacement semantics. Expected and explicitly dispatched
  `gpt-5.6-terra` / `high`.

Actual runtime metadata will be recorded with the results when exposed. If a
reviewer cannot self-introspect, the immutable configured role/profile and
explicit dispatch fields are the acceptance evidence unless a visible mismatch
or fallback occurs.

## Planning Review Wave Result

The complete four-concern wave finished. Every reviewer used the expected
configured role/profile; no child surface exposed independent runtime model
self-introspection, and no visible fallback or mismatch occurred.

- Style/maintainability (`gpt-5.6-terra` / `high`): two P1 and one P2.
- Documentation (`gpt-5.6-luna` / `medium`, immutable role dispatch because
  the surface rejects a redundant Luna override): one P1, duplicated with the
  style/reliability stale-status finding; otherwise clean.
- TypeScript/API docs (`gpt-5.6-terra` / `high`): one P1 and four P2.
- Performance/reliability (`gpt-5.6-terra` / `high`): one P1 and two P2.

Accepted deduplicated correction batch:

1. Remove the stale unresolved-question sentence that contradicts approved
   execution.
2. Make T-0121 split unary-only validation from the shared fixed fan-in, and
   make T-0122 own removal of the subscription count/positional envelope.
3. Give Terraform policy/fixture tests a focused `verify:task` invocation
   instead of `--no-tests`.
4. Require one generation-fenced reconciliation owner with only the latest
   pending snapshot coalesced during rapid churn.
5. Fence and quiesce GCE initial registration, renewal, and cleanup before
   conditional deletion and listener close.
6. State the repository-wide no-user/no-migration cutover explicitly: Wave 7
   may delete the fixed topology field/envelope and bump internal storage keys;
   it must not add a legacy migration layer or a pre-Wave-7 restart fixture.
7. Freeze stable node-ID derivation and canonical HTTP(S) endpoint rules,
   including address reuse, TLS authority, and IPv6 formatting.
8. Keep observed/expected counts package-internal in Wave 7 and reserve public
   logging/diagnostics exposure for Wave 8.
9. Specify the leased record's internal encoding version, supported read,
   malformed/unknown-version behavior, and incompatible storage-key policy.
10. Define exact DNS refresh-versus-TTL precedence, including zero/missing TTL
    and resolver failures.

The API review's request for backward-compatible pre-Wave-7 durable-binding
migration is rejected only in that proposed remedy. It conflicts with the
human-approved rule that Spine TS has no deployed users and does not need a
migration/deprecation cycle. The underlying P1 contract gap is accepted and is
resolved through an explicit incompatible cutover.

## Planning Correction Assignment

- Existing authoring context: requirements splitter from the accepted Wave 7
  split.
- Scope: apply only the complete accepted batch above to the two planning
  records, run focused deterministic checks, and report changed sections.
- Configured profile retained from the original explicit dispatch:
  `gpt-5.6-sol` / `high`.
- Subagents may not spawn subagents.

## Dependency-Ordered Execution Queue

1. T-0121: dynamic discovery and unary Gateway routing.
2. T-0122: dynamic subscription reconciliation.
3. T-0123: storage-backed leased node registry.
4. T-0124: GCE registration and discovery runtime.
5. T-0125: GKE DNS discovery runtime. It depends on T-0122 rather than T-0124,
   but follows it to keep shared Gateway/server write ownership serial.
6. T-0126: GKE Terraform and beginner deployment guide.
7. T-0127: GCE Terraform and beginner deployment guide.
8. T-0128: cross-platform capacity, replacement, documentation, and Wave 7
   closure.

The orchestrator may create the child task records just in time, after each
dependency is integrated and post-merge verified. Implementation does not
require another routine human approval. If a slice would introduce a hard node
cap, fail closed above the expected count, omit nodes from an over-expectation
snapshot, add Wave 8 logging, add Cloud Run, or add a second Gateway, work must
stop because that contradicts the accepted human ledger rather than being an
ordinary implementation choice.

## Review Dispositions

- Style/maintainability: relevant to the final task boundaries and package
  ownership recorded in the planning diff.
- Documentation: relevant to the accuracy and completeness of the deployment
  split and operator-guide obligations.
- TypeScript/API docs: relevant to the planned discovery, registration, and
  diagnostics contracts.
- Performance/reliability: relevant to leases, refresh, bounded concurrency,
  all-node reconciliation, replacement, and failure behavior.

No runtime code, package scaffold, Terraform, or end-user deployment guide was
implemented by T-0120. Its completion authorizes the orchestrator to create and
start T-0121 under the autonomous cycle.
