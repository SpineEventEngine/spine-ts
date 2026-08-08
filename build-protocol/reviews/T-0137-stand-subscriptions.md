# T-0137 Review Record

Status: Implementation evidence in progress; review not yet requested.

## Required Concerns

- Documentation: required.
- TypeScript/API documentation: required.
- Performance/reliability: required.
- Style/maintainability: required.
- Security: N/A unless the implementation introduces a trust, credential, or
  authorization boundary.

## Specialist Review Dispatch

- Documentation: existing `documentation_reviewer`, explicitly dispatched as
  `gpt-5.6-luna` / `medium`.
- TypeScript/API documentation: existing `typescript_api_docs_reviewer`,
  explicitly dispatched as `gpt-5.6-terra` / `high`.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicitly dispatched as `gpt-5.6-terra` / `high`.
- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  dispatched as `gpt-5.6-terra` / `high`.
- Runtime self-introspection will be recorded when exposed. Otherwise the
  immutable configured role/profile and that limitation are the accepted
  metadata unless a visible mismatch or fallback occurs.

## Continuation Evidence

- Existing role: `implementer`; explicitly dispatched `gpt-5.6-terra` /
  `medium`. Runtime self-introspection is unavailable; immutable configured
  role/profile is the available metadata and no fallback is visible.
- Provider conformance now proves `StorageSubscriptionRegistry` selects a
  configured MySQL `SubscriptionRecordSchema` table and configured Datastore
  `SubscriptionRecordSchema` storage while exercising create/get/delete.
- Focused result: `pnpm exec vitest run
packages/server/test/stand/subscription-registry-provider-conformance.test.ts`
  passes (2/2).
- Security remains N/A: this slice changes no credential, authorization, or
  trust boundary. The MySQL URL in the test is a non-secret example hostname.
- Known downstream limitation: six unowned composite server
  `RecordSpec.schema` migration failures remain in later Wave 8 consumers;
  they do not originate in the T-0137 Stand files.

## Mechanical Pre-Review Disposition

- Not review-ready. Scoped coverage from the 16 focused Stand tests is below
  the required 90% in every metric: 70.09% statements, 60.52% branches, 70.12%
  functions, and 74.41% lines across the three changed T-0137 runtime sources.
- Not review-ready. Existing T-0137 runtime code has twelve focused ESLint
  findings in `subscription-registry.ts`, two in `subscription-runtime.ts`, and
  missing required TSDoc for the public registry contract. These are owned
  correction work, not reviewer findings.
- `verify:task` passes Node and Proto generation but stops in TypeScript at the
  six known unowned server `RecordSpec.schema` consumers. It also exposes four
  unowned example migrations (retired Datastore API in Orders and Message
  Board). No frozen-scope file was changed to address them.
- Passing deterministic evidence: provider test 2/2; all focused Stand tests
  16/16; provider-test ESLint; Buf lint; current generated-output cleanliness;
  Prettier on continuation files; and `git diff --check`.

## Review Wave One

- Documentation (`documentation_reviewer`, explicit `gpt-5.6-luna` /
  `medium`; runtime self-introspection unavailable, no visible fallback): one
  P2. The server README incorrectly calls the complete identifier-sorted
  registry snapshot bounded.
- TypeScript/API documentation (`typescript_api_docs_reviewer`, explicit
  `gpt-5.6-terra` / `high`; runtime self-introspection unavailable, no visible
  fallback): five P1 and one overlapping P2. Correct the physical column name
  to `when_activation_expires`; make lifecycle entries a real pending/active
  discriminated union; remove the deleted private Proto from the frozen-record
  test and incremental package output; update the API-doc export inventory;
  and correct the README wording.
- Performance/reliability (`performance_reliability_reviewer`, explicit
  `gpt-5.6-terra` / `high`; runtime self-introspection unavailable, no visible
  fallback): three P1 and two P2. Restore Protobuf-safe subscription equality;
  include subscription contents in attachment identity; enforce the exact
  25-plus-one cleanup bound and ordering at the provider; validate cleanup
  rows; and add restart/polling persistence coverage.
- Style/maintainability (`style_maintainability_reviewer`, explicit
  `gpt-5.6-terra` / `high`; runtime self-introspection unavailable, no visible
  fallback): two P1, overlapping the equality and bounded-cleanup findings.
  No additional style, naming, helper-placement, TSDoc, or obsolete-protocol
  findings.
- Security: N/A. The task changes no credential, authorization, trust, or
  secret-handling boundary.
- Disposition: one consolidated correction batch returns to the implementation
  context. Documentation, API, reliability, and maintainability are re-reviewed
  after the substantive corrections; security remains N/A.

## Review Wave Two

- Reliability re-review is clean. All prior equality, attachment identity,
  bounded cleanup, malformed-row, restart/polling, and lifecycle findings are
  resolved.
- API re-review confirms every prior functional/API P1 is resolved. It finds
  two TSDoc layout issues: lifecycle union members and the Proto workflow
  cleanup helper.
- Documentation re-review confirms the snapshot contradiction is resolved and
  requests exact provider-column and cleanup-order/lookahead details.
- Maintainability re-review finds no remaining P0/P1 runtime issue. Its final
  P2 batch relocates orphaned lifecycle docs and strengthens integration tests
  for bigint-containing Protobuf equality, cleanup filter/row validation, and
  generation-driven stale-output cleanup.
- Disposition: one deterministic documentation/test correction batch, followed
  by focused re-review only of documentation, API docs, and maintainability.

## Final Disposition

- Performance/reliability: clean after Wave One corrections.
- TypeScript/API documentation: clean after Wave Two corrections.
- Style/maintainability: clean after Wave Two corrections.
- Documentation: the final re-review found only a duplicate use of “bounded”
  for an unbounded complete snapshot; the deterministic wording correction was
  applied and mechanically checked without reopening another substantive
  review wave.
- Security: N/A for the recorded no-boundary-change reason.
- All specialist findings are resolved. The six later-consumer
  `RecordSpec.schema` errors and inherited T-0134 MySQL TSDoc findings remain
  integration-train inventory rather than T-0137 findings.

## Consolidated Correction Evidence (in progress)

- RED/GREEN provider and contract tests prove the exact physical
  `when_activation_expires` column and absence of the deleted private source.
  A Proto-workflow regression creates all stale private generated paths and
  proves the deterministic publication cleanup removes them.
- The implementation now uses a true pending/active discriminated entry union,
  canonical Protobuf-byte subscription equality, subscription-content plus
  creation-time attachment identity, and exact 25-plus-one cleanup selection.
  The provider query has limit 26, expiry/ID ordering, record validation, and
  an expired-only lookahead result; in-memory selection mirrors the bound.
- Focused run: 103 tests pass; scoped changed-source coverage is 97.03%
  statements, 92.94% branches, 97.64% functions, and 97.95% lines; and
  `pnpm proto:generate` passes. Direct server typecheck shows only the six
  recorded later-consumer migrations. The added end-to-end durable restart/poll
  and same-millisecond replacement cases pass; scoped coverage, exact lint,
  Prettier, and diff checks are green. This correction is ready for the four
  affected review concerns; security remains N/A.

## Wave Two Deterministic Correction

- TSDoc ownership is clean under the project checker; its only remaining
  diagnostics are the recorded unrelated T-0134 MySQL files. The final
  behavior tests cover bigint-safe canonical duplicate creation, cleanup filter
  and malformed-row validation, and connected post-publication stale-output
  removal through `generateTargets()`.
- Final correction evidence: 149 focused tests pass with 97.03% statements,
  92.94% branches, 97.64% functions, and 97.95% lines. Exact owned ESLint,
  Prettier, diff, and Proto generation checks pass. The correction is ready
  for the affected Wave Two review concerns.

## TSDoc And Stand-Test Lint Correction

- The owned registry public-contract TSDoc and mirrored Stand-test lint defects
  are resolved. The exact TSDoc source filter, ESLint on `stand.test.ts`,
  Prettier on the corrected files, and `git diff --check` pass.
- This record does not change the separate coverage disposition; coverage will
  be remeasured in its own behavior-test correction batch.

## Final Changed-Source Coverage Correction

- Existing implementer assignment remains explicitly `gpt-5.6-terra` /
  `medium`. Runtime self-introspection is unavailable; the immutable configured
  role/profile remains the available metadata and no fallback is visible.
- Public StorageFactory-seam tests now cover rejected non-atomic storage,
  CAS-false retries, CAS-error rereads (absent, conflicting, and matching),
  malformed stored records, and codec guard behavior without private-state
  assertions or production changes.
- Exact focused changed-source coverage passes 80/80 tests: 96.86% statements,
  93.08% branches, 97.43% functions, and 98.52% lines. The coverage gate is
  now review-ready; known downstream composite TypeScript failures remain
  unowned and unchanged.

## Deterministic Verification Correction

- The requested owned Prettier/import/`require-await` corrections are complete.
  Exact scoped coverage remains 80/80 and above 90% in every metric (96.86%
  statements, 93.08% branches, 97.43% functions, 97.84% lines); Prettier and
  diff checks pass.
- Exact changed-file ESLint has no owned T-0137 finding. Its only remaining 11
  diagnostics are error-typed cascades in `bounded-context.test.ts` from the
  six deferred downstream `RecordSpec.schema` migrations. Excluding that
  inherited cascade, the exact owned file set is ESLint-clean.
- Global `lint:tsdoc` has 11 inherited committed T-0134 MySQL diagnostics in
  `packages/storage-rdbms/src/mysql/{testing,errors,scope}.ts`. This batch did
  not edit those files.

## Exact-Optional Entry Narrowing Correction

- RED server TypeScript inventory contained three owned TS2379 narrowing errors
  in `expiresAt()` in addition to the six deferred downstream migrations.
  GREEN inventory contains only those six downstream migrations after making
  `expiresAt()` validate the public entry contract directly, without a cast or
  assertion. The retained public expiry-boundary test passes 29/29.
- Exact focused coverage passes 80/80: 96.86% statements, 93.16% branches,
  97.43% functions, and 97.49% lines. Owned ESLint subset, Prettier, and
  `git diff --check` pass; the complete lint's only findings remain the 11
  inherited typed cascades in `bounded-context.test.ts`.
