# T-0017c Review Log

Status: clean after final targeted security re-review

Scope: entity subscription matching, masks, no-longer-matching semantics,
tenant scoping, docs/API boundary, and verification evidence.

## Required Lanes

### Round 1

| Lane                       | Reviewer ID                            | Status                | Result                            |
| -------------------------- | -------------------------------------- | --------------------- | --------------------------------- |
| Code style/maintainability | `019f43ea-8636-71b2-aa06-dc665e8b3075` | Closed by coordinator | Low finding accepted              |
| Documentation completeness | `019f43ea-86e9-7871-9a8d-c025476e4c8a` | Closed by coordinator | High and Medium findings accepted |
| TypeScript/API docs        | `019f43ea-8765-72f3-a173-f7e81b51a370` | Closed by coordinator | Medium and Low findings accepted  |
| Security                   | `019f43ea-87e3-7653-b100-685caeb756c1` | Closed by coordinator | High and Medium findings accepted |
| Performance/reliability    | `019f43ea-8888-7b51-bea9-6afff281f152` | Closed by coordinator | High and Medium findings accepted |

### Round 2

| Lane                       | Reviewer ID                            | Status | Result   |
| -------------------------- | -------------------------------------- | ------ | -------- |
| Code style/maintainability | `019f43f5-7990-7c51-a667-bab136a6a4a7` | Closed | FINDINGS |
| Documentation completeness | `019f43f5-7a39-7fc0-9fa7-75e9c1701e25` | Closed | FINDINGS |
| TypeScript/API docs        | `019f43f5-7aa8-7fc1-b573-3d3cb4390689` | Closed | CLEAN    |
| Security                   | `019f43f5-7b2f-7881-a472-fd9b8e3c065b` | Closed | CLEAN    |
| Performance/reliability    | `019f43f5-7bab-77a0-9b0c-45ee09db5d74` | Closed | CLEAN    |

### Round 3

| Lane                       | Reviewer ID                            | Status | Result |
| -------------------------- | -------------------------------------- | ------ | ------ |
| Code style/maintainability | `019f43fb-19f4-76b0-80ed-0f72f2d76b5c` | Closed | CLEAN  |
| Documentation completeness | `019f43fb-1a6a-7d41-8f4f-fdae2144c6b7` | Closed | CLEAN  |

## Round 1 Findings

- Low, code style/maintainability: `SpineServices.#subscribe()` exceeded the
  method-size target after subscription matching setup was added.
- High, documentation completeness: reviewer participation and closure were
  missing from this review log.
- Medium, documentation completeness: service subscription docs were missing
  the tenant boundary for single-tenant rejection, multitenant `tenantId`
  requirement, and tenant-slice-scoped delivery.
- Medium, TypeScript/API docs: `StandUpdate.previousState` TSDoc/API docs did
  not document prior-state cloned-snapshot semantics.
- Low, TypeScript/API docs: `SpineServices` class TSDoc said subscriptions
  accept field filters but omitted ID filters.
- High, security: subscription filter validation recursively walked filter
  trees before any depth guard and capped only top-level composite filters.
- Medium, security: subscription `id_filter` size was unbounded despite the
  query ID-filter cap of 100.
- High, performance/reliability: same boundedness gap for maliciously deep or
  broad composite filter trees.
- Medium, performance/reliability: an empty composite with
  `CCF_CO_UNDEFINED` was accepted when paired with an ID filter.

## Round 1 Fix Pass

Authoring sub-agent `019f43ed-7202-74d1-843f-1ddf313756d9` completed the
combined round 1 review fixes and was closed by the coordinator.

- Added a bounded iterative subscription filter-tree validation pass before
  matcher predicate construction. It enforces total composite nodes, total
  simple filters, max nesting depth, and valid `ALL`/`EITHER` composite
  operators even for empty composites.
- Added `MAX_SUBSCRIPTION_ID_FILTER_IDS` aligned to the query limit of 100 and
  reject over-limit subscription ID filters in `Subscribe`.
- Preserved accepted semantics for valid empty composites matching all, missing
  ID filters matching all IDs, and rejected empty `TargetFilters`/present empty
  `id_filter`.
- Extracted inactive subscription record/timer insertion from `#subscribe()`
  into a small private method.
- Added focused service tests for over-limit ID filters, over-depth composites,
  too many nested composites, and empty undefined-operator composites before
  Stand subscription attachment.
- Updated Stand/API docs for copy-safe `previousState` semantics and added
  tenant-boundary subscription docs in the guide, architecture README, and
  server README.

### Round 1 Verification

- `pnpm --config.verify-deps-before-run=false test:generated packages/server/test/services/spine-services.test.ts`
  passed outside the sandbox with 1 file and 70 tests.
- `pnpm --config.verify-deps-before-run=false test:generated packages/server/test/stand/stand.test.ts packages/server/test/services/spine-services.test.ts`
  passed outside the sandbox with 2 files and 93 tests.
- `pnpm --config.verify-deps-before-run=false docs:check` passed. TypeDoc
  reported the existing invalid-origin source-link warning.
- `git diff --check` passed.

## Round 2 Findings

- Code style/maintainability: `validateSubscriptionFilterTree()` was too large
  after bounded validation was added.
- Documentation completeness: round 1 fix-agent closure, verification, and
  round 2 reviewer status/closure were missing from this review log.

## Round 2 Fix Pass

- Split subscription filter-tree validation so the iterative driver delegates
  per-node validation/counting and child enqueueing to focused helpers while
  preserving max-depth, total-composite, simple-filter, and operator validation
  semantics.
- Recorded round 1 review-fix sub-agent closure/verification and round 2
  reviewer status/closure.

## Round 3 Result

- Code style/maintainability re-review was clean.
- Documentation completeness re-review was clean.

## Final Post-Review Round

Reason: production and test files changed after the round 3 clean review while
driving repository-wide coverage and verification to completion. The final
round reviews the complete branch diff, with particular attention to the
post-round-3 comparison simplification, added coverage tests, and updated
verification evidence.

| Lane                       | Reviewer ID                            | Status | Result   |
| -------------------------- | -------------------------------------- | ------ | -------- |
| Code style/maintainability | `019f4411-2d89-7921-8011-97b8b91c665c` | Closed | FINDINGS |
| Documentation completeness | `019f4411-4b82-7312-a966-34746700a468` | Closed | CLEAN    |
| TypeScript/API docs        | `019f4411-6cef-7380-a040-b5ae72aafb7f` | Closed | FINDINGS |
| Security                   | `019f4411-8aec-7c32-bc9e-39c14f0e34cc` | Closed | FINDINGS |
| Performance/reliability    | `019f4411-a8ce-75a3-a0e5-7117e8de80fd` | Closed | FINDINGS |

### Final Post-Review Findings

- Low, code style/maintainability: `valuesEqual()` kept a now-redundant
  primitive branch and `isPrimitive()` helper after the post-round-3 comparison
  simplification.
- Low, code style/maintainability: a coverage-driven test blessed malformed
  non-Protobuf object ID filters by reference instead of rejecting or replacing
  it with supported behavior.
- High, TypeScript/API docs: subscription ID filters decode without entity ID
  field metadata, so message-typed IDs can remain packed as `Any` and fail to
  match generated ID objects; delivered `EntityStateUpdate.id` also needs
  consistent `Any` packing.
- Medium, performance/reliability: `Stand.update()` reads previous state before
  every write even when no same-tenant subscriber can observe it.
- Medium, performance/reliability: the mutable `Subscription` returned by
  `Subscribe` is the same object stored for activation, allowing in-process
  callers to mutate topic/tenant data before activation.
- Low, performance/reliability: malformed field masks with leading or trailing
  dots are normalized instead of rejected.
- Medium, security: malformed `Any` values for message-typed field filters can
  survive failed schema unpacking and be compared under the wrong schema.
- Medium, security: broad top-level or nested composite filter arrays are copied
  before the configured composite limit rejects them.
- Low, security: subscription field-filter paths need component and string-size
  bounds before schema walking.

### Final Post-Review Fix Pass

- Final fix worker `019f4415-98b7-7fa0-8214-f0c9e394366b` accepted all final
  post-review findings and applied a
  narrow service/Stand/test update: remove redundant primitive comparison code,
  replace malformed object-ID coverage with supported behavior, decode
  subscription ID filters with entity ID field schema metadata, always pack
  delivered update IDs as `Any`, reject malformed field masks and oversized
  field-filter paths before attachment, validate message-typed field criteria
  against the leaf schema, avoid Stand previous-state reads unless same-tenant
  subscribers exist, and store clone-isolated inactive subscription records.
- Fix pass completed with focused tests for message-typed ID filter matching,
  delivered update ID packing, malformed ID filter rejection, wrong-type Any
  field criteria, field-mask/path bounds, clone-isolated activation behavior,
  top-level composite breadth rejection, and Stand previous-state read
  avoidance.
- Verification recorded in the work log: changed-behavior targeted test
  selection passed with 11 tests, lint/typecheck passed, format check passed
  after formatting the two touched TypeScript files, and `git diff --check`
  passed. The full focused Stand/service sandbox run typechecked and passed 88
  tests but could not complete the 19 localhost transport tests because the
  sandbox rejects `listen 127.0.0.1`; the requested outside-sandbox rerun was
  rejected by the approval reviewer.
- Coordinator reran the full focused Stand/service suite outside the sandbox
  after the user explicitly allowed local loopback tests; it passed with 2 files
  and 107 tests.
- Coordinator closed final fix worker
  `019f4415-98b7-7fa0-8214-f0c9e394366b` after recording its result.

### Final Re-Review Round

| Lane                       | Reviewer ID                            | Status | Result   |
| -------------------------- | -------------------------------------- | ------ | -------- |
| Code style/maintainability | `019f4420-45ee-7290-baa0-86e6649ee1b7` | Closed | CLEAN    |
| Documentation completeness | `019f4420-62df-79e3-8c58-a63d71fed1d8` | Closed | FINDINGS |
| TypeScript/API docs        | `019f4420-7b21-7a91-af61-5661e230f28a` | Closed | CLEAN    |
| Security                   | `019f4420-95c3-7ed2-8e21-c8b97e119ba0` | Closed | FINDINGS |
| Performance/reliability    | `019f4420-ad1a-7990-b8a2-754969ce2f84` | Closed | FINDINGS |

### Final Re-Review Findings

- Medium, documentation completeness: final fix worker ID and closure were
  missing from this review log.
- Low, documentation completeness: status and final fix wording still read as
  if the previous fix pass were pending.
- Medium, security and Low, performance/reliability: `createEntityUpdate()`
  embeds `record.subscription` by reference, letting an in-process activation
  iterator consumer mutate the stored subscription metadata echoed by later
  updates. Clone the stored subscription per delivered update and add a
  regression test.

### Final Re-Review Fix Pass

- Final re-review fix worker `019f4424-1327-7fa1-8988-955e88c3cad3` accepted
  the remaining findings and was closed by the coordinator after reporting its
  result.
- `createEntityUpdate()` now clones the stored subscription into each
  `SubscriptionUpdate`, preventing consumers of one delivered update from
  mutating stored subscription metadata used by later deliveries.
- Added a regression test that mutates the first delivered update's
  subscription metadata and verifies the next delivered update still reports the
  original subscription ID and topic.
- Verification recorded in the work log: focused regression passed with 1 file,
  1 test, and 83 skipped; lint/typecheck passed; format check passed; and
  `git diff --check` passed.

### Targeted Re-Review Round

| Lane                       | Reviewer ID                            | Status | Result   |
| -------------------------- | -------------------------------------- | ------ | -------- |
| Documentation completeness | `019f4427-4905-7e40-a14f-0b186c37604c` | Closed | CLEAN    |
| Security                   | `019f4427-5ef8-7612-b903-fea0680dc767` | Closed | FINDINGS |
| Performance/reliability    | `019f4427-76f5-77a3-a463-d92ee14ccc38` | Closed | CLEAN    |

### Targeted Re-Review Finding

- Medium, security: the delivered-subscription mutation regression test
  replaced the `subscription` field on the delivered update instead of mutating
  through the echoed subscription object, so it would not fail against the
  original aliasing bug.

### Targeted Test Fix

- Strengthened the regression test to mutate
  `firstUpdate.subscription.id.value` and `firstUpdate.subscription.topic`
  before asserting the next update still reports the original subscription
  metadata.
- Final targeted security re-review
  `019f4429-357c-71f1-9f39-c90301adea80` reported CLEAN and was closed by the
  coordinator.

## Review Policy

- Every formal reviewer lane must be run by a separate sub-agent.
- Findings must be fed back to an authoring/fix sub-agent.
- Re-review continues until all lanes are clean before integration.
- All participating sub-agents must be closed after their result is recorded.
