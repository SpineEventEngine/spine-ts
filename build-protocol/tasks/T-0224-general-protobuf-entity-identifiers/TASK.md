# T-0224: General Protobuf Entity Identifiers

Status: Ready for human review
Baseline: `origin/master@5b7c6d1e55706363fef52162b0d0d995f504a3e2`
Branch: `general-protobuf-entity-identifiers`
Worktree: `.worktrees/general-protobuf-entity-identifiers`

## Objective

Remove Spine TS's invented requirement that a message-valued Entity ID contain
exactly one primitive field named `value`. Route, deliver, persist, and compare
the complete message described by the Entity state's ID-field schema.

## Acceptance criteria

1. A message ID may have one field with any valid Protobuf name.
2. A message ID may contain message-valued fields.
3. A message ID may contain several fields.
4. Command, event-producer, event-fallback, and state-update routing retain the
   complete typed message ID.
5. Entity Inbox delivery, persistence/reload, route deduplication, and dispatch
   guards retain and distinguish complete message IDs.
6. Equivalent copies of one ID have the same canonical key; distinct composite
   IDs do not collide.
7. Existing primitive IDs and legacy one-field message IDs remain compatible.
8. Wrong message types and malformed packed IDs continue to fail clearly.
9. The public `MessageId` declaration and TSDoc describe a general Protobuf
   message instead of the obsolete `{ $typeName, value }` shape.
10. No new type registry, durable-key format, or storage migration is added.

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

- Structured Protobuf identifiers are a supported Spine concept; do not impose
  a field named `value`, primitive-only fields, or a single-field limit.
- Do not invent special Command/Event/message registries for this correction.
- Work from current official `origin/master` on a regular feature branch with
  no `codex/` prefix.
- Never modify or push official `master` directly.
- Every feature branch includes the required version-only commit with its exact
  message; all other changes remain outside that commit.
- Push each feature-branch commit to `origin` immediately.
- Preserve unrelated changes in the primary checkout.
