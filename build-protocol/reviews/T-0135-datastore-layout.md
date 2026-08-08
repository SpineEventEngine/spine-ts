# T-0135 Review Log

Status: Review wave in progress

## Planned Concerns

- Style/maintainability: existing reviewer, explicit `gpt-5.6-terra` / `high`.
- TypeScript/API docs: existing reviewer, explicit `gpt-5.6-terra` / `high`.
- Performance/reliability: existing reviewer, explicit `gpt-5.6-terra` / `high`.
- Documentation: existing fixed `gpt-5.6-luna` / `medium`.
- Security: N/A unless implementation adds a trust, credential, or deployment
  boundary.

Runtime metadata will be recorded when exposed. Otherwise, immutable configured
profiles and the desktop surface's lack of independent runtime introspection
are the accepted evidence.

## 2026-08-08 Review Wave Dispatch

- Style/maintainability: existing `style_maintainability_reviewer`, explicit
  `gpt-5.6-terra` / `high`.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, explicit
  `gpt-5.6-terra` / `high`.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicit `gpt-5.6-terra` / `high`.
- Documentation: existing `documentation_reviewer`, immutable configured
  `gpt-5.6-luna` / `medium`.
- Security: N/A. The task changes a storage provider implementation but adds no
  credential handling, trust boundary, deployment surface, or authorization
  decision.
- Every dispatch is concern-specific, read-only, and forbids subagents, edits,
  commits, pushes, merges, JVM work, and architecture rediscovery.

## 2026-08-08 Review Wave Results

All reviewers completed under the explicitly dispatched existing roles. The
desktop surface exposed no independent runtime self-introspection; no configured
profile mismatch or fallback was visible.

### Style/Maintainability — Changes Requested

- P1: registration identity/precedence is wrong for ungrouped and grouped
  families, duplicated in two resolver paths, and custom-kind collisions are
  accepted.
- P1: transactional Entity saves omit `excludeFromIndexes: ["bytes"]`.
- P2: large standalone helper collections and the long commit method violate
  the project type-owned structure rule.
- P2: one duplicate TSDoc block and two lines over 120 columns remain.

### TypeScript/API Docs — Changes Requested

- P1: the factory constructor remains public despite the frozen builder-only
  contract.
- P1: registration keys cannot address generated grouped Entity families.
- P1: distinct registrations may claim the same explicit kind.
- P1: `scripts/check-api-docs.mjs` retains removed exports and omits new ones.
- P2: no compile-consumer test freezes builder overloads and creator aliases;
  callback parameter naming also differs from the frozen declaration.

### Performance/Reliability — Changes Requested

- P0: transactional Entity payloads are indexed.
- P0: direct and duplicate-input immutable histories can overwrite divergent
  content.
- P0: `stateAt()` and `trim()` are incorrect beyond 1,000 retained states.
- P1: history queries/maintenance materialize complete families locally instead
  of provider-filtered bounded pages.
- P1: grouped Entity registration resolution is broken.
- P1: timestamp columns use generic canonical JSON rather than the required
  order-preserving seconds/nanos representation.
- P1: commit current/history rows are not validated against `entityId`.
- P2: ordinary provider errors can surface unsanitized details.

### Documentation — Changes Requested

- P1: README overstates offset/limit pushdown.
- P1: USER_GUIDE uses a nonexistent example model import.
- P1: README's user-guide fragment is broken.
- P2: REFERENCE claims a caller-supplied candidate bound/error that the adapter
  does not expose.
- P2: README overstates write atomicity without qualifying `writeAll()`.

### Security — N/A

No credential, trust, authorization, or deployment boundary was added. Error
redaction remains a reliability/API correction within the provider boundary.

## Consolidated Correction Dispatch

- One existing `implementer`, explicitly `gpt-5.6-terra` / `medium`, receives
  the complete accepted finding batch. It owns all overlapping Datastore
  production/tests/docs/tooling until convergence; no parallel package writer
  is permitted.
- Re-review is required for all four changed concerns because the batch affects
  architecture shape, API declarations, persistence/concurrency, and docs.

## 2026-08-08 Focused Re-review Dispatch

- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  dispatched as `gpt-5.6-terra` / `high`.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, explicitly
  dispatched as `gpt-5.6-terra` / `high`.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicitly dispatched as `gpt-5.6-terra` / `high`.
- Documentation: existing `documentation_reviewer`, immutable configured
  `gpt-5.6-luna` / `medium`; it will be dispatched when a reviewer slot is
  available.
- Runtime self-introspection is not exposed by the desktop surface. The
  immutable configured role/profile is accepted unless a visible mismatch or
  fallback occurs. Each reviewer is read-only and must not spawn subagents.
- The API checker was initially blocked after package convergence by eleven
  stacked downstream callers of the removed `RecordSpec.schema` contract. The
  final task profile reports the complete sixteen-error downstream inventory
  described below; none is a T-0135 package-contract failure.

### Style/Maintainability Re-review — Changes Requested

- No P0 finding. The immutable configured reviewer profile was
  `style_maintainability_reviewer`, `gpt-5.6-terra` / `high`; runtime
  self-introspection was unavailable and no mismatch or fallback was visible.
- P1: record-only lookup, grouped/exact identity, and explicit-kind collision
  rules remain incorrect; ordinary and Entity resolver logic is duplicated.
- P2: the Entity commit method remains oversized, helper ownership is diffuse,
  one duplicate TSDoc block remains, and two production lines exceed 120
  columns.

### TypeScript/API Re-review — Changes Requested

- No P0 finding. The immutable configured reviewer profile was
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / `high`; runtime
  self-introspection was unavailable and no mismatch or fallback was visible.
- P1: the public constructor still bypasses the frozen builder-only contract;
  record-only resolution and explicit-kind collision rules remain incorrect.
- P1: `scripts/check-api-docs.mjs` still expects removed Datastore exports and
  omits the new builder, layout, and creator contracts.
- P2: no external compile-consumer test freezes the overloads/aliases, and the
  callback parameter name differs from the frozen declaration.
- Clean: paging remains package-private and the downstream consumer errors are
  stacked integration inventory.

### Performance/Reliability Re-review — Changes Requested

- No P0 finding. The immutable configured reviewer profile was
  `performance_reliability_reviewer`, `gpt-5.6-terra` / `high`; runtime
  self-introspection was unavailable and no mismatch or fallback was visible.
- P1: explicit custom-kind collisions remain accepted.
- P1: a provider page that reports more rows without a valid continuation can
  silently truncate history work. The frozen explicit keyset-continuation
  invariant and its mutation-safe regression are still absent.
- P2: provider errors outside compare-and-set, including Entity transaction
  failures, still expose raw provider detail.
- Clean: transaction payload exclusion, immutable collision protection,
  ordered three-attempt ABORTED retry, Entity-ID validation, fixed-width
  timestamp encoding, bounded page size, and closure behavior are present.

### Documentation Re-review — Changes Requested

- The immutable configured reviewer profile was `documentation_reviewer`,
  `gpt-5.6-luna` / `medium`; runtime self-introspection was unavailable and no
  mismatch or fallback was visible.
- P1: README overclaims offset/limit pushdown, links a broken guide anchor, and
  names the diagnostic-history kind incorrectly.
- P1: USER_GUIDE imports a nonexistent example model package.
- P2: README overclaims transactional atomicity for ordinary writes/batches.
- The shared candidate-bound description is accurate and remains unchanged.

## Consolidated Re-review Correction Dispatch

- One existing `implementer` is explicitly dispatched as
  `gpt-5.6-terra` / `medium` with sole ownership of the Datastore adapter,
  tests, public API checker, documentation, and T-0135 records until the full
  accepted finding batch converges.
- The batch includes resolver/collision correctness, builder-only declarations,
  API inventory and compile-consumer coverage, mutation-safe explicit keyset
  continuation and malformed-provider fail-closed behavior, provider error
  sanitization, maintainability cleanup, and all confirmed documentation
  corrections.
- Runtime self-introspection is unavailable; the immutable configured profile
  is accepted unless a visible mismatch or fallback occurs. The implementer
  must not spawn subagents, commit, push, merge, edit JVM code, or modify
  downstream integration consumers.

## 2026-08-08 Final Re-review Dispatch

- After independent green TypeScript, 70-test unit, 4-test emulator, lint,
  formatting, docs, and package coverage gates, all substantively affected
  concerns are re-dispatched once more.
- Style/maintainability: existing `style_maintainability_reviewer`, explicit
  `gpt-5.6-terra` / `high`.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, explicit
  `gpt-5.6-terra` / `high`.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicit `gpt-5.6-terra` / `high`.
- Documentation: existing `documentation_reviewer`, immutable configured
  `gpt-5.6-luna` / `medium`.
- Runtime self-introspection remains unavailable; the immutable configured
  role/profile is accepted unless a visible mismatch or fallback occurs. Each
  reviewer is read-only and must not spawn subagents.

## 2026-08-08 Final Re-review Results

- Documentation is clean with no P0-P2 findings.
- Style/API retain one P1 resolver defect: grouped exact identity must use the
  storage group, ungrouped record-only fallback must use source/source, and
  grouped record-only fallback must use record/record. API is otherwise clean.
- Reliability found no P0 issue and confirmed bounded explicit keyset paging,
  deletion re-query, atomicity, retries, ID validation, timestamp ordering, and
  lifecycle. Remaining P2 corrections are fail-closed unexpected
  `moreResults` handling and redaction of ordinary provider-operation errors.
- Style P2 cleanup remains for the oversized commit method, anonymous helper
  groupings, duplicate TSDoc, and two overlong production lines.

## Final Bounded Correction Dispatch

- The same existing `implementer` is re-dispatched explicitly as
  `gpt-5.6-terra` / `medium` for only the resolver, malformed-response,
  provider-error, and style corrections above plus focused regressions.
- Runtime self-introspection is unavailable; the immutable configured profile
  remains accepted unless a visible mismatch or fallback occurs. No subagents,
  commits, pushes, merges, JVM work, docs rewrites, or downstream edits are
  permitted.

## Post-correction Release Re-review Dispatch

- Independent gates pass after the bounded correction: 73 unit tests, 4
  emulator tests, package TypeScript/lint/format/diff, and 95.66% statements,
  90.67% branches, 97.63% functions, and 96.19% lines.
- Only substantively changed concerns are re-dispatched: existing
  style/maintainability, TypeScript/API, and performance/reliability reviewers,
  each explicitly `gpt-5.6-terra` / `high`.
- Documentation remains clean and was not substantively changed by this code
  correction, so its clean final disposition remains accepted.
- Runtime self-introspection remains unavailable; immutable configured profiles
  are accepted unless a visible mismatch or fallback occurs. Reviews are
  read-only and may not spawn subagents.

## Post-correction Release Re-review Results

- TypeScript/API is clean: resolver semantics, builder-only API, collision
  rejection, API inventory, compile-consumer contract, and package-private
  paging all pass.
- Reliability has no P0/P1 finding and confirms all corrected persistence,
  paging, retry, redaction, and lifecycle behavior. One P2 remains: CAS may
  rethrow a non-ABORTED provider error containing physical key details.
- Style's repeated resolver P1 is rejected: the frozen grouped-registration
  source is `StorageGroup.name`, exactly as the API and reliability reviewers
  confirmed for diagnostic Event history. The code uses that identity.
- Style P2 remains accepted for the oversized commit method, duplicate TSDoc,
  two overlong lines, and anonymous-class helper organization.

## Release Cleanup Dispatch

- The same existing `implementer`, explicitly `gpt-5.6-terra` / `medium`, owns
  only CAS redaction and deterministic style cleanup with focused regression
  evidence. Runtime self-introspection remains unavailable; the configured
  profile is accepted unless a visible mismatch or fallback occurs.

## Release Cleanup Re-review Dispatch

- Independent final gates pass after CAS redaction and style-only refactoring:
  74 unit tests, 4 emulator tests, all package quality checks, and coverage of
  95.57% statements, 90.49% branches, 97.65% functions, and 96.35% lines.
- Only the affected existing reviewers are re-dispatched: style/maintainability
  and performance/reliability, both explicitly `gpt-5.6-terra` / `high`.
- Runtime self-introspection remains unavailable; immutable configured profiles
  are accepted unless a visible mismatch or fallback occurs. Reviews are
  read-only and may not spawn subagents.

## Consolidated Re-review Correction Result

- Accepted corrections: common grouped/ungrouped resolver and custom-kind
  collision rejection; private builder-only constructor; API inventory and
  compile-consumer contract; explicit 128-row value-plus-key continuation with
  provider AND/OR keyset filters and mutation-safe delete requery; Entity error
  redaction; and documentation corrections.
- The correction owner was explicitly `implementer`, `gpt-5.6-terra` /
  `medium`. Runtime profile self-introspection was unavailable; immutable
  configured metadata is the available evidence and no mismatch/fallback was
  exposed.
- Remaining release limitation is the known downstream migration inventory
  only. No Datastore public API checker finding remains.

## Final Bounded Correction Progress

- Resolver and provider-page parsing re-review findings are corrected with
  focused RED/GREEN evidence. The configured implementation profile remains
  `gpt-5.6-terra` / `medium`; no independent runtime metadata is exposed.
- Final evidence accepts public provider-error redaction, preflight extraction,
  and all package verification. T-0135 owns no remaining reviewer finding;
  only the recorded out-of-scope downstream migration inventory remains.
- Release-cleanup style findings are resolved: the public commit orchestrator
  is bounded, response TSDoc is unique, and the four named frozen helper
  objects replace anonymous class expressions.
- The private transaction runner is likewise split at its prepare/load/conflict/
  immutable/apply seams; no changed method exceeds the 35-line target.

## Final Release Disposition

- Style/maintainability, TypeScript/API, performance/reliability, and
  documentation are clean. Security remains N/A for this provider-layout task.
- Final independent package evidence passes: 74 unit tests, 4 Datastore-mode
  emulator tests, package TypeScript, ESLint, formatting, diff hygiene, and
  coverage of 95.57% statements, 90.49% branches, 97.65% functions, and 96.35%
  lines.
- The selected `verify:task -- --coverage ... --source ...` profile passes Node,
  authored Proto, example Proto, checksum, and frozen-descriptor gates, then
  stops at the deliberately stacked integration boundary with sixteen errors:
  eleven deployment/server `RecordSpec.schema` callers, two Orders callers of
  removed Datastore factory APIs, and three Message Board legacy-spec/factory
  callers. Those consumers belong to subsequent integration tasks; no alias or
  compatibility API is added to T-0135.
