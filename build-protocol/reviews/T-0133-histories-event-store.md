# T-0133 Review Log

Status: Clean; all required concerns resolved

## Planned Concerns

- Style/maintainability: existing reviewer at explicit `gpt-5.6-terra` /
  `high`.
- TypeScript/API docs: existing reviewer at explicit `gpt-5.6-terra` / `high`.
- Performance/reliability: existing reviewer at explicit `gpt-5.6-terra` /
  `high`.
- Documentation: existing immutable reviewer at `gpt-5.6-luna` / `medium` if
  public storage-group claims change; otherwise a concrete N/A disposition.
- Security: N/A unless a trust boundary appears.

Actual runtime metadata will be recorded when exposed. Otherwise, the immutable
configured role/profile and the desktop surface's lack of independent runtime
self-introspection are the accepted metadata evidence.

## Review Wave 1 Dispatch

- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  dispatched at its immutable `gpt-5.6-terra` / `high` profile.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, explicitly
  dispatched at its immutable `gpt-5.6-terra` / `high` profile.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicitly dispatched at its immutable `gpt-5.6-terra` / `high` profile.
- Documentation: existing `documentation_reviewer`, explicitly dispatched at
  its immutable `gpt-5.6-luna` / `medium` profile because the public
  `StorageGroup` contract and package docs changed.
- Security: N/A. The task changes local/provider persistence structure and
  in-process coordination but introduces no new authentication, authorization,
  secret, remote-input, or deployment trust boundary.

The desktop dispatch endpoint rejected `gpt-5.6-luna` as an explicit generic
model argument even though the existing `documentation_reviewer` role is
immutably configured to Luna/medium. The orchestrator therefore dispatches
that existing fixed role with explicit `medium` reasoning and records the
surface limitation; no Terra substitution or inherited default is accepted.

## Review Wave 1 Findings

- Style/maintainability (`gpt-5.6-terra` / `high`): requested restoration of
  the current-query and event-history provider conformance checks, plus a
  mechanical history-spec formatting correction.
- TypeScript/API (`gpt-5.6-terra` / `high`): requested provider-only exports of
  the canonical history RecordSpec builders and deletion of the obsolete
  `EntityStorageKey` / `EntityRecordPurpose` SPI.
- Performance/reliability (`gpt-5.6-terra` / `high`): found that whole-map
  publication was serialized only by Entity ID, allowing concurrent commits
  for different IDs to erase each other; also requested shared serialization
  for direct history appends and bounded history selection/maintenance.
- Documentation (`gpt-5.6-luna` / `medium`): requested a self-contained
  beginner example for `StorageGroup` in the storage README.
- Security: N/A for the unchanged reason recorded above.

The desktop surface exposed no independent runtime-model introspection for any
reviewer. The immutable configured profiles above are the available runtime
metadata; no visible mismatch or fallback occurred.

## Correction Batch Dispatch

One existing `implementer` owns the consolidated correction batch so that the
shared storage coordination, conformance suite, provider SPI, and documentation
remain one coherent change. The expected profile is explicitly
`gpt-5.6-terra` / `medium`. The owner must add behavior-focused race and bounded
selection tests before implementation changes, preserve the generated-record
layouts, and avoid later provider migrations.

## Review Wave 2 Findings

- Reliability accepted the shared Entity mutation serialization and direct
  append race fixes, but found that the finite 10,000-row selection cap changed
  `backward`, `stateAt`, `trim`, and `truncate` semantics because traversal did
  not continue across pages. It also found state-history `truncate` outside the
  shared mutation FIFO.
- TypeScript/API accepted the corrected provider-only exports and deleted stale
  key SPI, but found the `StorageFactory` backing-identity contract omitted the
  `StorageGroup` and the README used incompatible history families as a
  same-layout example.
- Style/maintainability found that the reusable conformance `check()` no longer
  included current-query checks and that focused changed-file ESLint reported
  30 errors.
- Documentation confirmed the formerly undefined README variables are fixed,
  but independently confirmed the incompatible-family example is inaccurate.

All reviewers ran at their previously recorded fixed profiles. Independent
runtime-model introspection remained unavailable and no mismatch or fallback
was visible.

The same existing `implementer` receives one final correction batch at the
explicitly recorded `gpt-5.6-terra` / `medium` profile. Re-review will reopen
only the reliability, API, style, and documentation concerns changed by this
batch.

The original correction owner then stopped twice without a technical blocker
before implementing exact bounded paging or clearing focused ESLint. A fresh
existing `implementer` now owns only that unfinished correction slice while
preserving every prior edit. Its expected profile is explicitly
`gpt-5.6-terra` / `medium`; the same runtime-metadata acceptance rule applies.

## Review Wave 3 Findings

- Reliability and style accepted exact page continuation and shared-FIFO
  correctness, but found that the paging helper still accumulated every page
  in one array. Reads must stop when sufficient and maintenance must process
  bounded page/chunk windows without retaining the whole history. Tie-boundary
  page regressions are also required.
- Style additionally found leaked conformance handles and 13 ESLint findings in
  changed server files outside the earlier storage-only lint selection.
- TypeScript/API accepted the provider SPI and README corrections, but found
  stale canonical API documentation for removed `RecordSpec.storageKey` and a
  missing `StorageGroup` root-export inventory entry.
- Documentation re-review is clean; no P0-P2 finding remains in that lane.

The paging implementer receives this final consolidated batch at the explicitly
recorded `gpt-5.6-terra` / `medium` profile. Documentation stays closed unless
the correction changes human-facing package prose.

## Review Wave 4 Findings

- Reliability accepted streaming keyset continuation and FIFO correctness, but
  found that the in-memory provider still materialized and sorted every match
  before applying a page limit. The provider selection algorithm must retain at
  most the requested bounded result window.
- Style confirmed full changed-file ESLint and handle closure, with one
  mechanical indentation issue in the conformance fixture.
- TypeScript/API found the canonical API guide still contained the removed
  storage-key/fingerprint contract even though the exact root-export inventory
  now included `StorageGroup`. Durable Datastore and RDBMS implementations of
  the new group argument remain explicit stacked-train release blockers owned
  by T-0134 and T-0135; they are not accepted as T-0133 compatibility shims.

A fresh existing `implementer` owns this final narrow core correction at the
explicitly recorded `gpt-5.6-terra` / `medium` profile. The runtime-metadata
acceptance rule is unchanged.

## Correction Batch Evidence

- The existing implementer ran at the explicitly configured `gpt-5.6-terra` /
  `medium` profile. Independent runtime-model introspection is not exposed;
  configured profile metadata is the available evidence and no mismatch was
  visible.
- RED evidence: three focused regressions failed before the correction: two
  concurrent commits for different Entity IDs lost one current/history publish;
  a direct event-history append was erased by a concurrent commit; and two
  divergent same-Event-ID appends both succeeded.
- GREEN evidence: focused storage tests passed 3 files / 36 tests, and storage
  TypeScript compilation passed.
- The coverage-enabled `verify:task` profile is blocked before focused tests by
  the recorded downstream integration build inventory: legacy
  `RecordSpec.schema` callers, un-migrated Datastore/RDBMS history adapters
  still using removed DTO/receipt APIs, checked-in declarations, and two
  examples. Those paths are assigned later migrations and were unchanged.

## Final Paging And Lint Correction Evidence

- The exact paging correction preserves the shared Entity FIFO for all of state
  truncate and uses finite stable keyset pages without a semantic 10,000-row
  cap. Two-row regression seams cover state/event continuation, `stateAt`,
  trim, both truncates, and deterministic truncate-versus-commit ordering.
- Full changed-storage-file ESLint, package TSDoc, documentation-audience
  check, changed-file Prettier, `git diff --check`, and storage TypeScript all
  pass. The focused suite passes 4 files / 52 tests.
- Focused coverage executed those 52 tests and reports the changed history
  adapter at 95.91% statements / 96.37% lines. Its nonzero process status is
  limited to the unrelated repository-global 90% threshold (3.87% whole-tree
  denominator), not a test assertion or changed-source coverage deficiency.

## Review Wave 4 Final Correction Evidence

- The final bounded-provider correction was completed by the existing
  `implementer` at the explicitly configured `gpt-5.6-terra` / `medium`
  profile. Independent runtime-model introspection remains unavailable on this
  surface; configured profile metadata is the accepted evidence, with no
  visible mismatch or fallback.
- Reliability finding resolved: finite in-memory queries no longer materialize
  and sort every match. A behavior regression first failed on a 128-row tied
  set after it detected sorting all 111 continued candidates; the provider now
  retains only the stable top `offset + limit` selection and returns the exact
  continued, offset page. Existing filters, continuation semantics, canonical
  ID tie ordering, masks, candidate limits, and unbounded queries are retained.
- Style finding resolved: corrected the indentation under the existing
  `prettier-ignore` in `checkCurrentQueries`. Exact changed-TypeScript ESLint
  passes.
- TypeScript/API finding resolved: the API guide now lists `StorageGroup` and
  `createRecordStorage(context, spec, group?)`, explains source type plus
  optional group identity and same-group backing requirements, and removes
  obsolete `RecordSpec.storageKey`, layout-fingerprint, and purpose-key claims.
  The existing `scripts/check-api-docs.mjs` `StorageGroup` root-export inventory
  entry remains present.
- Documentation disposition: no new claim is made for durable providers. The
  existing integration inventory still blocks audience/API-check completion
  with 151 unowned errors. Datastore group identity is a stacked T-0134 release
  blocker; RDBMS group identity is a stacked T-0135 release blocker.
- Evidence: focused TenantRecords/history/commit/provider/Event Store tests pass
  5 files / 92 tests; storage TypeScript, exact changed-file ESLint, TSDoc,
  Prettier, `git diff --check`, and full documentation TypeScript snippets pass.
  Focused coverage ran the same tests;
  `memory/tenant-records.ts` reached 95.09% statements / 95.78% lines. The
  coverage process status is limited to the existing global 90% denominator
  threshold (4.81% statements across the untouched monorepo).

## Event Tie Paging Final Correction Evidence

- The existing `implementer` completed the correction under the explicitly
  configured `gpt-5.6-terra` / `medium` profile. The surface does not expose
  independent runtime-model introspection; configured metadata is the available
  evidence, with no visible mismatch or fallback.
- Reliability finding resolved: event-history page order and final result order
  now share canonical UTF-8 Event ID ordering. The provider compares storage
  slot identities and explicit `id` sort/continuation fields canonically, while
  preserving existing code-unit ordering for ordinary string record columns and
  paths. Event history supplies explicit descending ID paging after descending
  version and creation fields, matching its final descending canonical order.
- RED/GREEN evidence: a page-size-two, equal-version/equal-timestamp history
  returned U+10000 for depth one before the change instead of U+10001; a tied
  RecordStorage continuation after U+E000 returned no non-BMP records. Both
  pass after the correction, alongside existing page continuation coverage.
- Style/docs: removed the dangling API-guide sentence fragment. Focused
  TenantRecords/history/commit/provider/Event Store tests pass 5 files / 94
  tests; storage TypeScript, exact changed-file ESLint, Prettier, and
  `git diff --check` pass. Focused coverage reports `tenant-records.ts` at
  92.88% statements / 94.63% lines; its process status is limited to the
  unchanged global 90% monorepo threshold (4.98% statements overall).

## Canonical UTF-8 Utility Mechanical Correction

- The existing `implementer` completed this P2-only refactor under the
  explicitly configured `gpt-5.6-terra` / `medium` profile. Independent runtime
  model introspection remains unavailable; configured metadata is the accepted
  evidence, with no visible mismatch or fallback.
- One TSDoc-documented internal `CanonicalUtf8` utility now owns the canonical
  byte encoding and comparison used by both tenant record selection and event
  history. The former duplicated hand-rolled encoders/comparators are removed;
  behavior and public API are unchanged.
- Evidence: focused TenantRecords/history/commit/provider/Event Store tests pass
  5 files / 94 tests; storage TypeScript, exact changed-file ESLint, Prettier,
  and `git diff --check` pass. Focused coverage reports the new utility at
  96.15% statements / 100% lines; its nonzero process status is limited to the
  existing global 90% monorepo denominator (4.91% statements overall).

## Final Disposition

- Style/maintainability: clean after the shared canonical UTF-8 utility
  correction.
- TypeScript/API docs: clean for T-0133. Durable provider adoption of
  `StorageGroup` remains assigned to T-0134 and T-0135.
- Performance/reliability: clean after bounded provider selection, streaming
  history paging, shared mutation serialization, and canonical tie-order
  corrections.
- Documentation: clean.
- Security: N/A; no trust boundary changed.

Closure preflight passed 95 focused tests, storage TypeScript, exact
changed-file ESLint, 49 Proto source checksums, documentation snippets, TSDoc,
Prettier, and `git diff --check`. The single coverage-enabled `verify:task`
invocation generated and verified Proto sources, then stopped in the approved
integration-train compilation inventory: legacy server/deployment
`RecordSpec.schema` callers, Datastore and RDBMS history/layout consumers owned
by T-0134/T-0135, stale provider declarations, and two later Message Board
records. No T-0133-local failure appeared before that stop.
