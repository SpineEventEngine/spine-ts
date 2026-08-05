# T-0116 Review Log

Status: Converged; all applicable concerns clean

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

## Focused Re-Review Result — 2026-08-05

- TypeScript/API: clean; timestamp and TSDoc findings are resolved.
- Performance/reliability: clean; the P1 and correction-caused behavior are
  resolved.
- Style: context cleanup is resolved. Two P2 residuals remain: `#publish` is
  still a 117-line assembler despite isolating posting, and the Projection and
  Process Manager loader constructor contracts still repeat anonymous
  archived/deleted shapes instead of `EntityLifecycleFlags`.
- All re-reviewers again report unavailable runtime self-introspection and the
  matching immutable configured `gpt-5.6-terra` / `high` profile.

## Residual Style Correction — 2026-08-05

- The orchestrator completed the bounded structural correction after the
  implementation owner twice reported that it could not safely replace the
  assembler atomically.
- `#publish` now accepts bundled origin/change records, constructs no lifecycle
  payloads, and only materializes timestamp-late drafts into envelopes and
  posts them. Focused helpers select state, archive, and delete drafts while
  preserving the required order.
- Projection and Process Manager loader contracts now use
  `EntityLifecycleFlags`.
- The focused repository and observer suites pass all 177 tests; server
  typecheck, affected ESLint, formatting, and diff checks pass.
- Only the style lane requires one final focused re-review of this correction.

## Final Review Dispositions — 2026-08-05

- Style/maintainability: clean at `7062ab4d`; both residual P2 findings are
  resolved and no correction-caused issue remains.
- TypeScript/API docs: clean at `c61fc897`; timestamp contract and lifecycle
  TSDoc findings are resolved.
- Performance/reliability: clean at `c61fc897`; committed-event, catch-up,
  failure-isolation, tenancy, and subscription behavior have no remaining
  finding.
- Documentation: N/A for public prose, as recorded above; changed internal
  TSDoc passed deterministic checks and the API lane.
- Security: N/A for the concrete reasons recorded above.
- Reviewer runtime self-introspection remained unavailable; every immutable
  configured role/profile matched its explicit dispatch.

## Release-Gate Reliability Correction — 2026-08-05

- The full gate exposed composite observer cleanup that was not exercised by
  the original focused surface. `SubscriptionObservers.observeState()` now
  attempts all five lifecycle observer detachments when one throws.
- Stand shutdown tests now assert the actual five-observer composition and
  prove every child closes before registry shutdown, including injected
  failure.
- The performance/reliability reviewer is redispatched only over this
  production correction and test. Expected and explicitly dispatched profile:
  `gpt-5.6-terra` / `high`; immutable configured metadata applies because
  runtime self-introspection is unavailable.
