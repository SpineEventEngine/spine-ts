# T-0046 Review Log

## Final task verification

- Full `pnpm verify`: PASS.
- Test executions: 80 files / 1,855 tests passed twice; 2 files / 8 tests were
  intentionally skipped.
- Coverage: statements 94.41%, branches 90.09%, functions 94.68%, lines 94.85%.
- Typecheck, lint/cleanup, format, TypeDoc/API, proto lint/generated cleanliness,
  and release readiness: PASS.
- Final disposition: ACCEPTED for task commit and integration. Credential-gated
  cloud smoke is not claimed.

## Review dispatch — 2026-07-20

Scope: staged changes on `task/T-0046-storage-datastore` relative to
`origin/main` (including the prior adapter commit and current staged orders
example/closure work).

| Concern                                                   | Existing role                      | Expected model / reasoning | Status     |
| --------------------------------------------------------- | ---------------------------------- | -------------------------- | ---------- |
| Style and maintainability                                 | `style_maintainability_reviewer`   | `gpt-5.6-terra` / high     | dispatched |
| TypeScript public API and documentation                   | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` / high     | dispatched |
| Persistence, concurrency, lifecycle, and load reliability | `performance_reliability_reviewer` | `gpt-5.6-terra` / high     | dispatched |
| Release security                                          | `security_reviewer`                | `gpt-5.6-terra` / high     | dispatched |

Acceptance rule: actual child runtime model/reasoning metadata must be present
and match this table. If the execution surface omits it, record the limitation;
do not represent the review as formally accepted on inherited defaults alone.

## 2026-07-20 remediation implementation assignment

- Existing role: `implementer`.
- Expected model/reasoning: `gpt-5.6-terra` / `medium`, explicit dispatch.
- Scope: canonical reversible IDs, typed comparison/index mapping, exact signed
  64-bit indexed bigint validation, provider query pushdown, strict finite
  materialization with documented overflow, focused tests, and T-0046 records.
- Exclusions: no generic cursor/public storage-port change, no unlimited scan,
  no project-management edits, no datastore-orders cancellation/coverage slice,
  no commit, and no subagents.
- Review will begin only after rollout metadata and focused mechanical evidence
  are independently verified.

## 2026-07-20 remediation skill applicability

- `test-driven-development` and `verification-before-completion` were read in
  full and apply respectively to A–C runtime work and all reported outcomes.
- `systematic-debugging`, advanced-TypeScript, and error-handling skills are
  N/A for this implementation start: no unexpected failing baseline or new
  public type/error-policy design is in scope. The binding plan already fixes
  the `DatastoreQueryLimitError` policy.
- Actual accepted rollout: session
  `019f805f-4d3b-75e3-84fa-8046394f1e96`, existing role `implementer`, actual
  model `gpt-5.6-terra`, actual reasoning `medium`. The session metadata and
  turn context match the explicit dispatch.

## 2026-07-20 remediation milestone 1 handoff

- Implementation evidence is ready for the relevant style, TypeScript/API, and performance/reliability review lanes. The focused suite passed 16/16 after first demonstrating the three intended RED failures; package typecheck, focused ESLint, focused Prettier, and diff whitespace checks are clean.
- Review focus: canonical codec equivalence to generic `StoredValues`, typed Datastore bigint mapping/range validation, provider query limit semantics, and the strict finite reconciliation boundary. Emulator behavior is not yet evidence in this milestone.

## 2026-07-20 remediation milestone 2 assignment

- Existing role: `implementer`.
- Expected model/reasoning: `gpt-5.6-terra` / `medium`, explicit dispatch.
- Scope: CAS/transaction/lifecycle hardening, emulator-first behavioral
  evidence, malformed-data and secret-safe failure coverage, TypeDoc/API
  entrypoints, user documentation, and durable records.
- Exclusions: no datastore-orders or project-management edits, commit, merge,
  push, or subagent. Specialist review remains deferred until the complete
  implementation endpoint is frozen.

## 2026-07-20 root emulator verification finding

- The explicit local-emulator run passed 20/21 tests but exposed an unhandled
  Datastore transaction-conflict abort in the concurrent CAS-create scenario.
  Acceptance is withheld until bounded conflict retry converts a retriable
  abort into a fresh comparison and deterministic CAS result, followed by a
  clean focused emulator rerun.
- Fix owner: existing `implementer`; expected profile explicitly remains
  `gpt-5.6-terra` / `medium`.

- Post-fix diagnosis: the full focused gate passed 21/22 but exceeded the
  default 5-second test deadline in the CAS scenario; the same scenario passed
  with a 20-second diagnostic deadline in 3.15 seconds. Acceptance remains
  withheld only for a realistic scenario-local emulator timeout and a clean
  repeated root gate; production retry semantics are not to be widened.

- Final root acceptance rerun passed 2 files / 22 tests against the local
  Datastore-mode emulator. The original concurrent CAS race now passes with
  bounded exact-code-10 retry and a scenario-local 15-second test timeout; the
  successful gate completed in 2.99 seconds. This finding is resolved for
  review-wave entry.

## 2026-07-20 canonical remediation review wave

Review target: the complete T-0046 worktree endpoint relative to `main` at
`1d4d94c5`, including preserved staged work and remediation edits. Reviewers
are read-only and must not commit, push, stash, or spawn subagents.

| Concern                                   | Existing role                      | Expected model / reasoning          | Status                    |
| ----------------------------------------- | ---------------------------------- | ----------------------------------- | ------------------------- |
| Style and maintainability                 | `style_maintainability_reviewer`   | `gpt-5.6-terra` / high              | dispatched                |
| TypeScript public API and compatibility   | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` / high              | dispatched                |
| Persistence, concurrency, lifecycle, load | `performance_reliability_reviewer` | `gpt-5.6-terra` / high              | dispatched                |
| Documentation completeness and claims     | `documentation_reviewer`           | role-pinned `gpt-5.6-luna` / medium | queued for available slot |

- Acceptance requires actual session role, model, and reasoning from rollout
  metadata to match this table before a result is accepted. The documentation
  role's project configuration explicitly pins Luna/medium because the desktop
  spawn API does not expose Luna as a selectable override.
- The stale pre-remediation security row above is superseded. Per-task final
  security review is N/A: T-0046 changes persistence behavior but is not the
  repository release boundary, and no explicit security review was requested.
  Security-sensitive credential redaction remains within the reliability and
  API/documentation review scope; the final security reviewer remains reserved
  for release readiness under the completion plan.

### TypeScript/API result

- Actual rollout: session `019f807e-0152-72d0-9a06-46020b8da108`, existing
  role `typescript_api_docs_reviewer`, actual model `gpt-5.6-terra`, actual
  reasoning `high`; this matches the explicit dispatch.
- P1: `CanonicalValue`'s public-data-shaped internal tags collide with ordinary
  objects such as `{ kind: "bigint", value: "1" }`, which encode like `1n` and
  violate reversible collision-free slot identity.
- P1: provider offset is pushed down and then applied again locally, so real
  Datastore queries skip twice; the narrow fake does not expose this behavior.
- P2: indexed/query numbers accept `NaN` and infinities despite the documented
  finite Datastore-compatible contract.
- Exact four-export API/TypeDoc gate and the absence of Datastore-orders
  `packCommand` use were confirmed clean. Disposition awaits the complete
  review wave and one combined implementer fix batch.

### Style/maintainability result

- Actual rollout: session `019f807d-c142-7831-a9d1-0535bc203b9a`, existing
  role `style_maintainability_reviewer`, actual model `gpt-5.6-terra`, actual
  reasoning `high`; this matches the explicit dispatch.
- Confirmed the raw-bigint and double-offset P1 findings. Added P2 findings for
  incomplete emulator query/lifecycle coverage, runner methods above the
  repository's 35-line target, and brittle source-text cancellation assertions.

### Performance/reliability result

- Actual rollout: session `019f807e-1ed8-7b42-afea-8b108587a9e2`, existing
  role `performance_reliability_reviewer`, actual model `gpt-5.6-terra`, actual
  reasoning `high`; this matches the explicit dispatch.
- P1: accepted signed-64 indexed bigint is passed raw to the Google client,
  which cannot encode it; provider wrapping and returned-value normalization
  plus emulator evidence are required.
- P1: lexical provider `__key__` ordering is not typed canonical ID ordering,
  so applying provider limits before local ID/tie reconciliation can return or
  paginate the wrong row.
- Confirmed the canonical tag collision, including `__proto__` object-key loss.
- P2: add batch second-group failure/no-retry evidence and injected-client
  ownership/handle/factory close evidence.

### Documentation result

- Actual rollout: session `019f8081-a325-7ac3-b6a2-dae2d61832db`, existing
  role `documentation_reviewer`, actual model `gpt-5.6-luna`, actual reasoning
  `medium`; the role-pinned profile matches dispatch.
- User-facing package, user-guide, API, and example claims are clean.
- Medium finding: `docs/firestore-storage-extension-analysis.md` incorrectly
  says the emulator command can start gcloud in-process and implies current CI
  integration. The implemented script requires an already-running emulator;
  revise the binding analysis to the actual opt-in workflow.

### Combined fix-batch disposition

- Adapter owner: existing `implementer`, explicitly `gpt-5.6-terra` / medium.
  Fix collision-free canonical identity (including sentinel-shaped and
  `__proto__` objects), provider bigint mapping/normalization, finite-number
  validation, single offset application, typed ID/tie bounded reconciliation,
  and the batch/lifecycle/emulator evidence gaps. Correct the stale emulator
  plan wording. No generic cursor/unlimited scan/public storage-port change.
- Example owner: existing `implementer`, explicitly `gpt-5.6-terra` / medium.
  Refactor runner methods under the maintainability target and replace
  source-text assertions with transport-observed command/query/subscription
  cancellation behavior. Ownership is limited to assigned Datastore-orders
  runner/test files.
- Both owners preserve unrelated edits, do not commit/push/stash, and do not
  spawn subagents. All findings remain open until focused root verification and
  the affected reviewer re-review wave pass.

### Root post-fix emulator finding

- Expanded live gate: 27/28 passed; indexed bigint filter/order returned an
  empty result for persisted `2n`. Provider encoding no longer throws, but the
  adapter must preserve or reconstruct bigint column type across Google client
  decode before local typed filtering/ordering. Returned-value normalization
  based only on `Datastore.isInt()` is insufficient when safe integers decode
  as native numbers. Returned to the same adapter owner; finding remains open.

- Bigint type preservation resolved that path in the next root run. The same
  27/28 gate then exposed immediate-retry CAS livelock: one contender exhausted
  all three exact-code-10 attempts after 6.1 seconds. Add finite contention
  backoff without widening retry classification, then repeat the live gate.

### Root fix acceptance and affected re-review

- Root accepted mechanical evidence: Datastore-orders 2 files / 9 tests plus
  build/lint/format; adapter 28/28 tests against the live emulator on three
  consecutive runs (3.00, 2.95, 5.30 seconds), including bigint and concurrent
  CAS. Static owner gates were also clean.
- Re-review assignments, recorded before dispatch:
  - `style_maintainability_reviewer`: expected `gpt-5.6-terra` / high; inspect
    all style findings and regression surface.
  - `typescript_api_docs_reviewer`: expected `gpt-5.6-terra` / high; inspect
    all API findings and provider/value contracts.
  - `performance_reliability_reviewer`: expected `gpt-5.6-terra` / high;
    inspect all persistence/cancellation/lifecycle findings and CAS backoff.
  - `documentation_reviewer`: role-pinned expected `gpt-5.6-luna` / medium;
    inspect corrected emulator-plan wording and endpoint claims after code fixes.
- Results require matching actual rollout metadata and CLEAN/resolved findings
  before task verification, commit, or push.

### Affected re-review results and final fix batch

- Re-review runtime metadata was independently confirmed on the same accepted
  reviewer sessions: style `019f807d-c142-7831-a9d1-0535bc203b9a`
  (`gpt-5.6-terra` / high), API
  `019f807e-0152-72d0-9a06-46020b8da108` (`gpt-5.6-terra` / high),
  reliability `019f807e-1ed8-7b42-afea-8b108587a9e2`
  (`gpt-5.6-terra` / high), and documentation
  `019f8081-a325-7ac3-b6a2-dae2d61832db` (`gpt-5.6-luna` / medium).
- All prior P1/P2 runtime findings were confirmed resolved except one new P1:
  reads, queries, and transactional gets omit `wrapNumbers`, so Google decoding
  can throw before normalization for exact signed-64 values outside the safe
  integer range. Add wrapped decoding on every entity read and live boundary
  evidence while preserving ordinary number types.
- Style P2: extract a single transaction attempt so CAS stays under the 35-line
  method target; add live 501-write and client-ownership/close evidence required
  by the accepted emulator plan.
- API/docs P2: public docs and the remediation plan must say equality/ID filters
  and ordering are translated to the provider, every fetch uses the fixed
  `maxClientSideScan + 1` overflow sentinel, and typed continuation/offset/
  requested limit are local. Remove stale "decision required" and requested
  page-size/provider-pagination wording.
- Docs P3: describe unique kinds plus targeted per-scenario cleanup rather than
  database reset or a single entity.
- Final owner is the existing adapter `implementer`, explicitly
  `gpt-5.6-terra` / medium. It owns the adapter/tests and affected documentation
  only; no generic API widening, commit, push, stash, or subagent is authorized.

### Final batch root evidence and closure re-review dispatch

- Root live gate passed 31/31 in 5.67 seconds with all seven emulator scenarios,
  including exact signed-64 boundaries, 501 batching, and injected-client
  ownership after adapter closure. Static owner gates are clean.
- Same existing reviewer roles are redispatched read-only. Expected profiles
  remain style/API/reliability `gpt-5.6-terra` / high and documentation
  role-pinned `gpt-5.6-luna` / medium. Matching actual rollout metadata and
  CLEAN results are required before final verification/commit.

### Closure re-review residual batch

- API and style closure re-reviews are CLEAN. Documentation is substantively
  CLEAN with only stale task/work/plan status text to update from pending to
  implemented/live-verified.
- Reliability found one P1: finite ordinary JavaScript numbers above the safe
  integer boundary are implicitly encoded by the Google client as integers;
  wrapped decoding then restores them as bigint, changing type and breaking
  local equality. Encode all ordinary finite numbers explicitly as Datastore
  doubles so their JavaScript number type is preserved; bigint remains the
  explicit signed-64 integer path. Add provider-faithful unit and live
  round-trip/filter/order evidence for `Number.MAX_SAFE_INTEGER + 1`.
- Same existing adapter `implementer`, explicitly `gpt-5.6-terra` / medium,
  owns only this number mapping/test and status-text batch. Acceptance and
  commit remain withheld for root live verification and focused closure
  re-review.

### Residual root evidence and focused closure dispatch

- Root live gate passed 31/31 in 3.16 seconds with unsafe ordinary-number
  round-trip/equality/order plus signed-64 bigint boundaries.
- Focused re-review assignments: same
  `performance_reliability_reviewer`, expected `gpt-5.6-terra` / high, and same
  `documentation_reviewer`, role-pinned expected `gpt-5.6-luna` / medium.
  Both are read-only. Prior API/style CLEAN results are unaffected by the
  internal provider-value mapping and status-only record edits.

- Final full verification later exposed a test-only scheduling finding in the
  already-reviewed cancellation harness: coverage instrumentation allowed only
  8/10 stalled handlers to start before a 50 ms timeout. The existing example
  implementer (explicit Terra/medium) owns a bounded test-budget fix; affected
  reliability/style closure re-review will follow focused coverage evidence.

- Fix evidence: stalled-phase-only timeout is now a named 500 ms budget; all
  four phases still require 10 started, 10 aborted, and zero active work.
  Focused normal and V8 coverage runs passed 5/5. Final affected re-review is
  dispatched read-only to the same style and reliability roles, explicitly
  `gpt-5.6-terra` / high, before repeating full verification.

- Focused closure results: style CLEAN and reliability CLEAN on their existing
  accepted Terra/high sessions. The adjustment is test-only, remains bounded,
  preserves 10/10/zero assertions, and changes no production resource behavior.
  All canonical lanes are CLEAN; repeat full verification is authorized.

- Repeated full coverage subsequently passed all 1,850 tests but measured
  89.56% branches (5,028/5,614), 25 short of the 90% gate. Coverage remediation
  is returned to the existing adapter implementer for behavior tests around the
  private canonical codec and malformed persisted IDs. Any unsupported-value
  collision correction requires affected re-review; exclusions/threshold
  changes are forbidden.

- Coverage fix result: root global coverage passed 1,855 tests at 90.07%
  branches (5,062/5,620); codec coverage is 102/102 branches. Unsupported
  symbol/function identifiers now reject rather than collide with undefined;
  malformed numeric/byte/tag decoding is stricter and sanitized. Same
  style/API/reliability roles are redispatched read-only at explicit Terra/high.

- Affected style review is CLEAN. API and reliability both found one P1 in
  strict canonical decoding: fixed-arity tags/object entries ignore surplus
  elements and bigint text `"01"` aliases canonical `"1"`. Non-canonical object
  key order can likewise decode to an ID whose re-encoded lookup key differs.
  Require exact arity, canonical bigint text, strictly sorted unique object
  keys/entries, and persisted-ID rejection tests. Same adapter implementer,
  explicitly Terra/medium, owns this bounded fix; coverage/API acceptance is
  withheld pending focused checks and re-review.

- Decoder fix evidence: exact fixed-tag/object-entry arity, canonical bigint
  text, and strictly ascending unique object keys now pass 29/29 tests; arrays
  remain variadic; codec coverage is 113/113 branches. Same API and reliability
  reviewers are redispatched read-only at explicit Terra/high for closure.

- Focused decoder closure: API CLEAN and reliability CLEAN on their existing
  accepted Terra/high sessions. Every accepted encoding re-encodes identically;
  malformed aliases reject through the sanitized error; public/Protobuf
  surfaces remain unchanged. All canonical review concerns are CLEAN. Final
  full verification is authorized.

### Final canonical dispositions

- Style/maintainability: CLEAN. Actual accepted session
  `019f807d-c142-7831-a9d1-0535bc203b9a`, role
  `style_maintainability_reviewer`, `gpt-5.6-terra` / high.
- TypeScript/API: CLEAN. Actual accepted session
  `019f807e-0152-72d0-9a06-46020b8da108`, role
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / high.
- Performance/reliability: CLEAN after provider-double closure. Actual accepted
  session `019f807e-1ed8-7b42-afea-8b108587a9e2`, role
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high. Focused 24/24
  and root live 31/31 evidence accepted.
- Documentation: CLEAN after status closure. Actual accepted session
  `019f8081-a325-7ac3-b6a2-dae2d61832db`, role
  `documentation_reviewer`, `gpt-5.6-luna` / medium.
- Every review finding is resolved. Per-task security review remains N/A for
  the previously recorded concrete reason. Full task verification is the only
  remaining pre-commit gate.

### Unsafe-number residual implementation handoff

- The provider-faithful RED proves the P1: wrapped integer decoding changed
  `Number.MAX_SAFE_INTEGER + 1` to bigint and broke local equality. GREEN forces
  every finite ordinary numeric column/filter through `Datastore.double`, while
  preserving bigint on the tagged signed-64 integer path.
- Focused unit behavior now covers unsafe-number round-trip/equality/order beside
  both bigint endpoints; the same assertions are present in the seven-scenario
  emulator suite. Generated typecheck, lint/cleanup, and docs/API gates pass.
- Stale top-level task/work/plan status now reflects completed prerequisite,
  example implementation, and prior live verification. Final acceptance remains
  pending the root's live rerun and focused reliability/documentation closure
  re-review.

### Canonical codec coverage closure handoff

- Focused coverage raises the private canonical codec from 68/96 to 102/102
  covered branches without changing thresholds, exclusions, or public exports.
  Tests cover every supported ID kind, valid decoder tag, equality/order family,
  independent-handle round trip, and malformed persisted-ID validation family.
- Symbol and function IDs no longer collide with undefined; both fail at the
  private classifier with a stable non-sensitive unsupported-type error.
  Non-canonical numeric text and invalid byte values also reach the existing
  sanitized persisted-identifier boundary.
- Focused 29/29 unit behavior, generated typecheck, and full lint/cleanup gates
  pass. Review acceptance remains with the root closure flow.

### Canonical decoder alias remediation handoff

- Exact fixed-tag arity now prevents surplus canonical aliases; arrays remain
  variadic. Bigint text must equal the parsed value's canonical decimal string.
  Object entries are exact pairs in strictly ascending unique-key order, so
  accepted persisted IDs re-encode to the same canonical key.
- Persisted malformed regressions cover surplus tags, bigint `01`/`-0`, extra
  object fields, duplicate/unsorted keys, and nested invalid values through the
  single sanitized identifier error. Valid supported kinds and own `__proto__`
  behavior remain covered.
- Focused tests pass 29/29, codec coverage is 113/113 branches, and generated
  typecheck plus full lint/cleanup pass. Review acceptance remains with root.

## 2026-07-20 transaction-conflict remediation handoff

- CAS now bounds itself to three total attempts and retries only sanitized,
  exact code-10 `ABORTED` conflicts. Review the re-read/stale-loser behavior,
  bound, and preservation of rollback/redaction. Unit proof is green; the
  direct emulator rerun is unavailable only in this sandbox.

## 2026-07-20 CAS timeout calibration

- The emulator CAS contention scenario has a local 15-second timeout based on
  the root's isolated 3.15-second passing measurement. Review that scope remains
  local to contention; production retry semantics and unrelated test timeouts
  are unchanged.

## 2026-07-20 tooling typecheck repair

- TS7023 in the CAS unit fake is resolved with explicit void callback return
  types. The full generated/tooling typecheck gate is green; no production
  behavior changed.

## 2026-07-20 cleanup naming repair

- The private retry-bound constant now uses `maxCasAttempts`, satisfying the
  cleanup semantic-component limit with no behavioral change. Full generated
  lint/cleanup enforcement is green.

## 2026-07-20 combined adapter finding disposition

- Implemented all accepted adapter findings: collision-free canonical IDs;
  `Datastore.Int` mapping and local bigint normalization; finite-number guards;
  exactly-once local offset/windowing behind a strict scan sentinel; batch
  partial-failure and lifecycle evidence; expanded emulator cases; and corrected
  emulator/CI documentation. Focused unit/tooling gates are green. Root must run
  the live emulator cases because this child sandbox rejects loopback gRPC.

## 2026-07-20 safe-integer bigint remediation

- Private unindexed column-type metadata now preserves bigint semantics across
  Google-client safe-integer decoding without changing the indexed provider
  value. Review filter/order/continuation restoration and exclusion metadata;
  focused unit/static gates are green and root live rerun is pending.

## 2026-07-20 CAS contention backoff remediation

- The root live gate confirmed exact-code-10 retries but exposed synchronized
  immediate re-entry: one contender exhausted all three attempts after 6.1
  seconds. The adapter now adds finite exponential delay with bounded jitter
  only before an otherwise eligible retry. Three total attempts, exact-code
  classification, sensitive-error exclusion, rollback, redaction, and stale
  reread semantics remain unchanged.
- Deterministic fake-timer evidence observes no second transaction before the
  controlled 150 ms delay. The focused suite and generated typecheck/lint gates
  are green; disposition remains pending the root's repeated live emulator gate.

## 2026-07-20 final combined re-review disposition

- P1 signed-64 decode: resolved in unit evidence by requesting wrapped integers
  on every direct/query/transaction read path, then restoring tagged bigint and
  safe untagged number semantics locally. Emulator coverage now includes both
  signed-64 endpoints across read/filter/order/CAS; root live proof is pending.
- Maintainability: resolved by separating the bounded retry policy from one CAS
  transaction-attempt helper. Cleanup method-size/naming enforcement passes;
  retry classification, bounds, backoff, rollback, reread, and redaction did not
  change.
- Emulator evidence gaps: covered by a 501-row write boundary and lifecycle
  scenario proving storage/factory guards and caller-owned client usability.
  All seven scenarios use unique kinds and targeted cleanup.
- Documentation: corrected to the fixed `maxClientSideScan + 1` sentinel and
  once-local continuation/tie/offset/requested-limit model; removed stale
  provider-pagination and emulator-reset implications.
- Focused unit, generated typecheck/lint/cleanup, and generated docs/API gates
  pass. Findings remain open only for root live emulator verification and the
  accepting re-review wave.

## 2026-07-20 remediation milestone 2 handoff

- Review focus: transaction failure redaction/rollback behavior, direct injected-client ownership, emulator test design, and the TypeDoc exact-export gate. Focused unit/TDD and API checks pass; live emulator execution is blocked by sandbox `EPERM` to the explicitly configured loopback host and is not represented as passing.
