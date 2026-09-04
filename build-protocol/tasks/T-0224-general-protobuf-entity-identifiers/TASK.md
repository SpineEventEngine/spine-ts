# T-0224: General Protobuf Entity Identifiers

Status: Ready for human review
Baseline: `origin/master@5b7c6d1e55706363fef52162b0d0d995f504a3e2`
Branch: `general-protobuf-entity-identifiers`
Worktree: `.worktrees/general-protobuf-entity-identifiers`

## Objective

Support complete generated Protobuf messages as Entity IDs. Route, deliver,
persist, and compare the message described by the Entity state's ID-field
schema, including nested and multi-field identifiers.

## Acceptance criteria

1. A message ID follows its declared Protobuf schema without field-name
   restrictions.
2. A message ID may contain message-valued fields.
3. A message ID may contain several fields.
4. Command, event-producer, event-fallback, and state-update routing retain the
   complete typed message ID.
5. Entity Inbox delivery, persistence/reload, route deduplication, and dispatch
   guards retain and distinguish complete message IDs.
6. Equivalent copies of one ID have the same canonical key; distinct composite
   IDs do not collide.
7. A primitive Entity target accepts a compatible primitive selected by default
   routing or returned by an explicit custom route.
8. Wrong message types and malformed packed IDs continue to fail clearly.
9. The public `MessageId` declaration and TSDoc describe a general Protobuf
   message.
10. No new type registry, durable-key format, or storage migration is added.
11. One repository-level project-management scenario starts with
    `CreateProject` and proves that `ProjectCreated` updates the independently
    routed `ProjectPlanning` and `ProjectStaffing` Process Managers, drives the
    producer-routed `ProjectCoordinator` Process Manager to post
    `ScheduleProject`, and updates the independently routed `Portfolio` and
    producer-routed `ProjectProjection` Projections. Every Entity uses a typed
    composite Protobuf ID with at least two fields. Only the two Entities that
    intentionally use default producer routing share `ProjectId` with the
    producer; every custom-routed Entity has its own domain-specific ID type.
12. The integration assertions observe the resulting persisted Entity states,
    not Delivery Inbox implementation records.
13. A negative repository-level scenario proves that an exact empty
    `Portfolio` route suppresses only that Projection while the Project,
    Process Managers, and other Projection still reach their expected states
    and `ProjectCoordinator` still posts `ScheduleProject`.
14. A new private `packages/server-blackbox-tests` workspace package contains
    the shared cross-package test application. It depends on the public server
    and testing packages without making either production package depend
    backwards on the other. Publication policy must distinguish this private
    test workspace from the existing 18 publishable framework packages.
15. An additional positive test in that private package exercises the same
    project-management workflow through the public `BlackBox` API: it posts a
    real `CreateProject` Command through a BlackBox scope and reads all six
    Entity states through public Query operations with their correctly typed
    composite ID filters. This test supplements rather than replaces the direct
    repository-level positive and negative tests.
16. The private test package declares the project-management model in canonical
    `.proto` source and imports generated schemas. It contains no hand-written
    descriptor assembly or embedded descriptor binaries.

## Classification and estimate

High risk: this changes a public TypeScript type and serialized Entity identity
semantics across routing, delivery, persistence, and deduplication.

Estimated active work: 3.5–5.5 uninterrupted hours, including RED fixtures,
implementation, focused coverage, review/corrections, version alignment, one
release gate, commits, pushes, and reporting.

## Execution and verification

- Use behavior-first TDD and observe the new focused tests fail before changing
  production code.
- Reuse the Entity state ID-field descriptor plus existing `Identifiers` and
  `EntityIds` facilities. Do not add another Protobuf registry.
- Run the affected server tests and changed-source coverage before review.
- Run the private server BlackBox package tests and prove that its BlackBox
  scenario uses only the public BlackBox/client surface for commands and state
  observation.
- Run one complete relevant review wave after mechanical convergence.
- Run `verify:release` once after review convergence because this is shared
  server runtime and public-contract work.
- Select the next common unused snapshot version. Put only workspace top-level
  version changes in the commit named exactly `Bump version -> <version>`;
  dependency pins, lockfile, and generated metadata belong in separate commits.

## Agent routing

The Codex Desktop surface supports explicit model and reasoning selection.
Subagents may not spawn subagents.

- Requirements splitter: existing `requirements_splitter` role; public and
  serialized contract decomposition; `gpt-5.6-sol`, high reasoning.
- Implementation owner: existing `implementer` role; tests, server runtime,
  public declaration, TSDoc, and task records; `gpt-5.6-terra`, medium
  reasoning.
- Mechanical verification: orchestrator-dispatched function; focused commands
  and output classification; `gpt-5.6-luna`, low or medium reasoning.
- Correctness/compatibility review: existing specialist review function;
  routing, persistence, canonical identity, and JVM parity; `gpt-5.6-terra`,
  high reasoning.
- Style/maintainability review: existing `style_maintainability_reviewer`;
  affected implementation and tests; `gpt-5.6-terra`, high reasoning.
- TypeScript/API documentation review: existing
  `typescript_api_docs_reviewer`; exported type and TSDoc; `gpt-5.6-terra`,
  high reasoning.
- Performance/reliability review: existing
  `performance_reliability_reviewer`; key stability, collision, and lifecycle
  paths; `gpt-5.6-terra`, high reasoning.
- Reader documentation: N/A unless implementation changes reader-facing usage
  beyond the corrected public declaration.
- Security: N/A as a separate lane; this task changes no credential, trust, or
  remote-input boundary. Malformed-data rejection remains a correctness gate.

Actual runtime self-introspection may be unavailable. In that case the explicit
dispatch fields and immutable role profile are the recorded evidence.

## Human-imposed requirements

- Structured Protobuf identifiers are a supported Spine concept. Their complete
  schema-declared value forms the Entity identity.
- Do not invent special Command/Event/message registries for this correction.
- Work from current official `origin/master` on a regular feature branch with
  no `codex/` prefix.
- Never modify or push official `master` directly.
- Every feature branch includes the required version-only commit with its exact
  message; all other changes remain outside that commit.
- Push each feature-branch commit to `origin` immediately.
- Preserve unrelated changes in the primary checkout.
