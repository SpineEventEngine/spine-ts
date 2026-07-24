# T-0072 Review Record

## Dispatch metadata

- Implementation role: `implementer`; configured `gpt-5.6-terra`, `medium`.
- Specialist lanes pending orchestration: style/maintainability, documentation,
  TypeScript/API, and performance/reliability. Security remains the final Wave 2 gate.

## Consolidated correction dispositions

| Lane          | Finding                                                                                          | Disposition                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Reliability   | Stand re-read rows after query evaluation, allowing update/delete interleaving to alter results. | Fixed: query entry records are now the result authority and deleted rows are excluded before evaluation order/limit. |
| Reliability   | Memory had unbounded default candidate materialization.                                          | Fixed: 10,000 default and limit-plus-one iteration.                                                                  |
| API           | Descriptor identity omitted selected ID field.                                                   | Fixed: the shared descriptor fingerprint includes the selected local ID field.                                       |
| Style/API     | Residual internal projection-column names remained after the public rename.                      | Fixed in entity-column construction and generator names.                                                             |
| Documentation | Generic-query/package wording lagged the all-three-kind behavior.                                | Updated in the T-0072 closure pass; API docs are mechanically checked.                                               |

## Mechanical evidence

- Focused service request-path evidence passed for all registered families:
  `spine-services.test.ts` passed 156 tests over the real local gRPC transport.
  The sandbox denies loopback binds, so this one suite was rerun with approved
  local loopback access; no network service outside the test process was used.
- Current-storage provider parity passed in focused memory, Datastore, and MySQL
  suites, including lifecycle/version and bounded-candidate checks.
- `typecheck:generated`, `lint:generated`, `format:check`, API docs, generated
  proto cleanliness, and whitespace diff checks are recorded as the final
  mechanical gate for this implementation package.

## Specialist outcomes

The Desktop surface exposes configured role/profile and explicit dispatch
metadata but no independent child runtime self-introspection.

- Style/maintainability — existing `style_maintainability_reviewer`, explicitly
  dispatched `gpt-5.6-terra` / `high`: **CLEAN** after correction. Stand uses
  authoritative query entries and one result mapper; provider tombstone policy
  is consistent before bounds/order/limit; Entity terminology and mirrored test
  paths are clean; no legacy index or transitional optional SPI remains.
- TypeScript/API — existing `typescript_api_docs_reviewer`, explicitly
  dispatched `gpt-5.6-terra` / `high`: **CLEAN** after correction. Root and
  `./codegen` exports/declarations, TypeDoc inventory, executable and Buf
  references, required storage SPI, all-three-kind query contract, and unchanged
  Query Proto align.
- Documentation — existing immutable `documentation_reviewer`,
  `gpt-5.6-luna` / `medium`: **CLEAN** after correction. The surface rejects an
  explicit Luna override because the role profile is fixed; no inherited
  fallback occurred. Guide, README, package and JSDoc wording accurately cover
  Aggregate, Projection, and Process Manager current-state queries; Wave status
  and deferrals are accurate.
- Performance/reliability — existing `performance_reliability_reviewer`,
  explicitly dispatched `gpt-5.6-terra` / `high`: **CLEAN** after correction.
  Shared current-query conformance runs on Memory, Datastore, and MySQL and
  covers bounds, reopen, ID/key and descriptor mismatch rejection,
  lifecycle/version filtering, ordering/limits, and tombstone exclusion.

All findings are resolved. No specialist lane remains open.

## Final focused evidence

- Service request-path suite: 156/156 passed.
- Combined focused client, codegen, server, and provider set: 379/379 passed.
- Final shared provider current-query suites: 176/176 passed.
- Generated typecheck, lint/cleanup, format, TypeDoc/API inventory, generated
  Proto cleanliness, residual-name scan, and `git diff --check` passed.
- Full native verification and final security review remain the next gates;
  the task is not yet committed or merged.

## Full verification

- Definitive native `verify` gate: **PASSED**.
- 130 files / 2,466 tests passed; 3 files / 25 opt-in tests skipped.
- Coverage: statements 94.08%, branches 90.02%, functions 94.47%, lines
  94.76%.
- Typecheck, lint/cleanup, format, TypeDoc/API inventory, Proto
  source/descriptors/generated cleanliness, and release readiness passed.
- Post-review tooling/test corrections received targeted
  style/maintainability and performance/reliability re-review: both **CLEAN**.
  Shared `lstatIfPresent` suppresses only missing paths, retains broken
  symlinks, and propagates other filesystem failures; the authoritative
  current-write close fixture and runtime validation coverage are sound.

## Final security review

- Existing `security_reviewer`, explicitly dispatched
  `gpt-5.6-terra` / `high`; the surface exposes configured dispatch metadata
  but no independent runtime self-introspection: **CLEAN**.
- Confirmed generated-code trust, strict query/request/candidate bounds,
  provider parameterization, durable ID/key and tenant isolation, tombstone
  exclusion, lifecycle/current-only remote exposure, masking, legacy-index
  removal, unchanged Query Proto, and fail-closed tooling.
- No dependency or lockfile change was introduced.

All review and verification gates are closed. The task is ready for commit and
integration but is not yet merged.

## Final affected-lane re-review disposition

| Lane                    | Disposition     | Evidence                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Style/maintainability   | Accepted fixed. | Stand point reads now delegate to the same entry-result mapper used by queries; EntityColumn tests reside under `test/entity`.                                                                                                                                                                                                     |
| Documentation           | Accepted fixed. | Query-facing Client TypeDoc, package/readme/guide wording, generated API inventory, and public test wording use generic Entity terminology. Subscription-specific Projection wording is intentionally retained.                                                                                                                    |
| TypeScript/API          | Accepted fixed. | `EntityRecordStorage.query()` remains required; the TypeDoc inventory now names the six Entity-prefixed exports; generated typecheck and Typedoc/API checks pass.                                                                                                                                                                  |
| Performance/reliability | Accepted fixed. | Query rows are authoritative (no Stand re-read); deleted records are removed before candidate accounting/evaluation in Memory, Datastore, and MySQL; shared Memory/Datastore conformance exercises current-query lifecycle/version/order/limit/tombstone behavior; MySQL factory regressions cover its durable current-query path. |

- Final focused evidence: 348 tests passed across client/entity-codegen, Memory,
  Datastore, MySQL, and SpineServices; service-only evidence is 156 passing tests;
  Stand evidence is 31 passing tests; after expanded shared conformance, Memory and
  Datastore pass 74 tests.
- Final deterministic gates passed: generated typecheck, lint plus cleanup rules,
  format check, generated docs/Typedoc API inventory, and `git diff --check`.
- Limitation: this repository defines no standalone `proto:compat:check` or
  `api:check` package scripts. The available generated Proto and Typedoc/API checks
  were run instead. This worktree is not committed, merged, or pushed by this task.

## Final reliability coverage blocker

- Closed: the shared current-query conformance now proves finite candidate-limit
  sentinel rejection, close/reopen querying, state-extracted ID versus physical-key
  rejection, and descriptor/fingerprint mismatch rejection. It retains the existing
  lifecycle, version, declared-column ordering, limit, and tombstone checks.
- Memory and Datastore run it through the history adapter; MySQL runs the extracted
  shared current-query runner with a persistent fixture-backed current table and
  `beforeEach` cleanup, so all three providers execute the same current contract.
- Evidence: the three provider suites pass 176 tests; generated typecheck,
  lint/cleanup, format check, and `git diff --check` pass. No production behavior
  changed and no commit, merge, or push was performed.

## Coverage threshold correction

- Added a descriptor contract test that exercises durable canonical-ID identity for
  null, string, number, boolean, bigint, and structured IDs; it also verifies
  state extraction, storage-key derivation, selected-ID-field fingerprint
  separation, and defensive ID cloning. This is behavior coverage for T-0072's
  shared current-storage descriptor, not a threshold workaround.
- Focused evidence: repository routing plus Memory, Datastore, and MySQL provider
  suites pass 311 tests. The full generated coverage command exited successfully
  twice on this surface after typecheck/build. Its output stream stopped after the
  V8 coverage banner and produced no report artifact, so the final reporter table
  cannot be quoted here; the six exercised branches raise the prior 8011/8906
  baseline to the required 8017/8906 (90.02%) if the denominator is unchanged.
- Generated lint/cleanup, format check, and whitespace diff checks pass. No
  production behavior changed and no commit, merge, or push was performed.

## Authoritative final gate

- The parent verification surface supersedes the earlier child-output
  limitation and estimate.
- Definitive `verify`: PASSED.
- Tests: 130 files / 2,466 tests passed; 3 files / 25 opt-in tests skipped.
- Coverage: statements 94.08% (14,806/15,737), branches 90.02%
  (8,018/8,906), functions 94.47% (3,694/3,910), lines 94.76%
  (14,105/14,884).
- Typecheck, lint/cleanup, format, TypeDoc/API inventory, Proto integrity and
  generated cleanliness, and release readiness passed. Release readiness
  verified 19 package imports and 121 relative Markdown links.

## Post-merge reliability re-review

- Trigger: the first post-merge coverage gate exposed unhandled cancellation
  rejections from a pending project-management subscription read after an
  earlier protocol failure.
- Existing role: `performance_reliability_reviewer`.
- Expected model/reasoning: explicitly dispatched `gpt-5.6-terra` / `high`.
- Scope: the focused `examples/project-management/src/load-runner.ts`
  cancellation-observation correction and its exact full-coverage evidence.
- Runtime metadata limitation: the Desktop surface exposes the immutable
  configured role/profile but no independent child self-introspection.
- Actual accepted metadata: existing `performance_reliability_reviewer`,
  configured `gpt-5.6-terra` / `high`; independent runtime introspection is
  unavailable.
- Disposition: **CLEAN**. Immediate observation of the same pending promise
  prevents cleanup-time unhandled rejection without changing the later awaited
  error path. Earlier command/query failures remain failed users, iterator
  return stays bounded, and no lifecycle or resource leak was found.
