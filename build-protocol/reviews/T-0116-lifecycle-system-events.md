# T-0116 Review Log

Status: Focused re-review pending

## Scope

Reviews only committed Entity lifecycle System-event production, ordering,
failure isolation, multitenancy, and resulting Entity-subscription transitions
for T-0116.

## Planned Assignments

| Concern                 | Existing role/profile   | Status                                                  |
| ----------------------- | ----------------------- | ------------------------------------------------------- |
| Style/maintainability   | `gpt-5.6-terra` / high  | Three P2 findings accepted.                             |
| Documentation           | `gpt-5.6-luna` / medium | N/A: no public prose, TSDoc, or end-user claim changed. |
| TypeScript/API docs     | `gpt-5.6-terra` / high  | One P1 and one P2 finding accepted.                     |
| Performance/reliability | `gpt-5.6-terra` / high  | One P1 finding accepted; duplicates API P1.             |

Every dispatch must state its role, expected model, and expected reasoning.
Actual metadata or the immutable configured-profile limitation must be recorded
before accepting a result.

## Review Wave — 2026-08-05

- Basis: clean committed branch endpoint `2e6af785` against
  `origin/main@6523a68c`.
- Style assignment: existing `style_maintainability_reviewer`; expected and
  explicitly dispatched model `gpt-5.6-terra`, reasoning `high`.
- TypeScript/API assignment: existing `typescript_api_docs_reviewer`; expected
  and explicitly dispatched model `gpt-5.6-terra`, reasoning `high`.
- Reliability assignment: existing `performance_reliability_reviewer`;
  expected and explicitly dispatched model `gpt-5.6-terra`, reasoning `high`.
- Runtime self-introspection is not exposed on this surface. The immutable
  configured role/profile is recorded as the available runtime metadata;
  dispatches explicitly set both requested fields.
- Documentation is N/A because the diff contains task/review evidence only,
  with no changed public README, REFERENCE, guide, TSDoc, generated API docs,
  or user-facing claim. Deterministic TypeDoc and audience checks pass.
- Final security review is N/A: the task changes no authentication,
  authorization, untrusted-input boundary, dependency, secret, transport, or
  deployment surface. Lifecycle correctness is owned by the reliability lane.

## Accepted Finding Batch — 2026-08-05

1. P1, API and reliability: lifecycle payload `when` fields and their enclosing
   Event contexts use separate metadata instances and may carry different
   timestamps. Construct each emitted payload and envelope from one per-event
   metadata instance and prove equality with an advancing clock.
2. P2, style: the lifecycle publisher mixes transition selection, five Proto
   constructions, metadata allocation, schema registration, and best-effort
   dispatch in one 113-line method. Separate message construction from posting.
3. P2, style: replace repeated anonymous archived/deleted shapes with the
   existing `EntityLifecycleFlags` type.
4. P2, style: wrap the newly added context-owning repository test in
   `try/finally` so failure cannot leak its runtime.
5. P2, API docs: update stale System Stand and subscription-runtime TSDoc that
   still claims only `EntityStateChanged` is delivered; describe lifecycle
   removal and restoration behavior.

All three reviewers reported that runtime self-introspection is unavailable;
their immutable configured roles and explicitly dispatched model/reasoning
match the assignments above. No finding is rejected or deferred.

## Correction Endpoint And Re-Review — 2026-08-05

- Corrected endpoint: `c61fc897`.
- P1: per-ordinal metadata is reused by each payload and envelope; an advancing
  `SystemClock` regression test proves created-before-state-changed ordering and
  exact payload/context timestamp equality for state-change and archive events.
- P2: message construction and best-effort posting are separated; lifecycle
  shapes use `EntityLifecycleFlags`; new context-owning tests close in
  `finally`; System Stand and runtime TSDoc describe lifecycle rendering.
- Full repository-routing and subscription-observer suites pass: 177 tests.
  Server typecheck, affected ESLint, cleanup/TSDoc, formatting, and diff checks
  pass.
- The same style, TypeScript/API, and reliability reviewers are redispatched
  only over `365f59c9..c61fc897`. Their expected and explicitly dispatched
  profiles remain `gpt-5.6-terra` / `high`; runtime self-introspection remains
  unavailable and the immutable configured profile is the available metadata.
