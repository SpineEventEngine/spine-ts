# T-0045: Project-management load-test example

Status: Complete; committed and ready for remote synchronization

## Objective

Create the project-management example and load-test harness described in
[`docs/project-management-load-test-plan.md`](../../../docs/project-management-load-test-plan.md).

## Human-Imposed Requirements Ledger

- Reread and follow `build-protocol/BUILD_PROTOCOL.md`.
- Perform P2 now; do not begin P3/Firestore work.
- Use a new project-management example with exactly 3 aggregates, 20
  projections, 10 process managers, and 10–100 independent asynchronous users.
- Exercise real gRPC command, query, and subscription paths.
- Preserve public API and generated-output boundaries; do not add speculative
  public monitoring or production persistence APIs.
- Do not modify the protected `human-review-1-jul.md`.

## Skill applicability

- Applicable session skills: `planning-with-files`, `domain-modeling`,
  `javascript-testing-patterns`, `test-driven-development`,
  `verification-before-completion`.
- Task-provided skill paths: repository build protocol and this ledger.
- `build-protocol/skills/EXPECTED_SKILLS.md` and reachable installed skill
  entrypoints/lock are to be recorded before implementation acceptance.

## High-risk assumptions

- The existing public handler and server APIs are sufficient; no framework seam
  is added merely for the benchmark.
- Load results are diagnostic and reproducible, not a promised throughput SLO.
- The first implementation is a bounded smoke/stress harness; optimization is
  a separate task if evidence warrants it.

## Acceptance criteria

- 3 aggregates, 20 projections, 10 process managers, and generated registry
  metadata exist and are tested.
- Independent asynchronous gRPC clients run at 10/25/50/100 users.
- Commands, queries, subscriptions, cancellation, validation, refusal, and
  eventual read-side visibility are measured and asserted.
- Smoke and stress modes, result schema, cleanup, and reproducibility are
  documented.
- No internal framework APIs or new public monitoring APIs appear in example
  code.

## Non-goals

No production persistence, distributed transport, benchmark target, runtime
optimization, or deployment harness.

## Verification

Run focused example tests, forbidden end-user API scans, generation/build,
native gRPC smoke, then the repository review lanes relevant to example,
documentation, API, and reliability changes.
