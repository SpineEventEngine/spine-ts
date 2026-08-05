# T-0109 Review Record

Status: Final correction batch in progress

## Classification And Scope

T-0109 is high-risk because it changes post-commit system-event publication,
EventBus observation, durable subscription lifecycle, multi-node reconciliation,
timer/close ownership, and listener fencing. Review is limited to the accepted
task and implementation brief. JVM builds and source changes are excluded.

## Required Concerns

| Concern                     | Existing role                      | Expected profile                    | Status                                                                                                              |
| --------------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Style and maintainability   | `style_maintainability_reviewer`   | `gpt-5.6-terra` / `high`            | Request changes: one P1 and five P2 findings                                                                        |
| Documentation               | `documentation_reviewer`           | immutable `gpt-5.6-luna` / `medium` | Request changes: one P1 and one P2 finding                                                                          |
| TypeScript and API          | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` / `high`            | Request changes: one P1 and one P2 finding                                                                          |
| Performance and reliability | `performance_reliability_reviewer` | `gpt-5.6-terra` / `high`            | Request changes: four P1 and three P2 findings                                                                      |
| Security                    | Final security reviewer            | N/A provisionally                   | No trust boundary, credential, authorization, or external-input expansion is planned; reassess from the final diff. |

Every dispatch must include explicit model and reasoning fields. Before accepting
a result, record exposed runtime metadata or the immutable configured role and
the runtime self-introspection limitation. One complete review wave is collected
before returning an aggregated correction batch to the existing implementer.

## Mechanical Evidence Before Review

- `pnpm verify:task -- --no-coverage ...` passes the complete shared task gate
  for the seven affected test files: 391 tests pass and 17 are skipped.
- Build/typecheck, cleanup, TSDoc, formatting, documentation audience, TypeDoc
  exports, Proto lint, generated cleanliness, release-readiness imports/assets/
  links, and focused tests are all clean.
- Each reviewer is instructed not to spawn children and to review only its
  assigned concern over `origin/main...84f0fe36`. Runtime self-introspection may
  be unavailable; the immutable role profile is recorded when that occurs.

## Complete Finding Batch

The four reviews completed before any correction was dispatched. Runtime
self-introspection was unavailable in every lane. The immutable configured role
profiles are the actual metadata available: Terra/high for style, API, and
reliability, and Luna/medium for documentation. The Desktop role definition
kept the documentation reviewer on its immutable Luna profile even though the
generic dispatch model field cannot name Luna.

Accepted findings, deduplicated across lanes:

1. **P1:** Entity subscriptions must consume local `EntityStateChanged` events
   through EventBus rather than direct Stand state callbacks. Tests must cover
   Aggregate, Projection, and Process Manager updates through that path.
2. **P1:** Throwing Stand consumers must not suppress post-commit state-change
   publication or follow-up dispatch for Projection or Process Manager.
3. **P1:** Datastore and MySQL ambiguous acknowledgements require a durable
   per-invocation owner token so exactly one caller returns `committed` and owns
   repository post-commit effects.
4. **P1:** Concurrent activation of one definition requires per-ID local
   serialization so only one stream consumer is installed.
5. **P1:** Deterministic barrier tests must prove delete-during-snapshot,
   revision fencing, stale sweep, post-delete convergence, and close-time timer/
   listener cleanup.
6. **P1:** Provider-only commit construction must disappear from public factory
   class methods and remain available only through the typed internal SPI.
7. **P1:** The server reference must describe immediate plus ten-second
   per-node registry reconciliation without promising cluster completeness.
8. **P2:** Reconciliation failure must remove the consumer inserted before the
   failed cycle.
9. **P2:** Bounded Context shutdown must detach Stand EventBus listeners before
   finishing EventBus and registry close.
10. **P2:** In-memory per-scope commit locks must remove their exact queued-tail
    entry after completion.
11. **P2:** Remove obsolete standalone EventStore append and no-op local
    attachment cleanup paths.
12. **P2:** Rename the in-memory digest helper that produces hexadecimal text.
13. **P2:** Add the mandatory Human-Imposed Requirements Ledger to the task.
14. **P2:** Storage, Datastore, and RDBMS references must document the internal
    atomic commit port and qualify standalone history operations as separate.

## Correction Ownership

- The server implementer owns findings 1, 2, 4, 5, 7, 8, 9, 11 (server
  portions), and 13 in server/task/test/reference paths.
- The storage-provider implementer owns findings 3, 6, 10, 11 (storage
  portions), 12, and 14 in storage, Datastore, and RDBMS paths.
- Both assignments use the existing implementer role on explicitly dispatched
  `gpt-5.6-terra` / `medium`, may not spawn children, and must not touch the
  other owner's paths. One combined correction endpoint will be mechanically
  checked before only substantively affected reviewer lanes are reopened.

## Correction Evidence

- `9bbd7b88` integrates the two correction lanes; the small integration follow-up
  aligns the accessor export path and isolated-declaration types.
- The affected seven-file focused profile passes 393 tests with 17 skipped.
- MySQL 8.4 passes 17/17 live tests; the Datastore-mode emulator passes 8/8.
- Build/typecheck, cleanup, TSDoc, changed-path ESLint, formatting, and diff
  checks pass.
- All four specialist concerns were substantively affected by the correction
  batch and receive one focused re-review. Security remains provisionally N/A:
  no trust boundary, authorization, credential, or external-input contract was
  introduced.

## Focused Re-review Results

- API: the public factory leak is fixed; one P2 remains for the wrong internal
  subpath named in `packages/storage/REFERENCE.md`.
- Documentation: server and provider claims are fixed; it confirms the same P2
  internal-subpath error.
- Reliability: EventBus observation, stream-consumer isolation, owner-token
  persistence, failed-cycle cleanup, shutdown ordering, and lock-tail cleanup
  are fixed. Two P1 groups remain: direct Stand subscriber failure still blocks
  Projection/Process Manager post-commit work, and deterministic full-path race
  proof is incomplete for simultaneous activation, exact-one provider outcome,
  and native Aggregate/Projection/Process Manager subscriptions.
- Style: consumer/lock/name fixes are clean. One P1 remains for barrier-controlled
  delete-during-snapshot and shutdown proof. Three P2 items remain: obsolete
  EventStore/no-op attachment code and an incomplete requirements ledger.

This is the second complete review wave. The final correction batch is returned
to the existing implementation contexts and closes through deterministic proof
plus finding-specific reviewer confirmation; no third complete review wave is
opened.

## Final Correction Ownership

- Server implementer (`gpt-5.6-terra` / `medium`, explicit retained profile)
  owns direct-subscriber isolation for Projection and both Process Manager
  paths; barrier-controlled activation/reconciliation/delete/shutdown tests;
  full native Aggregate/Projection/Process Manager subscription integration;
  obsolete server code removal; and the complete requirements ledger.
- Storage implementer (`gpt-5.6-terra` / `medium`, explicit retained profile)
  owns strict exact-one MySQL and Datastore competing-caller tests and the exact
  `internal/entity-commit` reference correction.
- Runtime self-introspection remains unavailable for both immutable implementer
  profiles. Each owner works in a separate worktree from this endpoint and may
  not spawn children or modify the other lane.

## Native Family Proof Redispatch

- The original server implementer completed post-commit isolation,
  delete-during-snapshot, gated close, and simultaneous activation checkpoints,
  but stopped before the required full native family subscription proof because
  Process Manager fixtures were private to another test module. This is a
  demonstrated context/implementation limit, not a protocol blocker.
- A fresh bounded implementer receives sole ownership of extracting or
  duplicating the minimum test fixtures and proving actual Aggregate,
  Projection, Process Manager command, and Process Manager event commits through
  native SubscriptionService activation and EventBus `EntityStateChanged`.
  Expected dispatch is explicitly `gpt-5.6-terra` / `medium`; runtime
  self-introspection may be unavailable, and the immutable configured profile is
  then the acceptance metadata. The replacement may not spawn children or
  change production behavior unless the proof exposes a concrete defect.

## Finding-Specific Confirmation Dispatch

The converged endpoint `4570fff0` receives confirmation only for findings left
open by the second complete review wave. This is not a third broad review wave.
Every reviewer is instructed not to spawn children.

| Concern                     | Existing role                      | Expected profile                    | Confirmation scope                                                                                                                                               |
| --------------------------- | ---------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Performance and reliability | `performance_reliability_reviewer` | `gpt-5.6-terra` / `high`            | Post-commit callback isolation, simultaneous activation, provider exact-one ownership, native entity-family subscriptions, and reconciliation/shutdown barriers. |
| Style and maintainability   | `style_maintainability_reviewer`   | `gpt-5.6-terra` / `high`            | Deterministic lifecycle proof, obsolete server-path removal, and the requirements ledger.                                                                        |
| TypeScript and API          | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` / `high`            | Correct internal atomic-commit subpath and no public provider-factory leak.                                                                                      |
| Documentation               | `documentation_reviewer`           | immutable `gpt-5.6-luna` / `medium` | Correct storage reference subpaths and separation of history from atomic commit operations.                                                                      |

All dispatches explicitly name their configured model and reasoning. The
Desktop surface may not expose runtime self-introspection; when absent, the
immutable configured role/profile is the accepted actual metadata unless a
visible mismatch occurs.

## Finding-Specific Confirmation Results

Runtime self-introspection was unavailable in all three completed confirmation
lanes; no visible mismatch occurred with their explicit Terra/high profiles.

- API confirms that provider commit construction remains absent from the public
  factory surface. One P2 sentence still attributed the atomic commit port to
  `internal/entity-history`; it is corrected to the separate
  `internal/entity-commit` subpath.
- Style confirms delete-during-snapshot fencing and obsolete-code removal. It
  keeps shutdown proof open because the gated-close test did not attach an
  active EventBus observer, and keeps the requirements ledger open for four
  omitted approved requirements.
- Reliability confirms simultaneous activation, exact-one provider ownership,
  all four native entity-family paths, and snapshot/close barriers. It keeps one
  P1 open: the Process Manager command and event paths notify direct Stand
  subscribers without the post-commit failure boundary already used by
  Projection.

One bounded correction returns to the existing implementer role with explicit
`gpt-5.6-terra` / `medium`. It owns the shared Process Manager post-commit
failure boundary, command/event regression tests, and a close test that first
attaches a real EventBus observer. It may not spawn children or change unrelated
paths. Runtime self-introspection may be unavailable; the immutable configured
role/profile is then the accepted metadata absent a visible mismatch. The
orchestrator owns the deterministic reference, formatting, and requirements-
ledger corrections.

## Final Server Correction Redispatch

The existing implementer pushed `5abacea5`, which adds the Process Manager
post-commit failure boundary and passes 148 focused routing tests plus server
typecheck, ESLint, formatting, and diff checks. It did not complete the required
Process Manager command/event regressions or the close test with a real attached
EventBus observer, so the correction is not yet accepted as closed.

A fresh bounded implementer receives only those three deterministic tests. The
dispatch explicitly uses `gpt-5.6-terra` / `medium`; runtime self-introspection
may be unavailable, and the immutable configured role/profile is then the
accepted metadata absent a visible mismatch. It may not spawn children or
change production behavior unless a test exposes a concrete remaining defect.

The replacement implementer completed and pushed `6ada7260` under the explicit
Terra/medium assignment. Runtime self-introspection was unavailable and no
visible mismatch occurred. The two assigned files add Process Manager command
and event failure-isolation regressions plus an active-observer close proof.
Focused evidence passes 187 tests, server TypeScript, ESLint, formatting, and
diff checks; no further production correction was required.

The narrow reliability confirmation closes both Process Manager paths and
finds no remaining production lifecycle defect. It keeps one test-only gap:
post-close non-delivery can also result from the cleared consumer map, so the
test must assert the EventBus observer's unsubscribe or detachment directly.
The same implementer retains test-only ownership under its explicit
Terra/medium profile; no production change or broad re-review is authorized.
