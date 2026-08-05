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
